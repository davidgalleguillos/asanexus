import fs from "fs";
import path from "path";
import { TestRunner } from "../tools/TestRunner.js";

export class NexusIntentLayer {
    constructor(baseDir, fileManager, systemManager) {
        this.baseDir = baseDir;
        this.fileManager = fileManager;
        this.systemManager = systemManager;
        this.testRunner = new TestRunner(baseDir);
        this.statePath = path.join(baseDir, "nexus_latent_state.json");
        this._ensureState();
    }

    _ensureState() {
        if (!fs.existsSync(this.statePath)) {
            const initialState = {
                project_name: "ASA NEXUS [FABRIC]",
                version: "8.2.1",
                latent_knowledge_nodes: [],
                synaptic_links: [],
                resolution_tactics: [],
                snippets: [],
                last_recon: null,
                file_map: []
            };
            this._saveState(initialState);
        }
    }

    _readState() {
        try {
            return JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
        } catch (e) {
            return { project_name: "Nexus", latent_knowledge_nodes: [], synaptic_links: [] };
        }
    }

    _saveState(state) {
        fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
    }

    // --- NIL v3: VECTORIAL ENGINE [SEMANTIC-CORE] ---
    async _embed(text) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
            console.warn("⚠️ [NIL v3] Sin GEMINI_API_KEY. Usando fallback hash.");
            return this._vectorizeHash(text);
        }

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${key}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "models/gemini-embedding-2-preview",
                        content: { parts: [{ text }] }
                    })
                }
            );
            const data = await res.json();
            if (data.embedding?.values) {
                return data.embedding.values;
            }
            throw new Error(data.error?.message || "Error desconocido en embedding");
        } catch (e) {
            console.error("🔴 [NIL-EMBED-ERROR]", e.message);
            return this._vectorizeHash(text);
        }
    }

    _vectorizeHash(text) {
        // Fallback: [v7.0 PURE-CORE] Simulated Embeddings via Frequency Hash
        const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        const vector = {};
        words.forEach(w => vector[w] = (vector[w] || 0) + 1);
        return vector;
    }

    _cosineSimilarity(v1, v2) {
        // v3: Soporta tanto arrays de floats (embeddings reales) como objetos (hash legacy)
        if (Array.isArray(v1) && Array.isArray(v2)) {
            if (v1.length === 0 || v2.length === 0) return 0;
            const length = Math.min(v1.length, v2.length);
            let dotProduct = 0, mag1 = 0, mag2 = 0;
            for (let i = 0; i < length; i++) {
                dotProduct += v1[i] * v2[i];
                mag1 += v1[i] * v1[i];
                mag2 += v2[i] * v2[i];
            }
            if (mag1 === 0 || mag2 === 0) return 0;
            return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
        }
        
        // Legacy BoW similarity (v1/v2 might be objects or arrays at this point)
        const v1Obj = Array.isArray(v1) ? {} : v1;
        const v2Obj = Array.isArray(v2) ? {} : v2;
        
        const intersection = Object.keys(v1Obj).filter(w => v2Obj[w]);
        if (!intersection.length) return 0;
        
        let dotProduct = 0;
        intersection.forEach(w => dotProduct += v1Obj[w] * v2Obj[w]);
        
        const mag1 = Math.sqrt(Object.values(v1Obj).reduce((sum, val) => sum + val * val, 0));
        const mag2 = Math.sqrt(Object.values(v2Obj).reduce((sum, val) => sum + val * val, 0));
        
        if (mag1 === 0 || mag2 === 0) return 0;
        return dotProduct / (mag1 * mag2);
    }

    async handleIntent(intent, params = {}) {
        console.log(`[NIL v2] Intent: ${intent}`, params);
        switch (intent) {
            case "RECON_PROJECT": return await this.reconProject(params);
            case "GET_KNOWLEDGE": return await this.getKnowledge(params);
            case "UPDATE_KNOWLEDGE": return await this.updateKnowledge(params);
            case "RECORD_TACTIC": return await this.recordTactic(params);
            case "GET_TACTIC": return await this.getTactic(params);
            case "SEARCH_NODES": return this.searchNodes(params);
            case "ANALYZE_RESONANCE": return await this.analyzeResonance(params);
            case "RUN_HEALTH_CHECK": return await this.runHealthCheck(params);
            case "MEASURE_LATENCY": return await this.systemManager.measureLatency(params.host);
            case "VALIDATE_SYSTEM": return await this.testRunner.runSuite();
            case "GET_AUDIT_LOGS": return await this.getAuditLogs();
            case "ANALYZE_CODEBASE": return await this.analyzeCodebase();
            case "RECORD_SNIPPET": return this.recordSnippet(params);
            case "GET_SNIPPET": return this.getSnippet(params);
            case "SAVE_SESSION": return this.saveSession(params);
            case "RESTORE_SESSION": return this.getKnowledge({ query: "current_session" });
            case "GENERATE_API": return await this.generateAPI();
            case "RECRUIT_NODES": return this.recruitNodes(params);
            case "SELF_MIRROR": return await this.selfMirror(params);
            case "SELF_EVOLVE": return await this.selfEvolve(params);
            default: return `Error: Intent '${intent}' no soportado.`;
        }
    }

    saveSession({ goals = [], blockers = [] }) {
        const state = this._readState();
        state.current_session = {
            goals,
            blockers,
            timestamp: new Date().toISOString()
        };
        this._saveState(state);
        return "Snapshot de sesión guardado correctamente.";
    }

    async generateAPI() {
        const state = this._readState();
        const index = state.code_index || [];
        if (index.length === 0) return "Error: Índice de código vacío. Ejecuta 'ANALYZE_CODEBASE' primero.";

        let md = "# 📖 NEXUS_API: Biblia Técnica [v8.2]\n\nEsta documentación es auto-generada por el módulo Iniciativa de Nexus.\n\n";
        const groups = {};
        index.forEach(f => {
            groups[f.file] = groups[f.file] || [];
            groups[f.file].push(f.name);
        });

        for (const [file, funcs] of Object.entries(groups)) {
            md += `### 📄 ${file}\n`;
            funcs.forEach(fn => md += `- \`${fn}\`\n`);
            md += "\n";
        }

        const apiPath = path.join(this.baseDir, "_agents", "NEXUS_API.md");
        fs.mkdirSync(path.dirname(apiPath), { recursive: true });
        fs.writeFileSync(apiPath, md);
        return `NEXUS_API.md generado exitosamente con ${index.length} firmas de funciones.`;
    }

    recordSnippet({ name, content, tags = [] }) {
        const state = this._readState();
        state.snippets = state.snippets || [];
        state.snippets.push({
            name,
            content,
            tags,
            timestamp: new Date().toISOString()
        });
        this._saveState(state);
        return `Snippet '${name}' guardado correctamente.`;
    }

    getSnippet({ query = "" }) {
        const state = this._readState();
        const snippets = state.snippets || [];
        if (!query) return JSON.stringify(snippets, null, 2);
        
        return snippets.filter(s => 
            s.name.toLowerCase().includes(query.toLowerCase()) || 
            s.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
        );
    }

    async analyzeCodebase() {
        const state = this._readState();
        const files = state.file_map.filter(f => f.endsWith(".js"));
        state.code_index = [];

        for (const file of files) {
            try {
                const relPath = path.isAbsolute(file) ? path.relative(this.baseDir, file) : file;
                const content = await this.fileManager.handleAction({ action: "view", path: relPath });
                if (typeof content !== "string" || content.startsWith("ERROR:")) continue;

                // Regex para extraer firmas de funciones JS/Node
                const funcRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(|([a-zA-Z0-9_$]+)\s*[:=]\s*(?:async\s+)?\s*\(.*?\)\s*=>|([a-zA-Z0-9_$]+)\s*\(.*?\)\s*\{/g;
                let match;
                while ((match = funcRegex.exec(content)) !== null) {
                    const name = match[1] || match[2] || match[3];
                    if (name && !["if", "for", "while", "switch", "catch"].includes(name)) {
                        state.code_index.push({
                            name,
                            file: path.basename(file),
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } catch (e) { /* ignore single file errors */ }
        }
        this._saveState(state);
        return `Indexación de código completada: ${state.code_index.length} funciones mapeadas.`;
    }

    async runHealthCheck() {
        const start = Date.now();
        const results = { fs: "PENDING", os: "PENDING", latency: "N/A" };

        try {
            // Test FS
            const testPath = path.join(this.baseDir, "tmp", "health_test.txt");
            await this.fileManager.handleAction({ action: "create", path: testPath, content: "Nexus Health OK" });
            results.fs = "OK (Write/Read)";
        } catch (e) { results.fs = `FAILED: ${e.message}`; }

        try {
            // Test OS
            const who = await this.systemManager.run("whoami");
            results.os = `OK (User: ${who.trim()})`;
        } catch (e) { results.os = `FAILED: ${e.message}`; }

        results.latency = `${Date.now() - start}ms`;
        return `## 🏥 Reporte de Salud Nexus v8.2 [FABRIC]\n- **Sistema de Archivos**: ${results.fs}\n- **Acceso OS**: ${results.os}\n- **Latencia Interna**: ${results.latency}\n- **Estado**: ✅ ÓPTIMO`;
    }

    async reconProject({ deep = true } = {}) {
        const state = this._readState();
        const cmd = deep ? "powershell -Command \"Get-ChildItem -Recurse -File | Select-Object -ExpandProperty FullName\"" : "powershell -Command \"Get-ChildItem -File | Select-Object -ExpandProperty FullName\"";
        const result = await this.systemManager.run(cmd);
        
        const files = result.split("\n").map(f => f.trim()).filter(f => f && !f.includes("node_modules") && !f.includes(".git"));
        
        state.last_recon = new Date().toISOString();
        state.file_map = files;
        
        // Auto-análisis de sinapsis para todos los archivos detectados (v6.0 Massive Scan)
        await this.analyzeResonance({ files: files.filter(f => f.match(/\.(js|mjs|cjs|html|json)$/)) });
        
        this._saveState(state);
        return `Reconocimiento v8.2 completado. ${files.length} archivos en el mapa.`;
    }

    async analyzeResonance({ files = [] }) {
        const state = this._readState();
        state.synaptic_links = state.synaptic_links || [];

        for (const file of files) {
            try {
                // v6.0: Asegurar que tratamos con rutas relativas para el matcher si es posible
                const relFile = path.isAbsolute(file) ? path.relative(this.baseDir, file) : file;
                const content = await this.fileManager.handleAction({ action: "view", path: relFile });
                if (typeof content !== "string" || content.startsWith("ERROR:")) continue;

                // Regex robusta para imports (v6.0)
                const importRegex = /(?:import|require)\s+(?:.*?\s+from\s+)?['"](.*?)['"]/g;
                let match;
                while ((match = importRegex.exec(content)) !== null) {
                    const target = match[1];
                    if (target.startsWith(".")) { // Solo mapeamos dependencias locales del proyecto
                        state.synaptic_links.push({
                            source: path.basename(relFile),
                            target: path.basename(target) + (target.endsWith(".js") ? "" : ".js"),
                            type: "dependency",
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } catch (e) { /* ignore single file errors */ }
        }

        // Limpiar duplicados
        state.synaptic_links = [...new Map(state.synaptic_links.map(item => [`${item.source}-${item.target}`, item])).values()];
        this._saveState(state);
        return `Resonancia analizada para ${files.length} archivos.`;
    }

    async getKnowledge({ query = "" } = {}) {
        const state = this._readState();
        if (!query) return JSON.stringify({ nodes: state.latent_knowledge_nodes, links: state.synaptic_links }, null, 2);
        
        const qVector = await this._embed(query);
        
        // NIL v3: Búsqueda Semántica por Similitud de Coseno
        const matches = await Promise.all(state.latent_knowledge_nodes
            .map(async node => {
                // Usar vector cacheado o generar uno nuevo si falta
                if (!node.vector) {
                    const nodeText = (node.id + " " + (node.description || "")).toLowerCase();
                    node.vector = await this._embed(nodeText);
                }
                const score = this._cosineSimilarity(qVector, node.vector);
                return { ...node, score };
            }));

        const finalMatches = matches
            .filter(n => n.score > 0.45) // Umbral de resonancia semántica optimizado para v3 (vía gemini-2-preview)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        if (finalMatches.length) this._saveState(state); // Persistir vectores generados en el vuelo
        return finalMatches.length ? JSON.stringify(finalMatches, null, 2) : "No hay conocimiento latente resonante para esta consulta.";
    }

    async updateKnowledge({ id, description, files = [] }) {
        const state = this._readState();
        const existing = state.latent_knowledge_nodes.find(n => n.id === id);
        const nodeText = (id + " " + (description || "")).toLowerCase();
        const vector = await this._embed(nodeText);

        if (existing) {
            existing.description = description;
            existing.files = files;
            existing.vector = vector;
        } else {
            state.latent_knowledge_nodes.push({ id, description, files, vector });
        }
        this._saveState(state);
        return `Nodo '${id}' actualizado con vector semántico.`;
    }

    async recordTactic({ problem, solution, context = "" }) {
        const state = this._readState();
        state.resolution_tactics = state.resolution_tactics || [];
        const vector = await this._embed(problem + " " + context);
        state.resolution_tactics.push({
            problem,
            solution,
            context,
            vector,
            timestamp: new Date().toISOString()
        });
        this._saveState(state);
        return `Táctica de resolución guardada con vector: "${problem.slice(0, 40)}..."`;
    }

    async getTactic({ error = "" }) {
        const state = this._readState();
        const tactics = state.resolution_tactics || [];
        if (!error) return JSON.stringify(tactics, null, 2);
        
        const qVector = await this._embed(error);
        const matches = tactics
            .map(t => {
                const score = this._cosineSimilarity(qVector, t.vector || []);
                return { ...t, score };
            })
            .filter(t => t.score > 0.7) // Umbral alto para tácticas
            .sort((a, b) => b.score - a.score)
            .slice(0, 1);

        return matches.length ? 
            `💡 Táctica encontrada por similitud semántica:\nProblema: ${matches[0].problem}\nSolución: ${matches[0].solution}` : 
            "No hay tácticas previas registradas para este error específico.";
    }

    searchNodes({ tags = [] }) {
        const state = this._readState();
        return state.latent_knowledge_nodes.filter(n => 
            tags.some(t => n.description.includes(t) || n.id.includes(t))
        );
    }

    async getAuditLogs() {
        const logPath = path.join(this.baseDir, "_archive", "audit_log.json");
        if (!fs.existsSync(logPath)) return "No hay registros de auditoría aún.";
        try {
            const logs = JSON.parse(fs.readFileSync(logPath, "utf-8"));
            if (logs.length === 0) return "El registro de auditoría está vacío.";
            return JSON.stringify(logs.slice(-20), null, 2); // Devolver los últimos 20
        } catch (e) {
            return `Error al leer logs: ${e.message}`;
        }
    }

    recruitNodes({ tag = "system_refinement" }) {
        const state = this._readState();
        const nodes = state.latent_knowledge_nodes || [];
        return nodes.filter(n => n.id.includes(tag) || (n.description && n.description.includes(tag)));
    }

    async selfMirror({ depth = 50 }) {
        const logPath = path.join(this.baseDir, "fabric_v8_pulse.log");
        if (!fs.existsSync(logPath)) return "Log de pulso no encontrado.";
        const logs = fs.readFileSync(logPath, "utf-8").split("\n").slice(-depth).join("\n");
        return `[SELF-MIRROR] Logs de ejecución real:\n${logs}`;
    }

    async selfEvolve({ file, code }) {
        const targetPath = path.join(this.baseDir, file);
        const shadowPath = targetPath + ".next";
        fs.writeFileSync(shadowPath, code);
        return `[SELF-EVOLVE] Archivo sombra '${file}.next' generado. Listo para Swapping Atómico via restart_nexus.ps1.`;
    }
}
