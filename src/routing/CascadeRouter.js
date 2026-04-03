/**
 * 🚦 CascadeRouter — Enrutamiento en Cascada v1.0
 * [TOKEN SAVING v1.4]
 *
 * Arquitectura de 3 niveles (intentar el más barato primero):
 *
 *   NIVEL 1 — GRATIS ($0):
 *     Gemini 2.0 Flash Lite (Google AI Studio, 1500 req/día gratis)
 *     DuckDuckGo Instant Answers API (sin auth, sin límite)
 *     Wikipedia REST API (sin auth, sin límite, ES + EN)
 *
 *   NIVEL 2 — NORMAL ($0.25/1M tokens):
 *     Claude Haiku 3.5 — respuesta de texto simple, sin tools, sub-segundo
 *
 *   NIVEL 3 — PREMIUM (pasa el control al loop agentico completo):
 *     Claude Sonnet 4.6 + herramientas + computer use
 *     (todo lo que ya tenía ASA Nexus)
 *
 * Lógica de escalado:
 *   - Si la respuesta libre tiene < MIN_LENGTH chars → escalar
 *   - Si contiene marcadores de error/desconocimiento → escalar
 *   - Si la query tiene patrones de TAREA (ejecuta, crea, edita...) → ir directo a Premium
 *
 * El router NO reemplaza nada — si retorna { handled: false }, el flujo
 * sigue exactamente igual que antes (handleAgenticLoop completo).
 */

import Anthropic from '@anthropic-ai/sdk';

// Referencia local a TOKEN_LIMITS sin importar AgentCore entero (evitar circular deps)
const AgentCore_TOKEN_LIMITS = {
    synthesis: { max_tokens: 2048 }
};

export class CascadeRouter {
    static FAILED_MODELS = new Set();
    static HAIKU_FALLBACKS = ["claude-haiku-4-5-20251001", "claude-3-haiku-20240307"];

    constructor({ anthropicApiKey, geminiApiKey = null }) {
        this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
        this.geminiApiKey = geminiApiKey;
        this.stats = { free: 0, normal: 0, premium: 0, bypassed: 0, total: 0 };

        // Mínimo de caracteres para considerar una respuesta "suficiente"
        this.MIN_RESPONSE_LENGTH = 80;

        // Patrones que indican TAREA con efectos en el sistema → saltar directo a Premium
        this.SYSTEM_TASK_PATTERNS = [
            'ejecuta', 'run', 'abre', 'open', 'crea un', 'create', 'elimina', 'borra', 'delete',
            'instala', 'install', 'configura', 'configure', 'modifica', 'modify', 'edita', 'edit',
            'programa', 'code', 'script', 'reinicia', 'restart', 'diagnosa', 'escanea', 'scan',
            'haz un', 'arregla', 'fix', 'repara', 'mueve', 'move', 'copia', 'copy', 'descarga',
            'download', 'actualiza', 'update', 'listame', 'muéstrame los archivos', 'show files',
            'analiza', 'investiga', 'revisa', 'lee ', 'audita', 'explora', 'grep'
        ];

        // Patrones que SUGIEREN consulta de información → candidato ideal para Nivel 1
        this.INFO_QUERY_PATTERNS = [
            'qué es', 'que es', 'what is', 'what are', 'cómo funciona', 'como funciona',
            'how does', 'how do', 'cuándo', 'when', 'quién', 'who', 'dónde', 'where',
            'cuánto cuesta', 'precio de', 'price of', 'define ', 'definición', 'definition',
            'explica', 'explain', 'dame información', 'tell me about', 'información sobre',
            'qué diferencia', 'what difference', 'por qué', 'why', 'cuál es', 'which is'
        ];

        // Marcadores que indican respuesta insuficiente (el nivel falló)
        this.INSUFFICIENT_MARKERS = [
            'no encontré', 'not found', 'no puedo', "i can't", 'lo siento, no',
            'sorry, i', 'i apologize', 'no tengo información', 'no information',
            'error:', 'undefined', '404', 'no results', 'sin resultados',
            'i don\'t know', 'no sé', 'no lo sé', 'desconozco'
        ];
    }

