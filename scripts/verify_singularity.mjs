import 'dotenv/config';
import { AgentCore } from '../src/agent/AgentCore.js';
import { ToolSchemas } from '../src/tools/ToolSchemas.js';

async function verifySingularity() {
    console.log('🧬 Iniciando Test de Singularidad v8.2.5 [DYNAMIC-SPAWN]...');
    
    // 1. Simular Orquestador
    const meta = new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6", "DEFAULT");
    console.log('✅ Meta-Orquestador inicializado.');

    // 2. Definir un Spawn Dinámico
    const spawnData = {
        name: "DEBUG_EXPERT",
        role_description: "Eres un experto en depuración de Node.js. Tu misión es encontrar errores de sintaxis en el código proporcionado. Eres directo y conciso.",
        tool_set: ["bash", "nexus_intent"]
    };

    console.log(`🚀 Spawneando agente dinámico: ${spawnData.name}...`);
    const dynamicAgent = new AgentCore(process.env.ANTHROPIC_API_KEY, "claude-sonnet-4-6");
    dynamicAgent.setCustomSystem(spawnData.role_description);
    
    // Verificar que el system prompt se generó correctamente
    const sysPrompt = dynamicAgent._getSystemPrompt();
    if (sysPrompt.includes(spawnData.role_description)) {
        console.log('✅ System Prompt dinámico inyectado con éxito.');
    } else {
        throw new Error('Falló la inyección del System Prompt dinámico.');
    }

    // 3. Verificar filtrado de herramientas
    const toolDefs = ToolSchemas.getFilteredDefinitions(null, spawnData.tool_set);
    const toolNames = toolDefs.map(d => d.name);
    console.log(`🛠️  Herramientas provisionadas: ${toolNames.join(', ')}`);
    
    if (toolNames.includes('bash') && !toolNames.includes('web_search')) {
        console.log('✅ Filtrado dinámico de herramientas verificado.');
    } else {
        throw new Error('Fallo en el filtrado de herramientas dinámicas.');
    }

    console.log('\n✨ Test de Singularidad COMPLETADO con éxito.');
}

verifySingularity().catch(err => {
    console.error('❌ Test de Singularidad FALLIDO:', err.message);
    process.exit(1);
});
