import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { NexusIntentLayer } from '../src/intent/NexusIntentLayer.js';

const nil = new NexusIntentLayer(process.cwd(), null, null);
const statePath = path.join(process.cwd(), 'nexus_latent_state.json');

async function migrate() {
    console.log('🚀 Iniciando Migración a NIL v3 [VECTORIAL]...');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    // 1. Migrar Conocimiento Latente
    console.log(`📦 Procesando ${state.latent_knowledge_nodes.length} nodos de conocimiento...`);
    for (const node of state.latent_knowledge_nodes) {
        if (!node.vector) {
            console.log(`🔹 Vectorizando nodo: ${node.id}`);
            const text = (node.id + " " + (node.description || "")).toLowerCase();
            node.vector = await nil._embed(text);
        }
    }

    // 2. Migrar Tácticas de Resolución
    console.log(`⚔️ Procesando ${state.resolution_tactics?.length || 0} tácticas...`);
    if (state.resolution_tactics) {
        for (const tactic of state.resolution_tactics) {
            if (!tactic.vector) {
                console.log(`🔹 Vectorizando táctica: ${tactic.problem.slice(0, 30)}...`);
                const text = (tactic.problem + " " + (tactic.context || "")).toLowerCase();
                tactic.vector = await nil._embed(text);
            }
        }
    }

    // 3. Guardar Estado
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log('✅ Migración completada con éxito.');
}

migrate().catch(console.error);
