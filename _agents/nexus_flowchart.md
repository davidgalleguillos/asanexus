# Diagrama de Flujo: ASA NEXUS (v6.3 TRINITY-PATH)
**Fecha de Actualización:** 02 de Abril de 2026  
**Arquitectura:** Modular Desacoplada + Memory Relay + Reflexive Intelligence + NIL v2

---

## Arquitectura General (v6.3)

```mermaid
graph TD
    %% Estilos Avanzados
    classDef user fill:#2d2d2d,stroke:#555,stroke-width:2px,color:#fff;
    classDef router fill:#0d233a,stroke:#00a3ff,stroke-width:2px,color:#fff;
    classDef agent fill:#3d0d1a,stroke:#ff003c,stroke-width:2px,color:#fff;
    classDef core fill:#1a0d3a,stroke:#b400ff,stroke-width:2px,color:#fff;
    classDef tools fill:#0d3a1a,stroke:#00ff55,stroke-width:2px,color:#fff;
    classDef cache fill:#3a2a0d,stroke:#ffaa00,stroke-width:2px,color:#fff;
    classDef bg fill:#1a1a1a,stroke:#666,stroke-width:1px,color:#aaa;
    classDef relay fill:#2a2a2a,stroke:#00ffcc,stroke-dasharray: 5 5,color:#00ffcc;

    %% ENTRADA
    User((Usuario / UI Client)):::user
    Socket["Servidor Express + Socket.io<br/>(server.js v6.3)"]:::core

    %% NIVEL 0: CACHÉ SEMÁNTICO
    Cache["SemanticCache v2.1<br/>Refusal Guard + Debounce 5s<br/>(0 Tokens Cost)"]:::cache

    %% CAPA DE ENRUTAMIENTO (CASCADE)
    Router{"CascadeRouter v6.3<br/>Classifier: Tool/Info/Ambiguous"}:::router

    %% NIVEL 1: FREE (Parallel P5)
    subgraph L1_Group [Nivel 1: GRATIS $0]
        L1_Gemini["Gemini 3 Flash"]:::tools
        L1_Web["DDG + Wikipedia API"]:::tools
    end

    %% NIVEL 2: NORMAL (Haiku Relay)
    L2["Nivel 2: NORMAL<br/>Claude Haiku 3.5<br/>(Sub-second Relay)"]:::agent

    %% NIVEL 3: PREMIUM (DIAMOND CORE)
    L3["Nivel 3: PREMIUM [DIAMOND]<br/>AgentCore (Sonnet 4.7)<br/>Loop Agéntico Full"]:::core

    %% MEMORY RELAY (Sincronización de Contexto)
    Relay["Memory Relay System<br/>History Sync (L1 -> L2 -> L3)"]:::relay

    %% REFLEXIVE LOOP
    Reflexive{"Reflexive intelligence?<br/>(L3 Audits L1 Draft)"}:::router

    %% TOOLBOX (v6.3)
    subgraph Toolbox [Nexus Toolset]
        T_Comp["SystemManager: Computer<br/>(Vision / Mouse / Keys)"]:::tools
        T_Bash["SystemManager: Bash<br/>(Auto-Tip Redirection)"]:::tools
        T_File["FileManager<br/>(Bridge WSL / Native)"]:::tools
        T_NIL["NexusIntentLayer (NIL v2)<br/>(Latent State Brain)"]:::tools
        T_Audit["AuditExpert<br/>(Self-Reporting)"]:::tools
    end

    %% PERSISTENCIA
    Brain[("nexus_latent_state.json")]:::cache
    Config[("nexus_config.json")]:::cache

    %% BACKGROUND EXPERTS
    HealthAgent["NEXUS-HEALTH<br/>(Audit cada 1h)"]:::bg
    SearchAgent["NEXUS-RECHERCHE<br/>(Proactive cada 30m)"]:::bg

    %% === FLUJO DE DATOS ===
    User -- "Query" --> Socket
    Socket --> Cache
    Cache -- "HIT" --> User
    Cache -- "MISS" --> Router

    %% Clasificación
    Router -- "info_query" --> L1_Group
    Router -- "ambiguous" --> L2
    Router -- "system_task / document" --> L3

    %% Escalado y Relay
    L1_Group -- "Insufficient" --> Relay --> L2
    L2 -- "Insufficient / ESCALANDO" --> Relay --> L3

    %% Reflexive
    L3 -- "reflexive: true" --> Reflexive
    Reflexive -- "Draft" --> L1_Gemini
    L1_Gemini -- "Audit & Polish" --> L3

    %% Agentic Loop
    L3 -- "Tool Call" --> Toolbox
    Toolbox -- "Result" --> L3
    Toolbox <--> Brain
    L3 -- "Final Answer" --> User

    %% Config & BG
    Socket <--> Config
    HealthAgent --> T_NIL
    SearchAgent --> T_NIL
```

---

## Detalle de Niveles (v6.3)

### Nivel 0: Semantic Cache (Inteligencia Latente)
- **Función:** Interceptar queries idénticas o semánticamente similares.
- **Ventaja:** Latencia < 50ms y coste $0 tokens.
- **Filtros:** Incluye **Refusal Guard** para evitar loops de error cacheados.

### Nivel 1: Free Tier (Gemini Flash Parallel)
- **Motores:** Gemini 3 Flash + DuckDuckGo + Wikipedia.
- **Lógica:** Ejecución en paralelo. Si Gemini falla, Wikipedia/DDG sirven de backup instantáneo.
- **Uso:** Consultas rápidas, definiciones y cultura general.

### Nivel 2: Normal Tier (Haiku Relay)
- **Modelo:** Claude Haiku 3.5.
- **Relay:** Sistema de fallback automático si el endpoint principal de Haiku falla.
- **Escalado:** Si detecta que la tarea requiere herramientas (bash, edit), emite la señal `ESCALANDO_A_PREMIUM`.

### Nivel 3: Premium Tier (Diamond Core)
- **Modelo:** Claude Sonnet 4.7.
- **Capacidades:** Control total del sistema, edición de archivos, visión (computer use).
- **Inteligencia Reflexiva:** Sonnet usa a Gemini como "primer borrador" para optimizar sus propios pasos de pensamiento, reduciendo alucinaciones en acceso local.

---

## Cambios Clave v6.3 (Memory Relay Edition)

| Componente | Innovación v6.3 | Impacto |
|---|---|---|
| **Memory Relay** | El historial se persiste entre niveles de escalado. | L3 sabe exactamente qué intentó L1 y L2 antes de fallar. |
| **Reflexive Intelligence** | Sonnet audita borradores de Gemini Flash. | Respuestas más rápidas y certeras en tareas complejas. |
| **Bash v2** | Redirección de errores con [NEXUS-TIP]. | Sugiere usar 'computer screenshot' cuando falla un comando ciego. |
| **NIL v2 (Brain)** | Estado Latente JSON puro. | Eliminación total de dependencias SQLite; portabilidad máxima. |
| **Auto-Recovery** | Guardrails en `uncaughtException`. | El servidor sobrevive a fallos críticos de herramientas externas. |
| **Haiku 3.5 Relay** | Fallback entre versiones de Haiku (4.5 -> 3). | Garantiza disponibilidad continua del Nivel 2. |

---

### [SISTEMA OPTIMIZADO - ASA NEXUS v6.3 - TRINITY PATH]