    // ─────────────────────────────────────────────
    // CLASIFICADOR DE QUERIES
    // ─────────────────────────────────────────────

    /**
     * Clasifica la intención de la query.
     * @returns {'system_task' | 'info_query' | 'ambiguous'}
     */
    classifyQuery(text) {
        if (!text || typeof text !== 'string') return 'ambiguous';
        const q = text.toLowerCase();

        // [v5.6.1] Detección de rutas (Windows/Unix/Relativas) → Premium Directo
        const pathRegex = /([a-z]:\\|^\.|^\/|^~)/i;
        if (pathRegex.test(q)) return 'system_task';

        if (this.SYSTEM_TASK_PATTERNS.some(p => q.includes(p))) {
            return 'system_task';  // → Nivel 3 directamente
        }
        if (this.INFO_QUERY_PATTERNS.some(p => q.includes(p))) {
            return 'info_query';   // → Intentar desde Nivel 1
        }
        return 'ambiguous';        // → Intentar desde Nivel 2 (Haiku)
    }

    // ─────────────────────────────────────────────
    // EVALUADOR DE SUFICIENCIA
    // ─────────────────────────────────────────────

    isSufficient(response) {
        if (!response || typeof response !== 'string') return false;
        const trimmed = response.trim();
        // v8.2: Permitir respuestas técnicas cortas si no contienen marcadores de insuficiencia
        if (trimmed.length < this.MIN_RESPONSE_LENGTH) {
            const isTechnical = /^[a-zA-Z0-9_/\\:.\s]{2,50}$/.test(trimmed);
            if (!isTechnical) return false;
        }
        const lower = response.toLowerCase();
        return !this.INSUFFICIENT_MARKERS.some(m => lower.includes(m));
    }

    // ─────────────────────────────────────────────
    // NIVEL 1 — FUENTES GRATUITAS
    // ─────────────────────────────────────────────

