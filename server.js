import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";

import { AgentCore } from "./src/agent/AgentCore.js";
import { SystemManager } from "./src/tools/SystemManager.js";
import { FileManager } from "./src/tools/FileManager.js";
import { SearchManager } from "./src/tools/SearchManager.js";
import { ToolSchemas } from "./src/tools/ToolSchemas.js";
import { SemanticCache } from "./src/cache/SemanticCache.js";
import { CascadeRouter } from "./src/routing/CascadeRouter.js";
import { NexusIntentLayer } from "./src/intent/NexusIntentLayer.js";
import { AuditExpert } from "./src/tools/AuditExpert.js";
import { AuditLogger } from "./src/tools/AuditLogger.js";
import { MCPConnector } from "./src/tools/MCPConnector.js";
import { NativeTools } from "./src/tools/NativeTools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: "uploads/", limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB max
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    pingTimeout: 120000,
    pingInterval: 25000,
    cors: { origin: "*" } // v8.2 Standard: Abierto para LAN, protegido por firewall local
});

// --- CORE INSTANCES [FABRIC v8.2] ---
console.log(`\x1b[35m[ASA NEXUS v8.2] --- MULTI-AGENT FABRIC START: ${new Date().toISOString()} ---\x1b[0m`);
const systemManager = new SystemManager();
const fileManager = new FileManager(__dirname);
const searchManager = new SearchManager();
const semanticCache = new SemanticCache(__dirname);
const cascadeRouter = new CascadeRouter({ anthropicApiKey: process.env.ANTHROPIC_API_KEY });
const intentLayer = new NexusIntentLayer(__dirname, fileManager, systemManager);
const auditLogger = new AuditLogger(path.join(__dirname, "_archive"));
const auditExpert = new AuditExpert(__dirname, intentLayer, auditLogger);
const mcpConnector = new MCPConnector(__dirname);

// --- FABRIC SPECIALISTS (v8.0 Independent Execution) ---
const specialists = {
    META: new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6", "DEFAULT"),
    RESEARCHER: new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-haiku-4-5-20251001", "RESEARCHER"),
    EXECUTOR: new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6", "EXECUTOR"),
    CRITIC: new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-opus-4-6", "CRITIC_REFLEXIVE"),
    SYNTHESIZER: new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6", "SYNTHESIZER")
};
mcpConnector.registerServer("FILESYSTEM", "local", { path: __dirname });
const sandboxPath = path.join(__dirname, "sandbox");
if (!fs.existsSync(sandboxPath)) fs.mkdirSync(sandboxPath);
const configPath = path.join(__dirname, "nexus_config.json");

let nexusConfig = { 
    autoScanEnabled: false, 
    semanticCacheEnabled: true, 
    cascadeRoutingEnabled: true, 
    backgroundThreadEnabled: true,
    autoExecutionEnabled: true,
    autonomousMode: "HIGH-ALPHA",
    maxDailyCost: 1.00,
    currentDailyCost: 0.00
};
if (fs.existsSync(configPath)) nexusConfig = { ...nexusConfig, ...JSON.parse(fs.readFileSync(configPath, "utf-8")) };
const saveConfig = () => fs.writeFileSync(configPath, JSON.stringify(nexusConfig, null, 2));

