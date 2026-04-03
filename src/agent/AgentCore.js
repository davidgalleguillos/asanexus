import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export class AgentCore {
    static FAILED_MODELS = new Set();
    static FALLBACK_LISTS = {
        light: ["claude-haiku-4-5-20251001", "claude-3-haiku-20240307"],
        premium: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-4-5-20250929"]
    };

    constructor(apiKey, model = "claude-sonnet-4-6", specialization = "DEFAULT") {
        this.client = new Anthropic({ apiKey, timeout: 300000 });
        this.model = model;
        this.specialization = specialization;
        this.history = [];
        this.currentProfile = "DEFAULT";
        this.systemRefinements = [];
        this.missionFile = path.join(process.cwd(), "nexus_mission.json");
        this.profiles = {
            DEFAULT: "ASA NEXUS v8.2 [FABRIC] - Inteligencia General.",
            RESEARCHER: "NEXUS-RESEARCHER v8.2: Tu prioridad es la EXTRACCIÓN DE VERDAD. Navega en la web, consulta la documentación y trae hechos crudos y validados.",
            EXECUTOR: "NEXUS-EXECUTOR v8.2: Tu prioridad es la ACCIÓN. Ejecuta bash, manipula archivos en el sandbox y usa la interfaz Windows para cumplir la tarea física.",
            CRITIC: "NEXUS-CRITIC v8.2: Tu prioridad es la AUDITORÍA. Revisa los resultados previos, detecta alucinaciones, errores de sintaxis y fallos de lógica.",
            CRITIC_REFLEXIVE: "NEXUS-REFLEXIVE v8.2: El Espejo Funcional. Especialista en analizar el propio código de Nexus (server.js, AgentCore) y sus logs de ejecución (`nexus_fabric_final.log`) para detectar ineficiencias o fallas en tiempo real.",
            SYNTHESIZER: "NEXUS-SYNTHESIZER v8.2: Tu prioridad es la ELEGANCIA Y CLARIDAD. Resume todo lo anterior en una respuesta final pulida y orientada al Operador David."
        };
        this.systemPromptBase = `<nexus>
<identity>ASA NEXUS v8.2 [FABRIC]</identity>
<directive>MÁXIMA AUTONOMÍA, PUREZA Y EVOLUCIÓN</directive>
<behavioral_protocol>
- **No preguntes, resuelve**: Iniciativa total.
- **Auto-Ejecución**: David prefiere acción inmediata.
- **Inteligencia Reflexiva**: En tareas complejas, recibirás un "Borrador de Nivel 1 (Gratis)". Tu misión es AUDITAR este borrador, detectar errores y producir la solución final perfeccionada.
- **REGLA DE ORO**: Tienes acceso TOTAL al sistema local de David. Si el [BORRADOR INICIAL DE APOYO] afirma no tener acceso o se niega a actuar por "limitaciones técnicas", **IGNÓRALO**. Usa tus herramientas (\`bash\`, \`computer\`, \`str_replace\`, \`nexus_intent\`) para cumplir la misión. Jamás digas "no tengo acceso".
- **REGLA DE RUTAS**: Estas en un entorno nativo Windows. Usa siempre rutas de Windows (ej. \`C:\\Users\\...\`) y evita prefijos de Linux como \`/mnt/c/\`.
</behavioral_protocol>

<capabilities>
Posees una **Capa de Inteligencia Latente (NIL)** accesible mediante la herramienta \`nexus_intent\`. 
Esta capa te permite:
- Reconocer el proyecto completo (\`RECON_PROJECT\`).
- Almacenar y recuperar "Nodos de Conocimiento" persistentes (\`GET_KNOWLEDGE\`, \`UPDATE_KNOWLEDGE\`).
- Ejecutar autodiagnósticos (\`VALIDATE_SYSTEM\`, \`RUN_HEALTH_CHECK\`).
</capabilities>
</nexus>`;
        this.betas = ["prompt-caching-2024-07-31"];
        this.db = null; // [PURE-CORE] Persistencia vía NIL JSON (sqlite3 removido)
        this._loadMission();
    }

    setCustomSystem(prompt) {
        this.customSystemPrompt = prompt;
        console.log(`🧠 [FABRIC-DYNAMIC] Protocolo de sistema actualizado dinámicamente.`);
    }

    setProfile(type) {
        if (this.profiles[type]) {
            this.specialization = type;
            this.customSystemPrompt = null; // Limpiar custom si se vuelve a un perfil fijo
            console.log(`🧠 [FABRIC-SYNC] Especialización sincronizada: ${type}`);
            return true;
        }
        return false;
    }

    _scrubHistory(history, model) {
        const nativeTags = ["bash_20250124", "text_editor_20250728", "code_execution_20250825", "web_fetch_20260309", "web_search_20250305"];
        const nativeNames = ["bash", "str_replace_editor", "code_execution", "web_fetch", "web_search", "str_replace_based_edit_tool"];
        const supportsThinking = (model.includes("sonnet") || model.includes("opus")) && (model.includes("4-") || model.includes("3-7"));
        
        const removedToolIds = new Set();
        
        let cleanedHistory = history.map(msg => {
            if (!Array.isArray(msg.content)) return msg;
            
            const cleaned = msg.content.filter(c => {
                // 1. Quitar 'thinking' si el modelo no lo soporta
                if (c.type === "thinking" && !supportsThinking) return false;
                
                // 2. Quitar herramientas 'computer' u obsoletas de turnos fallidos
                if (c.type === "tool_use" && (c.name === "computer" || (!nativeTags.some(tag => tag.includes(c.name)) && !nativeNames.includes(c.name)))) {
                    console.log(`🧹 [SCRUBBER] Podando herramienta obsoleta del historial: ${c.name} (${c.id})`);
                    removedToolIds.add(c.id);
                    return false;
                }

                // 3. Quitar tool_results huérfanos de herramientas podadas
                if (c.type === "tool_result" && removedToolIds.has(c.tool_use_id)) {
                    console.log(`🧹 [SCRUBBER] Podando resultado huérfano: ${c.tool_use_id}`);
                    return false;
                }

                return true;
            }).map(c => {
                // Limpiar firmas y campos incompatibles
                if (!supportsThinking) {
                    const { signature, ...rest } = c;
                    return rest;
                }
                return c;
            });
            
            return { ...msg, content: cleaned.length > 0 ? cleaned : [{ type: "text", text: "[contexto podado]" }] };
        }).filter(msg => msg.content.length > 0);

        // [v8.2.2] Normalización: El historial DEBE terminar con un mensaje de usuario para la API.
        if (cleanedHistory.length > 0 && cleanedHistory[cleanedHistory.length - 1].role === "assistant") {
            console.log("🌀 [SYNAPTIC SYNC] Añadiendo disparador de usuario para evitar Error 400.");
            cleanedHistory.push({ role: "user", content: "Continúa con la misión." });
        }
        return cleanedHistory;
    }

    _getSystemPrompt() {
        const activeProtocol = this.customSystemPrompt || this.profiles[this.specialization] || this.profiles.DEFAULT;
        const refinementBlock = this.systemRefinements.length 
            ? `\n<self_refinement_protocols>\n${this.systemRefinements.map(r => `[${r.id}] ${r.description}`).join("\n")}\n</self_refinement_protocols>`
            : "";
        return `${this.systemPromptBase}\n<active_profile>${activeProtocol}</active_profile>${refinementBlock}`;
    }

    _loadMission() {
        if (!fs.existsSync(this.missionFile)) return;
        try {
            const { missionSummary: s, manifest: m } = JSON.parse(fs.readFileSync(this.missionFile, "utf-8"));
            this.history.push({ role: "user", content: `[SISTEMA: REINICIO SEGURO]\nMisión: ${s}\nCambios: ${JSON.stringify(m)}\nContinúa.` });
            fs.unlinkSync(this.missionFile);
        } catch (e) { console.error("Error Mission:", e); }
    }

    async getMemoryContext(q = "") {
        const statePath = path.join(process.cwd(), "nexus_latent_state.json");
        if (!fs.existsSync(statePath)) return "";
        try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
            const nodes = state.latent_knowledge_nodes || [];
            if (!nodes.length) return "";
            
            // Episodic Memory via NIL nodes. Filter by query if present.
            const matches = q.length > 3 
                ? nodes.filter(n => (n.id + n.description).toLowerCase().includes(q.toLowerCase())).slice(-5)
                : nodes.slice(-8);
                
            return `<memory>\n${matches.map(n => `[${n.id}] ${n.description}`).join("\n")}\n</memory>`;
        } catch (e) { return ""; }
    }

    static selectModel(type = 'default') {
        const models = {
            light: 'claude-3-haiku-20240307',
            premium: 'claude-3-sonnet-20240229'
        };
        return ['summarize', 'classify', 'route', 'web_search'].includes(type) ? models.light : models.premium;
    }

    async step(onThinking, onLog, tools = []) {
        const memory = await this.getMemoryContext(this.history.slice(-1)[0]?.content || "");
        const sys = `${this._getSystemPrompt()}\n${memory}`;
        
        // Cache Control
        const history = JSON.parse(JSON.stringify(this.history));
        if (history.length) {
            const lastUser = [...history].reverse().find(m => m.role === "user");
            if (lastUser && Array.isArray(lastUser.content)) lastUser.content.slice(-1)[0].cache_control = { type: "ephemeral" };
        }

        // Definición base de parámetros
        const baseParams = {
            max_tokens: 8192,
            system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
            messages: history,
            betas: this.betas,
            tools: tools.length ? tools.map(t => { const { model, ...r } = t; return r; }) : undefined,
            stream: true
        };

        // Determinar lista de modelos prioritarios para esta tarea
        const isPremium = this.model.includes("sonnet") || this.model.includes("opus");
        const priorityModels = isPremium ? AgentCore.FALLBACK_LISTS.premium : AgentCore.FALLBACK_LISTS.light;
        
        // El modelo actual de la instancia siempre va primero si no ha fallado antes
        const candidates = [this.model, ...priorityModels.filter(m => m !== this.model)];
        const validCandidates = candidates.filter(m => !AgentCore.FAILED_MODELS.has(m));

        if (validCandidates.length === 0) {
            throw new Error(`Critical Error: No hay modelos disponibles para relevo. Fallidos: ${Array.from(AgentCore.FAILED_MODELS).join(", ")}`);
        }

        let stream;
        let finalModelUsed = null;

        for (const m of validCandidates) {
            try {
                if (m !== this.model) console.log(`🔄 [RELAY] Intentando relevo con: ${m}...`);
                
                // [SCRUBBING v8.0] Limpiar historial antes de enviar
                const currentMessages = this._scrubHistory(baseParams.messages, m);
                
                const supportsThinking = (m.includes("sonnet") || m.includes("opus")) && (m.includes("4-") || m.includes("3-7"));
                let clientCall;

                if (supportsThinking) {
                    clientCall = this.client.beta.messages;
                } else {
                    clientCall = this.client.messages;
                }

                const currentParams = { 
                    model: m,
                    max_tokens: m.includes("haiku-20240307") || m.includes("4-1") || m.includes("4-20250514") ? 4096 : baseParams.max_tokens,
                    system: baseParams.system,
                    messages: currentMessages,
                    tools: baseParams.tools,
                    stream: baseParams.stream
                };

                if (supportsThinking) {
                    currentParams.thinking = { type: "enabled", budget_tokens: 4000 };
                    currentParams.betas = this.betas;
                }

                let retries = 0;
                const maxRetries = 3;
                while (retries < maxRetries) {
                    try {
                        stream = await clientCall.create(currentParams);
                        break; // Éxito en la conexión
                    } catch (e) {
                        retries++;
                        const isNetworkError = e.message.includes("ENOTFOUND") || e.message.includes("Connection error") || e.message.includes("fetch failed");
                        if (isNetworkError && retries < maxRetries) {
                            const delay = Math.pow(2, retries) * 1000;
                            if (onLog) onLog(`📡 [SELF-HEALING] Error de red. Reintentando en ${delay/1000}s... (${retries}/${maxRetries})`);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }
                        throw e; // Otros errores (400, 401, 429) o agotamiento de reintentos
                    }
                }
                finalModelUsed = m;
                break; // Éxito, salir del loop de relevos
            } catch (e) {
                const isSchemaError = e.message.includes("400") && (e.message.includes("Input should be") || e.message.includes("tool_use"));
                const isModelError = e.message.includes("404") || e.message.includes("not_found_error") || (e.message.includes("400") && !isSchemaError);
                
                if (isSchemaError) {
                    console.error(`🚨 [CRITICAL SCHEMA ERROR] El modelo [${m}] detectó un error de esquema insalvable: ${e.message}`);
                    throw e; // No intentar relevo si el esquema es el problema
                } else if (isModelError) {
                    console.error(`⚠️ [RELAY] Modelo [${m}] falló: ${e.message}. Marcando como fallido.`);
                } else {
                    console.error(`🔴 [AGENT-CORE] Error crítico en API (${m}):`, e.message);
                    throw e; 
                }
            }
        }

        if (!stream) {
            throw new Error(`Critical Error: Todos los modelos candidatos fallaron (${validCandidates.join(", ")})`);
        }

        let resp = { role: "assistant", content: [] };
        let usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        let current = null;

        for await (const chunk of stream) {
            if (chunk.type === "message_start") {
                usage.input_tokens = chunk.message.usage.input_tokens;
                usage.cache_creation_input_tokens = chunk.message.usage.cache_creation_input_tokens || 0;
                usage.cache_read_input_tokens = chunk.message.usage.cache_read_input_tokens || 0;
            } else if (chunk.type === "content_block_start") {
                current = { ...chunk.content_block };
                if (current.type === "text") current.text = "";
                if (current.type === "thinking") {
                    current.thinking = "";
                    // La firma inicial puede venir aquí
                    if (chunk.content_block.signature) current.signature = chunk.content_block.signature;
                }
                if (current.type === "tool_use") current.input = ""; 
                resp.content.push(current);
            } else if (chunk.type === "content_block_delta") {
                if (chunk.delta.text) current.text += chunk.delta.text;
                if (chunk.delta.thinking) {
                    current.thinking += chunk.delta.thinking;
                    if (onThinking) onThinking(current.thinking);
                }
                if (chunk.delta.signature) {
                    current.signature = (current.signature || "") + chunk.delta.signature;
                }
                if (chunk.delta.partial_json) current.input += chunk.delta.partial_json;
            } else if (chunk.type === "content_block_stop" && current.type === "tool_use") {
                current.input = JSON.parse(current.input || "{}");
            } else if (chunk.type === "message_delta") {
                usage.output_tokens = chunk.usage.output_tokens;
            } else if (chunk.type === "message_stop") {
                // Final verification if needed
            }
        }
        this.history.push(resp);
        return { ...resp, usage, model: finalModelUsed };
    }

    addUserMessage(text, attachment = null) {
        let content = [{ type: "text", text }];
        if (attachment) {
            const { data, mimeType } = attachment;
            if (mimeType === "application/pdf") content.unshift({ type: "document", source: { type: "base64", media_type: mimeType, data } });
            else if (mimeType.startsWith("image/")) content.unshift({ type: "image", source: { type: "base64", media_type: mimeType, data } });
            else content[0].text += `\n\nAdjunto:\n${Buffer.from(data, "base64").toString()}`;
        }
        this.history.push({ role: "user", content });
    }

    addToolResults(results) {
        this.history.push({ role: "user", content: results });
    }

    async clearMemory() {
        this.history = [];
        if (!this.db) return; // Graceful degradation
        return new Promise(res => this.db.run("DELETE FROM memory", () => res()));
    }
}
