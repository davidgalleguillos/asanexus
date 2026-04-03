/**
 * [ESTADO: RESERVA DE CAPACIDADES — No importado en server.js aún]
 * [NOTA: Contiene herramientas nativas beta de Anthropic no activadas en LocalTools.js]
 * [CAPACIDADES DISPONIBLES: code_execution_20250825, web_search_20250305, web_fetch_20260309]
 * [TODO: Evaluar activación de code_execution o web_fetch nativo para reemplazar webSearch de PS]
 */
export class NativeTools {
    static getAllDefinitions() {
        return [
            { 
                type: "computer_20241022",
                name: "computer", 
                display_width_px: 1920, 
                display_height_px: 1080
            },
            { 
                type: "bash_20241022", 
                name: "bash" 
            },
            { 
                type: "code_execution_20250825", 
                name: "code_execution" 
            },
            { 
                type: "web_search_20250305", 
                name: "web_search" 
            },
            { 
                type: "web_fetch_20260309", 
                name: "web_fetch" 
            }
        ];
    }
}