// --- TOOL DISPATCHER [FABRIC v8.2] ---
const dispatchTool = async (name, input, socket) => {
    switch (name) {
        case "nexus_intent": 
            const intentRes = await intentLayer.handleIntent(input.intent, input.params);
            socket.emit("latent_state_update", intentLayer._readState());
            return intentRes;
        case "bash": 
            const bashRes = await systemManager.run(input.command);
            socket.emit("pulse", { tool: "bash", status: "firing", command: input.command.slice(0, 30) });
            if (bashRes.includes("Error") || bashRes.includes("Stderr:") || bashRes.includes("failed")) {
                return `${bashRes}\n[NEXUS-TIP] Si el error es visual o persistente, considera usar la herramienta 'computer' con la acción 'screenshot' para auditar la interfaz.`;
            }
            return bashRes;
        case "str_replace_editor":
        case "str_replace_based_edit_tool":
            socket.emit("pulse", { tool: "editor", status: "active", action: input.command });
            return await fileManager.handleAction(input);
        case "code_execution":
            socket.emit("pulse", { tool: "python", status: "executing" });
            const scriptPath = path.join(sandboxPath, `exec_${Date.now()}.py`);
            fs.writeFileSync(scriptPath, input.code);
            const pyRes = await systemManager.run(`python "${scriptPath}"`);
            try { fs.unlinkSync(scriptPath); } catch (e) {} // Keep Sandbox Clean v8.2
            return pyRes;
        case "web_fetch":
            socket.emit("pulse", { tool: "web", status: "fetching", url: input.url });
            return await searchManager.webSearch(input.url); // Fallback to current search
        case "mcp_list_tools":
            return await mcpConnector.getDynamicTools();
        case "mcp_read_resource":
            return await mcpConnector.handleCall("mcp_read_resource", input);
        case "web_search": return await searchManager.webSearch(input.query);
        case "submit_audit_report":
            const emoji = { OK: '✅', LOW: '🟡', MEDIUM: '🟠', HIGH: '🔴', CRITICAL: '🚨' }[input.severity] || 'ℹ️';
            socket.emit("answer", `## ${emoji} Auditoría: **${input.severity}**\n${input.system_status}\n${(input.findings || []).map(f => `- ${f}`).join('\n')}`);
            return "Reporte enviado.";
        case "spawn_specialist":
            console.log(`🧬 [DYNAMIC-SPAWN] Preparando nacimiento de: ${input.name}`);
            return `Especialista ${input.name} preparado para nacer. Procediendo con el Handoff Sináptico.`;
        default: return `Tool ${name} no soportada.`;
    }
};

