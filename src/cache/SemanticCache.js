import fs from "fs";
import path from "path";

/**
 * 🧠 SemanticCache — Caché Semántico de Respuestas ASA Nexus
 * [TOKEN SAVING v1.4 - PERSISTENT]
 *
 * Arquitectura: In-memory Map (sin Redis). Perfecto para servidor local Windows.
 * Estrategia doble:
 *   1. Hash exacto (normalizado) → O(1), 100% hit en prompts idénticos (auto-scan)
 *   2. Similitud Jaccard ≥ 0.85 → captura variantes semánticas del mismo query
 *
 * TTLs diferenciados por categoría según la guía ahorro.md:
 *   - audit:    168h (reportes Defender/EventViewer — estáticos hasta cambio de config)
 *   - system:     5m (puertos, procesos — volátiles)
 *   - config:    60m (nexus_config.json — semi-estático)
 *   - eventlog:  30m (logs de eventos — se actualizan periódicamente)
 *   - default:   15m (queries generales)
 *
 * NO cachear: comandos de ejecución (ejecuta, crea, borra, modifica, instala).
 */

export class SemanticCache {
    constructor(baseDir) {
        this.cachePath = path.join(baseDir, "nexus_semantic_cache.json");
        this.cache = new Map(); // hash → CacheEntry
        this.stats = { hits: 0, misses: 0, bypassed: 0, evictions: 0, estimatedTokensSaved: 0 };

        this._load();
        
        // TTL en milisegundos por categoría
        this.TTL = {
            audit:    168 * 60 * 60 * 1000, // 7 días
            system:     5 * 60 * 1000,       // 5 min
            config:    60 * 60 * 1000,       // 1 hora
            eventlog:  30 * 60 * 1000,       // 30 min
            default:   15 * 60 * 1000,       // 15 min
        };

        // Palabras que hacen una query NO cacheable (comandos con efectos secundarios)
        this.BYPASS_PATTERNS = [
            'ejecuta', 'run', 'crea', 'create', 'borra', 'delete', 'elimina', 'remove',
            'modifica', 'edit', 'instala', 'install', 'reinicia', 'restart', 'actualiza',
            'update', 'escribe', 'write', 'mueve', 'move', 'copia', 'copy', 'descarga', 'download',
            'analiza', 'explora', 'revisa', 'audita', 'lee ', 'investiga', 'grep'
        ];

        // Iniciar limpieza periódica de entradas expiradas (cada 10 min)
        this._startGarbageCollector();
    }

