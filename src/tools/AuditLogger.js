import fs from "fs";
import path from "path";

export class AuditLogger {
    constructor(archiveDir) {
        this.archiveDir = archiveDir;
        this.logPath = path.join(archiveDir, "audit_log.json");
        this._ensureLogFile();
    }

    _ensureLogFile() {
        if (!fs.existsSync(this.archiveDir)) {
            fs.mkdirSync(this.archiveDir, { recursive: true });
        }
        if (!fs.existsSync(this.logPath)) {
            fs.writeFileSync(this.logPath, JSON.stringify([], null, 2));
        }
    }

    async logFinding({ severity, component, description, context = {} }) {
        const finding = {
            id: `AUDIT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            timestamp: new Date().toISOString(),
            severity,
            component,
            description,
            context
        };

        try {
            const logs = JSON.parse(fs.readFileSync(this.logPath, "utf-8"));
            logs.push(finding);
            fs.writeFileSync(this.logPath, JSON.stringify(logs, null, 2));
            console.log(`[AUDIT-LOG] Guardado hallazgo en ${this.logPath}`);
            return finding;
        } catch (error) {
            console.error("[AUDIT-LOG] Error al escribir log:", error);
            return null;
        }
    }

    async getHistory() {
        try {
            return JSON.parse(fs.readFileSync(this.logPath, "utf-8"));
        } catch (e) {
            return [];
        }
    }
}