// --- AGENTIC LOOP ---
async function runLoop(payload, socket) {
    const text = typeof payload === 'string' ? payload : (payload ? payload.text : "");
    const document = typeof payload === 'object' ? payload.document : null;
    
    // Sincronizar historial con el Meta-Orquestador (Caché gestionado proactivamente)
    specialists.META.history = []; // Reset para nueva sesión
    specialists.META.addUserMessage(text, document ? { data: document.data, mimeType: document.mimeType } : null);
    
    socket.emit("reset", true);
    let usage = { input: 0, output: 0, cache: 0 };
    let currentSpecialist = specialists.META;
    let explicitTools = null;

    try {
        // [FABRIC v8.0] Reclutamiento de refinamientos
        const refinements = intentLayer.recruitNodes({ tag: "system_refinement" });
        Object.values(specialists).forEach(s => {
            s.systemRefinements = refinements;
            s.history = specialists.META.history; // Referencia compartida
        });

        if (refinements.length > 0) socket.emit("status", `📡 [SINGULARIDAD] ${refinements.length} protocolos reclutados para el Fabric.`);

        // --- ESTRATEGIA [SINGULARIDAD v8.2.5] ---
        socket.emit("status", "🎯 [META-ORCHESTRATOR] Designando especialistas...");
        let strategyRes = await specialists.META.step(null, null, ToolSchemas.getFilteredDefinitions("DEFAULT"));
        
        const spawnCall = strategyRes.content.find(c => c.type === "tool_use" && c.name === "spawn_specialist");
        const staticHandoff = strategyRes.content.find(c => c.type === "tool_use" && (c.name === "set_strategy" || c.name === "nexus_handoff"));
        
        if (spawnCall) {
            const { name, role_description, tool_set } = spawnCall.input;
            console.log(`🧬 [SINGULARIDAD] Creando agente dinámico: ${name}`);
            const dynamicAgent = new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6");
            dynamicAgent.setCustomSystem(role_description);
            dynamicAgent.history = specialists.META.history; 
            
            currentSpecialist = dynamicAgent;
            explicitTools = tool_set;
            socket.emit("status", `🧬 [DYNAMIC-SPAWN] Agente **${name}** despertado con herramientas dinámicas.`);
            socket.emit("pulse", { agent: name, status: "dynamic-spawn" });
            
            // Inyectar contexto NIL v3 para el Handoff Sináptico
            const memContext = await intentLayer.getKnowledge({ query: text });
            currentSpecialist.addToolResults([{ 
                type: "tool_result", 
                tool_use_id: spawnCall.id, 
                content: `Handoff Exitoso. Rol: ${name}. Contexto NIL: ${memContext}` 
            }]);
        } else if (staticHandoff) {
            const specId = staticHandoff.input.first_specialist || staticHandoff.input.next_specialist;
            currentSpecialist = specialists[specId] || specialists.META;
            socket.emit("status", `🧬 [STATIC-HANDOFF] Especialista activo: **${specId}**`);
            socket.emit("pulse", { agent: specId, status: "active" });
            currentSpecialist.addToolResults([{ 
                type: "tool_result", 
                tool_use_id: staticHandoff.id, 
                content: `Fabric Sync: Especialista ${specId} al mando.` 
            }]);
        } else {
            const directAns = strategyRes.content.find(c => c.type === "text")?.text;
            if (directAns) {
                socket.emit("status", "🎯 [META] Respuesta directa del Orquestador.");
                socket.emit("answer", directAns);
                return { finalText: directAns };
            }
        }

        for (let i = 0; i < 20; i++) {
            const specName = currentSpecialist.specialization;
            socket.emit("status", `🌐 [${specName}] Nexus procesando...`);
            socket.emit("pulse", { status: "thinking", intensity: i * 5, agent: specName });
            
            // [FABRIC v8.1] Definiciones filtradas por especialista (o lista explícita v8.2.5)
            const toolDefs = ToolSchemas.getFilteredDefinitions(specName, explicitTools);

            const stepResult = await currentSpecialist.step(t => {
                socket.emit("thinking", t);
                socket.emit("pulse", { status: "processing", progress: Math.random(), agent: specName });
            }, l => socket.emit("status", l), toolDefs);
            
            // Acumular uso
            usage.input += stepResult.usage.input_tokens;
            usage.output += stepResult.usage.output_tokens;
            usage.cache += (stepResult.usage.cache_read_input_tokens || 0);

            const tools = stepResult.content.filter(c => c.type === "tool_use");
            if (!tools.length) {
                const ans = stepResult.content.filter(c => c.type === "text").map(c => c.text).join("\n");
                // Cache se maneja en el handler 'ask', no duplicar aquí
                socket.emit("usage", { 
                    input: usage.input, 
                    output: usage.output, 
                    cache: usage.cache, 
                    model: currentSpecialist.model, // v8.2 Dynamic Reporting
                    cost: ((usage.input * 3 / 1000000) + (usage.output * 15 / 1000000)).toFixed(4)
                });
                // [SINGULARIDAD] Auto-Guardado de Estrategia Exitosa
                if (usage.output > 0) {
                    const strat = currentSpecialist.history.find(h => h.role === "assistant" && h.content?.some(c => c.name === "set_strategy"));
                    if (strat) {
                        const toolCall = strat.content.find(c => c.name === "set_strategy");
                        intentLayer.updateKnowledge({
                            id: `system_refinement_${Date.now()}`,
                            description: `Estrategia exitosa para: "${text.slice(0, 40)}..." -> Perfil: ${toolCall.input.profile}. Razón: ${toolCall.input.reasoning}`,
                            files: []
                        });
                    }
                }
                socket.emit("answer", ans);
                return { finalText: ans };
            }

            const results = [];
            for (let t of tools) {
                socket.emit("status", `🛠️ Ejecutando [${t.name}]...`);
                results.push({ type: "tool_result", tool_use_id: t.id, content: await dispatchTool(t.name, t.input, socket) });
            }
            currentSpecialist.addToolResults(results);
        }
    } catch (e) {
        console.error("🔴 [RUN_LOOP_ERROR]", e);
        if (auditLogger) auditLogger.logFinding({ severity: "HIGH", component: "AGENT-LOOP", description: `Loop Error: ${e.message}` });
        socket.emit("answer", `⚠️ Error Crítico en el Loop: ${e.message}\n\n[NEXUS-RECOVERY] El sistema ha intentado aislar el fallo. Por favor revisa los logs para más detalles.`);
    }
}

