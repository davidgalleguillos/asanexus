import { exec } from "child_process";

export class SearchManager {
    constructor() {
        this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
    }

    async run(cmd) {
        return new Promise((resolve) => {
            exec(cmd, (err, stdout) => {
                resolve(err ? `Error: ${err.message}` : stdout);
            });
        });
    }

    async webSearch(query) {
        const safeQuery = query.replace(/'/g, "''"); // Escape for PS
        const ps = `
            $url = 'https://www.google.com/search?q=${encodeURIComponent(safeQuery)}';
            $page = Invoke-WebRequest -Uri $url -UserAgent '${this.userAgent}';
            $content = $page.Content -replace '<[^>]*>', ' ' -replace '\\s+', ' ';
            $content.Substring(0, [Math]::Min(3000, $content.Length))
        `;
        return this.run(`powershell -Command "${ps.trim()}"`);
    }

    async wikipediaSearch(term) {
        const url = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            return data.extract || "No se encontró información en Wikipedia.";
        } catch (e) {
            return `Error de red: ${e.message}`;
        }
    }

    async proactiveScan(topic = "Anthropic API update 2026") {
        console.log(`📡 [NEXUS-RECHERCHE] Escaneando novedades sobre: ${topic}...`);
        const raw = await this.webSearch(topic);
        // Basic extraction of snippets (headless/gratis)
        const lines = raw.split('.').slice(0, 3).join('. ');
        return {
            topic,
            summary: lines.length > 50 ? lines : "No se detectaron cambios críticos hoy.",
            timestamp: new Date().toISOString()
        };
    }
}
