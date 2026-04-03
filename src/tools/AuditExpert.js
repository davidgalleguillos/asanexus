import fs from "fs";
import path from "path";

export class AuditExpert {
    constructor(baseDir, intentLayer, logger = null) {
        this.baseDir = baseDir;
        this.intentLayer = intentLayer;
        this.logger = logger;
        this.lastScore = 100;
    }

    async calculateHealthScore() {
        const report = await this.intentLayer.handleIntent("VALIDATE_SYSTEM", {});
        let score = 100;
        const results = report.split("\n");
        const findings = [];
        
        results.forEach(r => {
            if (r.includes("[FAIL]")) {
                score -= 25;
                findings.push(r.replace("- [FAIL]", "").trim());
            }
        });

        // v6.0 Phase 3.1: Escaneo proactivo de Windows Event Logs (Errores/Warnings recientes)
        const eventCmd = 'powershell -Command "Get-WinEvent -LogName System -MaxEvents 5 -FilterXPath \'*[System[(Level=2 or Level=3)]]\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Message"';
        try {
            const events = await this.intentLayer.systemManager.run(eventCmd);
            if (events && events !== "OK" && !events.startsWith("Error") && !events.startsWith("⛔")) {
                const logs = events.split("\n").filter(l => l.trim().length > 0).slice(0, 3);
                logs.forEach(msg => {
                    score -= 10;
                    findings.push(`System Log: ${msg.slice(0, 100).trim()}...`);
                });
            }
        } catch (e) { /* silent fail if logs are restricted */ }

        if (!fs.existsSync(path.join(this.baseDir, "server.js"))) {
            score -= 50;
            findings.push("Archivo crítico faltante: server.js");
        }
        if (!fs.existsSync(path.join(this.baseDir, "package.json"))) {
            score -= 50;
            findings.push("Archivo crítico faltante: package.json");
        }

        // v6.0 Phase 3.2: Detección de Sinapsis Aisladas (Archivos huérfanos)
        try {
            const state = this.intentLayer._readState();
            const links = state.synaptic_links || [];
            const files = state.file_map || [];
            const isolated = files.filter(f => {
                const name = path.basename(f);
                return !links.some(l => l.source === name || l.target === name);
            }).filter(f => {
                const basename = path.basename(f);
                const isSystem = [".env", ".gitignore", "package-lock.json", "package.json", "LICENSE", "README.md"].includes(basename);
                const isAsset = f.includes("asa_logo") || f.includes("png") || f.includes("jpg") || f.includes("ico") || f.includes("vbs");
                const isUI = f.includes("src\\ui");
                return !isSystem && !isAsset && !isUI && !f.endsWith(".json") && !f.endsWith(".txt") && !f.endsWith(".md");
            });

            if (isolated.length > 0) {
                score -= 5;
                findings.push(`Sinapsis Aisladas: ${isolated.length} archivos huérfanos detectados (ej. ${path.basename(isolated[0])})`);
            }
        } catch (e) { /* ignore state errors */ }

        // v6.0 Phase 3.3: Detector de Módulos Pesados (> 500 líneas)
        try {
            const files = this.intentLayer._readState().file_map || [];
            const heavyModules = files.filter(f => {
                if (f.endsWith(".js") || f.endsWith(".html") || f.endsWith(".css")) {
                    const content = fs.readFileSync(path.join(this.baseDir, f), "utf-8");
                    return content.split("\n").length > 500;
                }
                return false;
            });

            if (heavyModules.length > 0) {
                findings.push(`Módulos Pesados: ${heavyModules.length} archivos exceden las 500 líneas (ej. ${path.basename(heavyModules[0])}). Considera refactorizar.`);
            }
        } catch (e) { /* ignore read errors */ }

        // v6.0 Phase 3.4: Auto-Reparación de Puertos (Iniciativa)
        try {
            const portCmd = 'powershell -Command "netstat -ano | findstr :3000"';
            const portInfo = await this.intentLayer.systemManager.run(portCmd);
            if (portInfo && portInfo.includes("LISTENING")) {
                const parts = portInfo.trim().split(/\s+/);
                const pid = parts[parts.length - 1]; // El PID es el último elemento en netstat -ano
                if (pid && pid !== "0" && pid !== process.pid.toString()) {
                    score -= 5;
                    findings.push(`Conflicto de Puerto: Proceso PID ${pid} ocupando el puerto 3000. Intentando liberación...`);
                    await this.intentLayer.systemManager.run(`taskkill /F /PID ${pid}`);
                    findings.push(`Auto-Reparación: Puerto 3000 liberado (PID ${pid} finalizado).`);
                }
            }
        } catch (e) { /* silent if fail */ }

        // v6.0 Phase 1.5: Error Density Monitor (Sentidos)
        try {
            const logPath = path.join(this.baseDir, "nexus_log.txt");
            if (fs.existsSync(logPath)) {
                const logs = fs.readFileSync(logPath, "utf-8").split("\n").slice(-50);
                const errorCount = logs.filter(l => l.includes("⚠️") || l.includes("⛔") || l.includes("Error:")).length;
                if (errorCount > 3) {
                    score -= 10;
                    findings.push(`Instabilidad Operativa: ${errorCount} alertas detectadas en los últimos 50 registros de log.`);
                }
            }
        } catch (e) { /* log read error */ }

        // v6.0 Phase 3.5: Guardián de Cobertura (Iniciativa)
        try {
            const files = this.intentLayer._readState().file_map || [];
            const srcFiles = files.filter(f => f.includes("src\\") && f.endsWith(".js") && !f.endsWith(".test.js"));
            const missingTests = srcFiles.filter(f => {
                const testFile = f.replace(".js", ".test.js");
                return !files.includes(testFile);
            });

            if (missingTests.length > 5) {
                score -= 5;
                findings.push(`Cobertura de Tests: ${missingTests.length} módulos en /src no tienen pruebas unitarias (.test.js).`);
            }
        } catch (e) { /* test check error */ }

        // v6.0 Phase 1.6: Budget Watcher (Sentidos)
        try {
            const configPath = path.join(this.baseDir, "nexus_config.json");
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                const usage = (config.currentDailyCost / config.maxDailyCost) * 100;
                if (usage >= 80) {
                    findings.push(`Presupuesto Crítico: Has consumido el ${usage.toFixed(1)}% de tu límite diario ($${config.maxDailyCost}).`);
                }
            }
        } catch (e) { /* config read error */ }

        this.lastScore = Math.max(0, score);
        const status = this.lastScore > 80 ? "EXCELLENT" : (this.lastScore > 50 ? "DEGRADED" : "CRITICAL");

        if (this.logger && findings.length > 0) {
            for (const desc of findings) {
                await this.logger.logFinding({
                    severity: this.lastScore < 50 ? "CRITICAL" : "HIGH",
                    component: "NEXUS-HEALTH",
                    description: desc
                });
            }
        }

        return {
            score: this.lastScore,
            status,
            timestamp: new Date().toISOString(),
            findings
        };
    }
}
