export const ToolSchemas = {
    getDefinitions() {
        return [
            { 
                name: "bash", 
                type: "bash_20250124"
            },
            {
                name: "str_replace_editor",
                type: "text_editor_20250728"
            },
            {
                name: "code_execution",
                type: "code_execution_20250825"
            },
            {
                name: "web_fetch",
                type: "web_fetch_20260309"
            },
            {
                name: "web_search",
                type: "web_search_20250305"
            },
            {
                name: "mcp_list_tools",
                description: "Lista todas las herramientas dinámicas proveídas por los servidores MCP conectados.",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            {
                name: "mcp_read_resource",
                description: "Lee un recurso remoto vía MCP (mcp://...).",
                input_schema: { 
                    type: "object", 
                    properties: { uri: { type: "string" } }, 
                    required: ["uri"] 
                }
            },
            {
                name: "nexus_intent",
                description: "Capa de Abstracción de Nexus v8.2 [FABRIC]. Proactiva, con capacidades de Autodiagnóstico y Memoria Episódica NIL.",
                input_schema: {
                    type: "object",
                    properties: {
                        intent: { type: "string", enum: ["RECON_PROJECT", "GET_KNOWLEDGE", "UPDATE_KNOWLEDGE", "SEARCH_NODES", "RUN_HEALTH_CHECK", "VALIDATE_SYSTEM", "RECORD_TACTIC", "GET_TACTIC", "MEASURE_LATENCY", "ANALYZE_CODEBASE", "RECORD_SNIPPET", "GET_SNIPPET", "SAVE_SESSION", "RESTORE_SESSION", "GENERATE_API"] },
                        params: { type: "object" }
                    },
                    required: ["intent"]
                }
            },
            {
                name: "submit_audit_report",
                description: "Finaliza la tarea con un reporte técnico formal.",
                input_schema: {
                    type: "object",
                    properties: {
                        severity: { type: "string", enum: ["OK", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
                        system_status: { type: "string" },
                        findings: { type: "array", items: { type: "string" } }
                    },
                    required: ["severity", "system_status", "findings"]
                }
            },
            {
                name: "set_strategy",
                description: "Designa al primer especialista para abordar la problemática detectada.",
                input_schema: {
                    type: "object",
                    properties: {
                        first_specialist: { type: "string", enum: ["RESEARCHER", "EXECUTOR", "CRITIC", "SYNTHESIZER"] },
                        mission_path: { type: "string" }
                    },
                    required: ["first_specialist", "mission_path"]
                }
            },
            {
                name: "nexus_handoff",
                description: "Devuelve el control al Meta-Orquestador o transfiere la misión a otro especialista.",
                input_schema: {
                    type: "object",
                    properties: {
                        next_specialist: { type: "string", enum: ["RESEARCHER", "EXECUTOR", "CRITIC", "SYNTHESIZER", "META"] },
                        handover_context: { type: "string" }
                    },
                    required: ["next_specialist", "handover_context"]
                }
            },
            {
                name: "spawn_specialist",
                description: "Crea dinámicamente un especialista on-the-fly con un rol y herramientas específicas.",
                input_schema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nombre identificador del nuevo agente (ej. SECURITY_EXPERT)." },
                        role_description: { type: "string", description: "Instrucciones de sistema detalladas para el nuevo agente." },
                        tool_set: { 
                            type: "array", 
                            items: { type: "string", enum: ["bash", "str_replace_editor", "code_execution", "web_search", "web_fetch", "nexus_intent"] },
                            description: "Lista de herramientas que el agente podrá utilizar."
                        }
                    },
                    required: ["name", "role_description", "tool_set"]
                }
            }
        ];
    },

    getAnthropicDefinitions() {
        const defs = this.getDefinitions().map(d => {
            const clean = { ...d };
            const isNative = ["bash_20250124", "text_editor_20250728", "code_execution_20250825", "web_fetch_20260309", "web_search_20250305"].includes(clean.type);
            if (isNative) {
                if (clean.type === "text_editor_20250728") {
                    clean.name = "str_replace_based_edit_tool"; // Nombre técnico estricto Anthropic
                }
                delete clean.description; 
                delete clean.input_schema;
            }
            return clean;
        });
        console.log(`[DEBUG-TOOLS] Envíando ${defs.length} herramientas. Primera herramienta: ${defs[0].name} (${defs[0].type || 'custom'})`);
        return defs;
    },

    getFilteredDefinitions(specialization, explicitTools = null) {
        const all = this.getAnthropicDefinitions();
        if (explicitTools && Array.isArray(explicitTools)) {
            return all.filter(d => explicitTools.includes(d.name));
        }
        const mapping = {
            RESEARCHER: ["web_search", "web_fetch", "mcp_list_tools", "mcp_read_resource", "nexus_intent"],
            EXECUTOR: ["bash", "str_replace_editor", "code_execution", "nexus_intent"],
            CRITIC_REFLEXIVE: ["nexus_intent", "submit_audit_report"],
            SYNTHESIZER: ["nexus_intent"],
            DEFAULT: ["spawn_specialist", "nexus_intent", "set_strategy"]
        };
        const allowed = mapping[specialization] || mapping.DEFAULT;
        return all.filter(d => allowed.includes(d.name));
    }
};