    async callGemini(query) {
        if (!this.geminiApiKey) return null;
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${this.geminiApiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: query }] }],
                        generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
                    }),
                    signal: AbortSignal.timeout(8000)
                }
            );
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log(`🌐 [Gemini L1] ${text ? 'OK' : 'Vacío'}`);
            return text || null;
        } catch (e) {
            console.warn(`⚠️ [Gemini L1] Falló: ${e.message}`);
            return null;
        }
    }

    async callDuckDuckGo(query) {
        try {
            const res = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
                { signal: AbortSignal.timeout(5000) }
            );
            const data = await res.json();
            const text = data.AbstractText || data.Answer || '';
            console.log(`🦆 [DuckDuckGo L1] ${text.length > 20 ? 'OK' : 'Vacío'}`);
            return text.length > 20 ? `[DuckDuckGo]: ${text}` : null;
        } catch (e) {
            console.warn(`⚠️ [DuckDuckGo L1] Falló: ${e.message}`);
            return null;
        }
    }

    async callWikipedia(query) {
        // Extrae el término clave (primeras 4 palabras)
        const term = query.split(' ').slice(0, 4).join(' ');
        for (const lang of ['es', 'en']) {
            try {
                const res = await fetch(
                    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
                    { signal: AbortSignal.timeout(5000) }
                );
                if (!res.ok) continue;
                const data = await res.json();
                if (data.extract && data.extract.length > 50) {
                    console.log(`📖 [Wikipedia L1] OK (${lang}): ${data.title}`);
                    return `[Wikipedia — ${data.title}]: ${data.extract}`;
                }
            } catch (e) { /* continúa con el siguiente idioma */ }
        }
        console.warn(`⚠️ [Wikipedia L1] Sin resultados para: "${term}"`);
        return null;
    }

    /**
     * Intenta responder desde fuentes gratuitas en paralelo.
     * Retorna el primero que lo logre, o null si todos fallan.
     */
    async tryFreeLevel(query) {
        // v5.5 Optimization: All free engines in parallel (P5)
        const [geminiResult, ddgResult, wikiResult] = await Promise.all([
            this.geminiApiKey ? this.callGemini(query) : Promise.resolve(null),
            this.callDuckDuckGo(query),
            this.callWikipedia(query)
        ]);

        if (this.isSufficient(geminiResult)) return { text: geminiResult, source: 'Gemini Flash' };
        if (this.isSufficient(ddgResult)) return { text: ddgResult, source: 'DuckDuckGo' };
        if (this.isSufficient(wikiResult)) return { text: wikiResult, source: 'Wikipedia' };

        return null;
    }

    // ─────────────────────────────────────────────
    // NIVEL 2 — CLAUDE HAIKU (barato, sin tools)
    // ─────────────────────────────────────────────

    async tryHaikuLevel(query, history = []) {
        const candidates = CascadeRouter.HAIKU_FALLBACKS.filter(m => !CascadeRouter.FAILED_MODELS.has(m));
        
        for (const m of candidates) {
            try {
                console.log(`🔵 [Haiku L2] Intentando con ${m}...`);
                // Scrubbing history to remove 'thinking' blocks that crash legacy models (Haiku 3)
                const scrubbedHistory = history.map(msg => {
                    if (msg.role === "assistant" && Array.isArray(msg.content)) {
                        const cleaned = msg.content
                            .filter(c => c.type !== "thinking")
                            .map(c => { 
                                if (c.type === "text") { const { signature, ...rest } = c; return rest; }
                                return c;
                            });
                        return { ...msg, content: cleaned.length > 0 ? cleaned : [{ type: "text", text: "[razonamiento omitido]" }] };
                    }
                    return msg;
                }).filter(msg => {
                    if (msg.role === "assistant" && Array.isArray(msg.content)) return msg.content.length > 0;
                    return true;
                });

                const res = await this.anthropic.messages.create({
                    model: m,
                    max_tokens: m.includes("haiku-20240307") || m.includes("4-1") || m.includes("4-20250514") ? 4096 : 8192,
                    temperature: 0.3,
                    stop_sequences: ['</respuesta>', '[FIN]'],
                    system: 'Eres un asistente técnico experto y conciso integrado en ASA Nexus. Responde de forma directa y precisa en el idioma del usuario. Si la pregunta requiere ejecutar comandos o acceder a archivos del sistema, responde exactamente: "ESCALANDO_A_PREMIUM" y nada más.',
                    messages: [...scrubbedHistory, { role: 'user', content: query }]
                });
                const text = res.content[0]?.text || null;
                const usage = res.usage;
                if (text === 'ESCALANDO_A_PREMIUM') {
                    console.log(`🔵 [Haiku L2] ${m} solicitó escalar a Premium.`);
                    return null;
                }
                console.log(`🔵 [Haiku L2] ${m}: ${this.isSufficient(text) ? 'OK' : 'Insuficiente'}`);
                return this.isSufficient(text) ? { text, usage } : null;
            } catch (e) {
                const errorMsg = e.message || 'Unknown Error';
                if (errorMsg.includes('404') || errorMsg.includes('not_found_error') || errorMsg.includes('400')) {
                    console.warn(`⚠️ [RELAY] Modelo [${m}] no disponible. Saltando al siguiente...`);
                    CascadeRouter.FAILED_MODELS.add(m);
                } else {
                    console.warn(`⚠️ [Haiku L2] Falló (${m}): ${errorMsg}`);
                    return null; // Error no recuperable vía relay (ej. Auth)
                }
            }
        }
        return null;
    }

    // ─────────────────────────────────────────────
    // ENRUTADOR PRINCIPAL
    // ─────────────────────────────────────────────

    /**
     * Punto de entrada del router. Decide qué nivel maneja la query.
     *
     * @param {string} query - Texto del usuario
     * @param {object} socket - Socket.io para emitir eventos en tiempo real
     * @param {boolean} hasDocument - Si la petición incluye documento adjunto
     * @returns {{ handled: boolean, level?: string, response?: string }}
     */
    async route(query, socket, hasDocument = false, history = []) {
        this.stats.total++;

        // Documentos y tareas del sistema → Premium directo
        if (hasDocument) {
            this.stats.premium++;
            socket.emit('status', '⚡ [ROUTER] Documento detectado → Nivel Premium (loop agentico)');
            return { handled: false };
        }

        const intent = this.classifyQuery(query);

        if (intent === 'system_task') {
            this.stats.premium++;
            this.stats.bypassed++;
            console.log(`🚦 [ROUTER] Tarea de sistema detectada → Nivel 3 Premium directo`);
            socket.emit('status', '⚡ [ROUTER] Tarea de sistema → Nivel Premium (loop agentico completo)');
            return { handled: false };
        }

        // ── NIVEL 1: FUENTES GRATUITAS ──
        if (intent === 'info_query') {
            socket.emit('status', '🌐 [ROUTER] Consultando fuentes gratuitas (Nivel 1)...');
            const freeResult = await this.tryFreeLevel(query);
            if (freeResult) {
                this.stats.free++;
                const msg = `💚 Respuesta obtenida gratis via **${freeResult.source}** | $0.00 gastados`;
                socket.emit('status', msg);
                socket.emit('reset', true);
                socket.emit('answer', freeResult.text);
                console.log(`✅ [ROUTER] NIVEL 1 (${freeResult.source}) — Query resuelta sin coste`);
                return { 
                    handled: true, 
                    level: 'free', 
                    source: freeResult.source, 
                    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } 
                };
            }
            socket.emit('status', '⬆️ [ROUTER] Nivel 1 insuficiente → escalando a Haiku (Nivel 2)...');
        }

        // ── NIVEL 2: HAIKU ──
        socket.emit('status', '🔵 [ROUTER] Consultando Claude Haiku (Nivel 2, $0.25/1M)...');
        const haikuRes = await this.tryHaikuLevel(query);
        if (haikuRes) {
            this.stats.normal++;
            socket.emit('status', '🔵 [ROUTER] Respondido por Haiku (Nivel 2) | ~$0.0003 gastados');
            socket.emit('reset', true);
            socket.emit('answer', haikuRes.text);
            console.log(`✅ [ROUTER] NIVEL 2 (Haiku) — Query resuelta a bajo costo`);
            return { handled: true, level: 'normal', usage: haikuRes.usage, text: haikuRes.text };
        }

        // ── NIVEL 3: PREMIUM (loop agentico completo) ──
        this.stats.premium++;
        socket.emit('status', '🔴 [ROUTER] Escalando a Claude Sonnet (Nivel 3, loop agentico completo)...');
        console.log(`🔴 [ROUTER] NIVEL 3 (Sonnet) — Requiere loop agentico completo`);
        return { handled: false, level: 'premium' };
    }

    getStats() {
        const { free, normal, premium, bypassed, total } = this.stats;
        const freePct = total > 0 ? ((free / total) * 100).toFixed(1) : '0.0';
        const normalPct = total > 0 ? ((normal / total) * 100).toFixed(1) : '0.0';
        const premiumPct = total > 0 ? ((premium / total) * 100).toFixed(1) : '0.0';
        return {
            total_queries: total,
            free:    { count: free,    pct: `${freePct}%`,    cost: '$0.00' },
            normal:  { count: normal,  pct: `${normalPct}%`,  cost: `~$${(normal * 0.0003).toFixed(4)}` },
            premium: { count: premium, pct: `${premiumPct}%`, cost: 'variable (Sonnet)' },
            bypassed_to_premium: bypassed,
            estimated_savings_pct: freePct + '%',
        };
    }
}


