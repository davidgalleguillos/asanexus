import 'dotenv/config';

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    console.log('📡 Fetching models from v1beta...');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await res.json();
    
    if (data.models) {
        const embedModels = data.models.filter(m => m.supportedGenerationMethods.includes('embedContent'));
        console.log('--- MODELS SUPPORTING embedContent ---');
        embedModels.forEach(m => console.log(`- ${m.name}`));
    } else {
        console.error('Error:', data);
    }
}

listModels();