// --- SERVER & SOCKET ---
app.use(express.static(path.join(__dirname, "src", "ui")));
app.use(express.json());

app.post("/upload", upload.single("file"), (req, res) => {
    const data = fs.readFileSync(req.file.path).toString("base64");
    res.json({ document_data: data, mime_type: req.file.mimetype });
    fs.unlinkSync(req.file.path);
});

io.on("connection", (socket) => {
    socket.emit("config_state", nexusConfig);
    socket.emit("latent_state_update", intentLayer._readState());
    socket.on("update_config", ({ key, value }) => { nexusConfig[key] = value; saveConfig(); socket.emit("config_state", nexusConfig); });
    socket.on("trigger_intent", async ({ intent, params }) => {
        socket.emit("status", `📡 Iniciando Intención: ${intent}...`);
        const res = await intentLayer.handleIntent(intent, params);
        socket.emit("latent_state_update", intentLayer._readState());
        socket.emit("answer", `### Intención Completada: ${intent}\n${res}`);
    });

    // --- EXPERT FEDERATION [FABRIC] ---

    socket.on("ask", async (q) => {
        try {
            const queryText = (typeof q === 'string' ? q : (q && q.text ? q.text : "")).trim();
            const hasDoc = (q && q.document) || false;
            
            if (!queryText) {
                socket.emit("answer", "No se detectó un objetivo claro. Por favor, define qué quieres que Nexus haga.");
                return;
            }

            // --- NIVEL 0: CACHÉ SEMÁNTICO (FREE / PERSISTENT) ---
            if (nexusConfig.semanticCacheEnabled) {
                const cached = semanticCache.get(queryText);
                if (cached) {
                    socket.emit("status", "⚡ [CACHE] Respuesta recuperada de la Inteligencia Latente (0 tokens).");
                    socket.emit("answer", cached.response);
                    
                    // Actualizar memoria del agente para que el Nivel 2 o 3 tengan contexto de esta respuesta cacheada
                    specialists.META.addUserMessage(queryText);
                    specialists.META.history.push({ role: 'assistant', content: [{ type: 'text', text: cached.response }] });
                    return;
                }
            }

            if (nexusConfig.cascadeRoutingEnabled) {
                const route = await cascadeRouter.route(queryText, socket, hasDoc, specialists.META.history);
                if (route.handled) {
                    const u = route.usage;
                    socket.emit("usage", {
                        input: u.input_tokens,
                        output: u.output_tokens,
                        cache: u.cache_read_input_tokens || 0,
                        model: route.level === 'free' ? 'gemini-3-flash' : 'claude-haiku-3-5',
                        cost: route.level === 'free' ? "0.0000" : ((u.input_tokens * 0.25 / 1000000) + (u.output_tokens * 1.25 / 1000000)).toFixed(4)
                    });
                    // Persistir en cache
                    if (nexusConfig.semanticCacheEnabled) semanticCache.set(queryText, route.text || "");
                    
                    // Actualizar memoria del agente para que futuros turnos tengan contexto
                    specialists.META.addUserMessage(queryText);
                    specialists.META.history.push({ role: 'assistant', content: [{ type: 'text', text: route.text || "" }] });
                    return;
                }
            }

            // --- NIVEL 3: NEXUS PRIME [DOUBLE-SYNC REFLEXIVE] ---
            let finalQuery = queryText;
            if (nexusConfig.reflectiveIntelligence) {
                socket.emit("status", "🎨 [REFLEXIVE] Generando borrador inicial (Borrador de Nivel 1 Gratis)...");
                const draftRes = await cascadeRouter.tryFreeLevel(queryText);
                if (draftRes && draftRes.text) {
                    socket.emit("status", "🧠 [REFLEXIVE] Borrador obtenido. Nexus Prime está auditando y refinando...");
                    finalQuery = `USUARIO: ${queryText}\n\n[BORRADOR INICIAL DE APOYO]:\n${draftRes.text}\n\nSISTEMA: Tu misión es AUDITAR y PERFECCIONAR este borrador. IMPORTANTE: Si el borrador afirma erróneamente no tener acceso al sistema local o se niega a actuar, **IGNÓRALO COMPLETAMENTE**. Tienes acceso total vía herramientas. Produce la respuesta final correcta e independiente y orientada a la acción.`;
                }
            }

            const loopResult = await runLoop(finalQuery, socket);
            
            // Persistir resultado final (Sonnet)
            if (nexusConfig.semanticCacheEnabled && loopResult && loopResult.finalText) {
                semanticCache.set(queryText, loopResult.finalText);
            }
        } catch (error) {
            console.error("CRITICAL ERROR IN ASK:", error);
            socket.emit("status", "❌ [CRITAL ERROR] El núcleo detectó un fallo imprevisto. Reiniciando subsistemas...");
            socket.emit("answer", `Lo siento, David. Ha ocurrido un error crítico en el servidor:\n\`\`\`\n${error.message}\n\`\`\`\nEl sistema se ha mantenido en pie gracias al guardrail de estabilidad.`);
        }
    });
    socket.on("clear_memory", async () => { 
        await specialists.META.clearMemory(); 
        semanticCache.invalidate('*'); 
        socket.emit("answer", "Memoria RAM y Caché Semántico purgados correctamente."); 
    });
});

