const socket = io();
 
// --- NEXUS AUDIO ENGINE (SÍNTESIS SCI-FI) ---
const NexusAudio = {
    ctx: null,
    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    playPulse(type = "default") {
        this.init();
        if (this.ctx.state === "suspended") this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        const now = this.ctx.currentTime;
        
        if (type === "thinking") {
            osc.type = "sine";
            osc.frequency.setValueAtTime(120, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 1);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 1);
        } else if (type === "tool") {
            osc.type = "square";
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);
            gain.gain.setValueAtTime(0.02, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.1);
        } else if (type === "success") {
            osc.type = "triangle";
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.5);
        }
        
        osc.start();
        osc.stop(now + 1);
    }
};

// UI Elements
const chatHistory = document.getElementById("chat-history");
const userInput = document.getElementById("user-input");
const fileInput = document.getElementById("file-upload");
const sendBtn = document.getElementById("send-btn");
const thinkingContent = document.getElementById("thinking-content");
const lastScreenshot = document.getElementById("last-screenshot");
const usageStats = document.getElementById("usage-stats");
const statusBadge = document.getElementById("status-badge");
const activeModuleBadge = document.getElementById("active-module");
const thinkIndicator = document.getElementById("think-indicator");
const clearMemoryBtn = document.getElementById("clear-memory-btn");
const configBtn = document.getElementById("config-btn");
const configModal = document.getElementById("config-modal");
const closeModalBtn = document.getElementById("close-modal-btn");

const tglCache = document.getElementById("toggle-cache");
const tglCascade = document.getElementById("toggle-cascade");
const tglBg = document.getElementById("toggle-bg");
const tglAutoscan = document.getElementById("toggle-autoscan");

let currentDocument = null;
let isThinking = false;

// --- CONFIGURACIÓN DE RENDERIZADO (MARKDOWN & HIGHLIGHT) ---
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

// --- NEURONAL ANIMATION LOGIC ---
const canvas = document.getElementById("neuro-canvas");
const ctx = canvas.getContext("2d");
let particles = [];

function initCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particles = [];
    // v5.5 Optimization: Reduced for performance (O(n^2) reduction)
    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            size: Math.random() * 1.5 + 0.5
        });
    }
}

