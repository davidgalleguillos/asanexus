import fs from "fs";
import path from "path";

export class FileManager {
    constructor(baseDir) {
        this.baseDir = baseDir;
    }

    _resolve(file) {
        // [v5.6.3] Normalización de rutas WSL a Windows para evitar Falsos Positivos de Traversal
        let normalized = file.replace(/^\/mnt\/([a-z])\//i, '$1:\\').replace(/\//g, '\\');
        
        const resolved = path.resolve(this.baseDir, normalized);
        if (!resolved.startsWith(path.resolve(this.baseDir))) {
            throw new Error(`ACCESO DENEGADO: Intento de Path Traversal detectado en '${file}' (Resuelto: '${resolved}')`);
        }
        return resolved;
    }

    async handleAction({ action, path: file, content, old_str, new_str, insert_line }) {
        const fullPath = this._resolve(file);
        try {
            switch (action) {
                case "view": 
                    return fs.readFileSync(fullPath, "utf-8");
                case "create": 
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, content);
                    return `SUCCESS: Created ${fullPath}`;
                case "str_replace": 
                    let text = fs.readFileSync(fullPath, "utf-8");
                    if (!text.includes(old_str)) return "ERROR: old_str not found.";
                    const newText = text.split(old_str).join(new_str);
                    fs.writeFileSync(fullPath, newText);
                    return `SUCCESS: Modified ${fullPath}`;
                case "insert": 
                    let lines = fs.readFileSync(fullPath, "utf-8").split("\n");
                    lines.splice(insert_line || lines.length, 0, content);
                    fs.writeFileSync(fullPath, lines.join("\n"));
                    return `SUCCESS: Inserted into ${fullPath}`;
                case "list":
                    const list = fs.readdirSync(fullPath, { withFileTypes: true });
                    return list.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join("\n");
                default: 
                    return "ERROR: Action not supported.";
            }
        } catch (e) {
            return `ERROR: ${e.message}`;
        }
    }
}