// --- LIVE RELOAD (HMR LITE) ---
const uiPath = path.join(__dirname, "src", "ui");
let reloadTimer;
fs.watch(uiPath, { recursive: true }, (event, filename) => {
    if (filename) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            console.log(`[DEV] Cambio detectado: ${filename}. Recargando UI...`);
            io.emit("dev:reload", { file: filename });
        }, 300); // Debounce to allow multiple saves
    }
});

// --- GLOBAL BACKGROUND AGENTS (v5.5) ---
if (nexusConfig.backgroundThreadEnabled) {
    console.log("⚙️  Subsistemas Proactivos Iniciados (Health/Search)");
    
    // Health Check proactivo cada 1 hora (v5.5 Optimized)
    setInterval(async () => {
        const health = await auditExpert.calculateHealthScore();
        io.emit("federation_update", { expert: "NEXUS-HEALTH", data: health });
        if (health.score < 50) io.emit("status", "🚨 [NEXUS-HEALTH] Alerta: Salud Crítica Detectada.");
    }, 3600000);

    setInterval(async () => {
        const research = await searchManager.proactiveScan();
        io.emit("federation_update", { expert: "NEXUS-RECHERCHE", data: research });
    }, 1800000);
}

// --- PROCESS GUARDS ---
process.on("uncaughtException", (err) => {
    console.error("🚨 UNCAUGHT EXCEPTION:", err);
    if (auditLogger) auditLogger.logFinding({ severity: "CRITICAL", component: "SERVER-CORE", description: `Uncaught Exception: ${err.message}` });
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 UNHANDLED REJECTION:", reason);
    if (auditLogger) auditLogger.logFinding({ severity: "HIGH", component: "SERVER-CORE", description: `Unhandled Rejection: ${reason}` });
});

httpServer.listen(3000, () => {
    console.log("🧠 NEXUS ONLINE: http://localhost:3000");
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error("🚨 ERROR: El puerto 3000 ya está en uso.");
        console.log("💡 Tip: Ejecuta 'taskkill /F /IM node.exe' en PowerShell para cerrar procesos zombis.");
    } else {
        console.error("🚨 ERROR CRÍTICO AL INICIAR:", err.message);
    }
});