    /**
     * Normaliza texto para comparación: lowercase, sin puntuación, espacios simples.
     */
    normalize(text) {
        if (!text || typeof text !== 'string') return "";
        return text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Hash numérico determinista de una cadena (djb2 variant).
     */
    hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
        }
        return h.toString(36);
    }

    /**
     * Similitud Jaccard entre dos queries (word-level).
     * Filtra palabras cortas (≤2 chars) que son stopwords.
     * Umbral recomendado: 0.85 para alta precisión.
     */
    jaccard(a, b) {
        const wordsA = new Set(this.normalize(a).split(' ').filter(w => w.length > 2));
        const wordsB = new Set(this.normalize(b).split(' ').filter(w => w.length > 2));
        if (wordsA.size === 0 && wordsB.size === 0) return 1;
        const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
        const union = new Set([...wordsA, ...wordsB]);
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * Detecta la categoría TTL según el contenido del query.
     */
    detectCategory(query) {
        const q = this.normalize(query);
        if (q.includes('defender') || q.includes('audit') || q.includes('security') || q.includes('virus') || q.includes('malware')) return 'audit';
        if (q.includes('eventlog') || q.includes('event viewer') || q.includes('visor') || q.includes('eventos')) return 'eventlog';
        if (q.includes('port') || q.includes('puerto') || q.includes('process') || q.includes('proceso') || q.includes('memoria') || q.includes('cpu') || q.includes('status')) return 'system';
        if (q.includes('config') || q.includes('nexus') || q.includes('configuracion')) return 'config';
        return 'default';
    }

    /**
     * Determina si un query es seguro para cachear.
     * Bypass automático para comandos con efectos secundarios.
     */
    isCacheable(query) {
        const q = this.normalize(query);
        const hasBypass = this.BYPASS_PATTERNS.some(p => {
            const regex = new RegExp(`\\b${p}\\b`);
            return regex.test(q);
        });
        if (hasBypass) {
            this.stats.bypassed++;
            console.log(`🚫 [CACHE] Query bypasseado (comando de ejecución detectado).`);
        }
        return !hasBypass;
    }

    /**
     * Busca respuesta en caché.
     * Primero intenta hit exacto (O(1)), luego similitud Jaccard (lineal pero solo si cache pequeño).
     * @returns {{ response: string, matchType: 'exact'|'similar', similarity?: number } | null}
     */
    get(query, similarityThreshold = 0.85) {
        if (!this.isCacheable(query)) return null;

        const normalizedQuery = this.normalize(query);
        const exactKey = this.hash(normalizedQuery);

        // 1. Hit exacto
        const exactEntry = this.cache.get(exactKey);
        if (exactEntry) {
            if (Date.now() > exactEntry.expires) {
                this.cache.delete(exactKey);
                this.stats.evictions++;
            } else {
                exactEntry.hits++;
                this.stats.hits++;
                this.stats.estimatedTokensSaved += exactEntry.estimatedTokens;
                console.log(`✅ [CACHE HIT] Exacto | Tokens ahorrados estimados: ~${exactEntry.estimatedTokens} | Total ahorrado sesión: ~${this.stats.estimatedTokensSaved}`);
                return { response: exactEntry.response, matchType: 'exact' };
            }
        }

        // 2. Hit por similitud Jaccard (solo si el cache es manejable ≤ 200 entradas)
        if (this.cache.size <= 200) {
            for (const [key, entry] of this.cache.entries()) {
                if (Date.now() > entry.expires) continue;
                const sim = this.jaccard(query, entry.originalQuery);
                if (sim >= similarityThreshold) {
                    entry.hits++;
                    this.stats.hits++;
                    this.stats.estimatedTokensSaved += entry.estimatedTokens;
                    console.log(`✅ [CACHE HIT] Similitud Jaccard: ${(sim * 100).toFixed(1)}% | Categoria: ${entry.category} | Tokens ahorrados: ~${entry.estimatedTokens}`);
                    return { response: entry.response, matchType: 'similar', similarity: sim };
                }
            }
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Almacena una respuesta en caché con TTL automático por categoría.
     * @param {string} query - Query original del usuario
     * @param {string} response - Respuesta final del agente
     * @param {string} [categoryOverride] - Forzar categoría TTL específica
     * @returns {{ key: string, category: string, ttl_hours: number, estimatedTokensSaved: number }}
     */
    set(query, response, categoryOverride = null) {
        if (!this.isCacheable(query)) return null;
        if (!response || typeof response !== 'string' || response.trim().length === 0) return null; // No cachear respuestas vacías

        // [v5.6.2] Refusal Guard: No cachear alucinaciones de falta de acceso
        const r = response.toLowerCase();
        if (r.includes("no tengo acceso") || r.includes("entorno aislado") || r.includes("no puedo acceder") || r.includes("limitación")) {
            console.log(`⚠️ [CACHE] Rechazado: La respuesta parece ser una alucinación de falta de acceso.`);
            return null;
        }

        const category = categoryOverride || this.detectCategory(query);
        const ttl = this.TTL[category] || this.TTL.default;
        const normalizedQuery = this.normalize(query);
        const key = this.hash(normalizedQuery);
        const estimatedTokens = Math.round(response.length / 4); // ~4 chars/token

        this.cache.set(key, {
            response,
            originalQuery: query,  // Guardamos el original para Jaccard posterior
            category,
            expires: Date.now() + ttl,
            storedAt: new Date().toISOString(),
            hits: 0,
            estimatedTokens,
        });

        const ttlHours = (ttl / 3600000).toFixed(1);
        console.log(`💾 [CACHE SET] Categoria: ${category} | TTL: ${ttlHours}h | ~${estimatedTokens} tokens cacheados | Clave: ${key}`);

        this._save();
        return { key, category, ttl_hours: parseFloat(ttlHours), estimatedTokensSaved: estimatedTokens };
    }

    /**
     * Invalida entradas por categoría o todas con '*'.
     * @param {'audit'|'system'|'config'|'eventlog'|'default'|'*'} category
     */
    invalidate(category = '*') {
        let count = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (category === '*' || entry.category === category) {
                this.cache.delete(key);
                count++;
            }
        }
        console.log(`🗑️ [CACHE] Invalidadas ${count} entradas (categoría: ${category})`);
        this._save();
        return count;
    }

    /**
     * Retorna estadísticas de rendimiento del caché.
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0.0';
        
        // Desglose por categoría y TTL restante
        const entries = [];
        for (const [key, entry] of this.cache.entries()) {
            const remainingMs = entry.expires - Date.now();
            if (remainingMs > 0) {
                entries.push({
                    category: entry.category,
                    hits: entry.hits,
                    ttl_remaining_min: (remainingMs / 60000).toFixed(0),
                    stored_at: entry.storedAt,
                    query_preview: entry.originalQuery.slice(0, 60) + (entry.originalQuery.length > 60 ? '...' : ''),
                });
            }
        }

        return {
            hit_rate: `${hitRate}%`,
            hits: this.stats.hits,
            misses: this.stats.misses,
            bypassed: this.stats.bypassed,
            evictions: this.stats.evictions,
            active_entries: this.cache.size,
            estimated_tokens_saved: this.stats.estimatedTokensSaved,
            estimated_cost_saved_usd: (this.stats.estimatedTokensSaved * 0.000003).toFixed(4),
            entries,
        };
    }

    /**
     * Limpieza periódica de entradas expiradas para evitar memory leaks.
     */
    _startGarbageCollector() {
        setInterval(() => {
            let evicted = 0;
            for (const [key, entry] of this.cache.entries()) {
                if (Date.now() > entry.expires) {
                    this.cache.delete(key);
                    evicted++;
                }
            }
            if (evicted > 0) {
                this.stats.evictions += evicted;
                console.log(`🧹 [CACHE GC] ${evicted} entradas expiradas eliminadas. Cache activo: ${this.cache.size} entradas.`);
                this._save();
            }
        }, 10 * 60 * 1000); // Cada 10 minutos
    }

    _load() {
        if (!fs.existsSync(this.cachePath)) return;
        try {
            const data = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
            for (const [key, entry] of Object.entries(data)) {
                if (Date.now() < entry.expires) {
                    this.cache.set(key, entry);
                }
            }
            console.log(`🧠 [CACHE LOADED] ${this.cache.size} entradas persistentes restauradas desde disco.`);
        } catch (e) { console.error("Error loading cache:", e); }
    }

    _save() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            try {
                const obj = Object.fromEntries(this.cache);
                fs.writeFileSync(this.cachePath, JSON.stringify(obj, null, 2));
            } catch (e) { console.error("Error saving cache:", e); }
        }, 5000); // 5s debounce
    }
}