let pulseIntensity = 0;
let pulseColor = "96, 165, 250";

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const speedMult = (isThinking ? 2.5 : 1) + pulseIntensity;
    const color = pulseColor;

    particles.forEach((p, i) => {
        p.x += p.vx * speedMult;
        p.y += p.vy * speedMult;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, 0.4)`;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
            const p2 = particles[j];
            const dx = p.x - p2.x;
            const dy = p.y - p2.y;
            const distSq = dx * dx + dy * dy;
            const maxDist = 150;
            const maxDistSq = maxDist * maxDist;

            if (distSq < maxDistSq) {
                const dist = Math.sqrt(distSq);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = `rgba(${color}, ${0.6 - dist / maxDist})`;
                ctx.lineWidth = 0.4;
                ctx.stroke();
            }
        }
    });

    requestAnimationFrame(animate);
}

window.addEventListener("resize", initCanvas);
initCanvas();
animate();

// --- SOCKET & UI LOGIC ---

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    statusBadge.innerText = "SUBIENDO...";
    const formData = new FormData();
    formData.append("file", file);
    try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.document_data) {
            currentDocument = { data: data.document_data, mimeType: data.mime_type };
            statusBadge.innerText = "ATTACHMENT READY";
        }
    } catch (err) {
        statusBadge.innerText = "UPLOAD ERROR";
    }
});

let typingTimer;
userInput.addEventListener("input", () => {
    clearTimeout(typingTimer);
    const text = userInput.value.trim();
    if (text.length > 5) {
        typingTimer = setTimeout(() => {
            socket.emit("estimate_tokens", text);
        }, 1000);
    }
});

socket.on("token_estimation", (count) => {
    if(!isThinking) {
        statusBadge.innerText = `PROYECCIÓN: ${count} TOKENS`;
    }
});

userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        if (e.ctrlKey || e.shiftKey) {
            e.preventDefault();
            const val = userInput.value;
            const start = userInput.selectionStart;
            const end = userInput.selectionEnd;
            userInput.value = val.substring(0, start) + "\n" + val.substring(end);
            userInput.selectionStart = userInput.selectionEnd = start + 1;
        } else {
            e.preventDefault();
            sendBtn.click();
        }
    }
});

sendBtn.addEventListener("click", () => {
    const text = userInput.value.trim();
    if (!text && !currentDocument) return;
    addMessage(text || "Analizando flujo neural...", "user");
    socket.emit("ask", { text, document: currentDocument });
    userInput.value = "";
    currentDocument = null;
    isThinking = true;
    document.body.classList.add("singularity-active");
    thinkIndicator.classList.add("active");
    sendBtn.innerHTML = '<span class="spinner"></span> PROCEDIENDO...';
    sendBtn.style.opacity = "0.7";
});

clearMemoryBtn.addEventListener("click", () => {
    if (confirm("¿Estás seguro de que deseas purgar la memoria SQLite y reiniciar el contexto neural?")) {
        socket.emit("clear_memory");
        addMessage("⚠️ Solicitude de purga cerebral enviada...", "user");
    }
});

// --- CONFIG MODAL LOGIC ---
configBtn.addEventListener("click", () => {
    configModal.style.display = "flex";
});

closeModalBtn.addEventListener("click", () => {
    configModal.style.display = "none";
});

configModal.addEventListener("click", (e) => {
    if (e.target === configModal) configModal.style.display = "none";
});

[
    { el: tglCache, key: "semanticCacheEnabled" },
    { el: tglCascade, key: "cascadeRoutingEnabled" },
    { el: tglBg, key: "backgroundThreadEnabled" },
    { el: tglAutoscan, key: "autoScanEnabled" }
].forEach(({el, key}) => {
    el.addEventListener("change", (e) => {
        socket.emit("update_config", { key, value: e.target.checked });
    });
});

socket.on("config_state", (config) => {
    tglCache.checked = config.semanticCacheEnabled;
    tglCascade.checked = config.cascadeRoutingEnabled;
    tglBg.checked = config.backgroundThreadEnabled;
    tglAutoscan.checked = config.autoScanEnabled;
});

socket.on("thinking", (thought) => {
    isThinking = true;
    document.body.classList.add("singularity-active");
    thinkIndicator.classList.add("active");
    // Limpiamos etiquetas de thinking si vienen del modelo
    const cleanThought = thought.replace(/<thinking>|<\/thinking>/g, "").trim();
    if (cleanThought) {
        const line = document.createElement("div");
        line.className = "thinking-stream-line";
        line.innerText = `>> ${cleanThought.slice(-80)}`;
        thinkingContent.appendChild(line);
        thinkingContent.scrollTop = thinkingContent.scrollHeight;
    }
    
    // Integración opcional: Loguear inicio de pensamiento en el chat
    if (thought.includes("<thinking>")) {
        addMessage("💭 Iniciando proceso cognitivo...", "system");
    }
});

socket.on("status", (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    thinkingContent.innerText += `\n[${timestamp}] ${msg}`;
    thinkingContent.scrollTop = thinkingContent.scrollHeight;
    
    // --- INTEGRACIÓN EN CHAT ---
    addMessage(`[SISTEMA] ${msg}`, "system");
    
    // Detectamos el módulo activo por el mensaje de estatus
    if (msg.includes("Módulo")) {
        const moduleName = msg.match(/\[(.*?)\]/);
        if (moduleName) activeModuleBadge.innerText = `ACTIVO: ${moduleName[1]}`;
    }
});

socket.on("usage", (data) => {
    usageStats.innerHTML = `
        <div class="tokens">TOKENS: <span style="color:var(--primary)">${data.input}</span> IN | <span style="color:var(--accent)">${data.output}</span> OUT | CACHÉ: ${data.cache}</div>
        <div id="cost-total">VALOR SESIÓN: $${data.cost} <span style="opacity:0.5; font-size:0.5rem; margin-left:10px;">LATENCIA: ${data.latency}</span></div>
    `;
});

socket.on("screenshot", (base64) => {
    lastScreenshot.src = "data:image/png;base64," + base64;
    lastScreenshot.style.transform = "scale(1.02)";
    setTimeout(() => lastScreenshot.style.transform = "scale(1)", 500);
});

socket.on("answer", (ans) => {
    isThinking = false;
    document.body.classList.remove("singularity-active");
    thinkIndicator.classList.remove("active");
    sendBtn.innerHTML = '🚀 SINCRONIZAR';
    sendBtn.style.opacity = "1";
    addMessage(ans, "ai");
    statusBadge.innerText = "LINK ESTABLECIDO";
    activeModuleBadge.innerText = "MÓDULO: REPOSO";
    NexusAudio.playPulse("success");
    pulseIntensity = 0;
    pulseColor = "96, 165, 250";
});

socket.on("pulse", (data) => {
    if (data.agent) {
        activeModuleBadge.innerText = `AGENTE: ${data.agent}`;
    }
    // Reacción Auditiva
    if (data.status === "thinking") NexusAudio.playPulse("thinking");
    else if (data.tool) NexusAudio.playPulse("tool");

    // Reacción visual al Pulso Neural
    if (data.status === "thinking") {
        pulseIntensity = 1.5 + (data.intensity || 0) / 10;
        pulseColor = "255, 62, 62"; // Rojo para pensamiento profundo
    } else if (data.status === "processing") {
        pulseIntensity = 2.0;
    } else if (data.tool) {
        pulseIntensity = 4.0; // Pico de intensidad en ejecución de herramientas
        const colors = {
            bash: "255, 165, 0",    // Naranja
            editor: "138, 43, 226", // Violeta
            python: "50, 205, 50",  // Lima
            web: "0, 191, 255",     // Azul profundo
            computer: "255, 20, 147" // Rosa fuerte
        };
        pulseColor = colors[data.tool] || "255, 255, 255";
        
        // Efecto visual instantáneo de "latido"
        statusBadge.style.transform = "scale(1.2)";
        statusBadge.style.textShadow = `0 0 10px rgba(${pulseColor}, 0.8)`;
        setTimeout(() => {
            statusBadge.style.transform = "scale(1)";
            statusBadge.style.textShadow = "none";
        }, 300);
    }
});

socket.on("dev:reload", (data) => {
    console.log(`[DEV] Recargando UI por cambio en: ${data.file}`);
    statusBadge.innerText = "REFRESCANDO...";
    setTimeout(() => location.reload(), 100);
});

socket.on("federation_update", (info) => {
    const feed = document.getElementById("federation-feed");
    const healthHeader = document.getElementById("fed-health-score-header");
    const lastUpdate = document.getElementById("fed-last-update");
    
    // Clear initial message
    if (feed.innerText.includes("Iniciando expertos")) feed.innerText = "";

    const item = document.createElement("div");
    item.className = "fed-item " + (info.expert === "NEXUS-RECHERCHE" ? "recherche" : "");
    if(info.expert === "NEXUS-HEALTH" && info.data.score < 50) item.classList.add("health-critical");
    
    if(info.expert === "NEXUS-HEALTH") {
        if(healthHeader) healthHeader.innerText = info.data.score;
        if(lastUpdate) lastUpdate.innerText = new Date().toLocaleTimeString();
        item.innerHTML = `<span style="color:var(--primary);">[HEALTH]</span> Status: ${info.data.status} (${info.data.score}%)`;
    } else {
        item.innerHTML = `<span style="color:#8bc34a;">[RECHERCHE]</span> ${info.data.topic}: ${info.data.summary}`;
        if(lastUpdate) lastUpdate.innerText = new Date().toLocaleTimeString();
    }
    
    feed.prepend(item);
    if(feed.children.length > 8) feed.removeChild(feed.lastChild);
});

socket.on("connect", () => {
    const overlay = document.getElementById("offline-overlay");
    if(overlay) overlay.style.display = "none";
});

socket.on("disconnect", () => {
    const overlay = document.getElementById("offline-overlay");
    if(overlay) overlay.style.display = "flex";
    statusBadge.innerText = "⚡ OFFLINE";
    statusBadge.style.color = "var(--accent)";
});

// --- SECONDARY THREAD UI ---
const bgContent = document.getElementById("secondary-content");
const bgThinkIndicator = document.getElementById("think-indicator-secondary");

socket.on("bg_status", (log) => {
    bgContent.innerText += `\n[${new Date().toLocaleTimeString()}] ${log}`;
    bgContent.scrollTop = bgContent.scrollHeight;
});

socket.on("bg_thinking", (thinking) => {
    bgThinkIndicator.classList.add("active");
    bgContent.innerText += `\n💭 ${thinking}`;
    bgContent.scrollTop = bgContent.scrollHeight;
});

socket.on("bg_answer", (ans) => {
    bgThinkIndicator.classList.remove("active");
    bgContent.innerText += `\n\n✅ MISIÓN CUMPLIDA:\n${ans}\n--- Esperando próxima ventana inactiva ---`;
    bgContent.scrollTop = bgContent.scrollHeight;
});

// --- TELEMETRÍA: CACHÉ Y ROUTER ---
socket.on("cache_stats", (stats) => {
    const line = `💾 Cache | Hit rate: ${stats.hit_rate} | Hits: ${stats.hits} | Entradas: ${stats.active_entries} | Tokens ahorrados: ~${stats.estimated_tokens_saved} (~$${stats.estimated_cost_saved_usd})`;
    thinkingContent.innerText += `\n${line}`;
    thinkingContent.scrollTop = thinkingContent.scrollHeight;
    addMessage(line, "system");
});

socket.on("router_stats", (stats) => {
    const line = `🚦 Router | Queries: ${stats.total_queries} | Free: ${stats.free.pct} | Haiku: ${stats.normal.pct} | Sonnet: ${stats.premium.pct}`;
    thinkingContent.innerText += `\n${line}`;
    thinkingContent.scrollTop = thinkingContent.scrollHeight;
    addMessage(line, "system");
});
// ----------------------------

socket.on("suggest_prompt", (text) => {
    // Si la caja de texto está vacía y no estamos ya pensando, autolanzamos la secuencia
    if (!userInput.value && !isThinking) {
        userInput.value = text;
        addMessage("⚠️ Protocolo de [INICIATIVA PROACTIVA] Auto-Scan activado. Ejecutando...", "ai");
        setTimeout(() => {
            sendBtn.click();
        }, 1200);
    }
});

socket.on("reset", () => {
    thinkingContent.innerText = "Sincronizando flujos...";
    isThinking = true;
    thinkIndicator.classList.add("active");
    sendBtn.innerHTML = '<span class="spinner"></span> PROCEDIENDO...';
    sendBtn.style.opacity = "0.7";
});

// --- NEXUS INTEL (NIL) UI LOGIC ---
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const intelContent = document.getElementById("intel-content");
const reconBtn = document.getElementById("recon-btn");

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(target).classList.add("active");
    });
});

reconBtn.addEventListener("click", () => {
    socket.emit("trigger_intent", { intent: "RECON_PROJECT", params: { deep: true } });
});

socket.on("latent_state_update", (state) => {
    renderIntel(state);
});

function renderIntel(state) {
    if (!state.latent_knowledge_nodes || !state.latent_knowledge_nodes.length) {
        intelContent.innerHTML = `<div class="knowledge-card empty">Cargando sinapsis... <br><small>Usa RECON para iniciar.</small></div>`;
        return;
    }

    intelContent.innerHTML = "";
    
    // Banner de Resumen
    const summary = document.createElement("div");
    summary.style.cssText = "font-size:0.55rem; color:var(--text-dim); margin-bottom:15px; padding:0 5px; opacity:0.8;";
    summary.innerHTML = `NEURAL MAP v5.0: <b>${state.file_map?.length || 0}</b> ARCHIVOS | <b>${state.synaptic_links?.length || 0}</b> SINAPSIS`;
    intelContent.appendChild(summary);

    // Renderizar Nodos de Conocimiento
    state.latent_knowledge_nodes.forEach(node => {
        const card = document.createElement("div");
        card.className = "knowledge-card";
        
        // Buscar links relacionados a este nodo (archivos en el nodo)
        const nodeLinks = (state.synaptic_links || []).filter(l => 
            node.files.some(f => f.includes(l.source) || f.includes(l.target))
        );

        let linksHtml = nodeLinks.slice(0, 3).map(l => 
            `<span class="synaptic-link">🔗 ${l.source} → ${l.target}</span>`
        ).join("");

        card.innerHTML = `
            <h4>${node.id}</h4>
            <p>${node.description}</p>
            <div style="margin-top:8px;">${linksHtml}</div>
            <div class="node-files">📁 ${node.files.slice(0, 3).join(", ")} ${node.files.length > 3 ? '...' : ''}</div>
        `;
        intelContent.appendChild(card);
    });
}

function addMessage(text, role) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    
    if (role === "ai") {
        div.innerHTML = marked.parse(text);
        div.querySelectorAll("pre code").forEach((block) => {
            hljs.highlightElement(block);
        });
    } else if (role === "system") {
        div.innerText = text;
    } else {
        div.innerText = text;
    }
    
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

