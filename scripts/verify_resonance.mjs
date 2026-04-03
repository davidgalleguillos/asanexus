import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { NexusIntentLayer } from '../src/intent/NexusIntentLayer.js';

const nil = new NexusIntentLayer(process.cwd(), null, null);

async function testResonance() {
    console.log('🧠 Iniciando Test de Resonancia Semántica v3...');
    
    // Consultas que no tienen palabras exactas en el conocimiento previo
    const queries = [
        "¿Cómo proteger la red de Nexus?", // Debería resonar con "security_protocols"
        "Configuración del motor principal", // Debería resonar con "NEXUS_SYSTEM_CONFIG"
        "Arquitectura de la versión anterior" // Debería resonar con "nexus_v5_architecture"
    ];

    for (const q of queries) {
        console.log(`\n🔍 Consulta: "${q}"`);
        const qVector = await nil._embed(q);
        console.log(`   Dimensiones Query: ${qVector.length || Object.keys(qVector).length}`);
        
        const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'nexus_latent_state.json'), 'utf-8'));
        const matches = state.latent_knowledge_nodes.map(node => {
            const score = nil._cosineSimilarity(qVector, node.vector || []);
            return { id: node.id, score };
        }).sort((a, b) => b.score - a.score);

        console.log('   Top 3 matches (Raw):');
        matches.slice(0, 3).forEach(m => {
            console.log(`   - ${m.id}: ${m.score.toFixed(4)}`);
        });

        if (matches[0].score > 0.4) {
            console.log(`✅ Resonancia semántica confirmada para: ${matches[0].id}`);
        } else {
            console.log('❌ Resonancia débil o nula.');
        }
    }
}

testResonance().catch(console.error);
