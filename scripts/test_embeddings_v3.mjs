import 'dotenv/config';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function testEmbedding(text) {
    if (!GEMINI_API_KEY) {
        console.error('❌ Missing GEMINI_API_KEY');
        return;
    }
    
    console.log(`📡 Requesting embedding for: "${text}"...`);
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'models/text-embedding-004',
                    content: { parts: [{ text }] }
                })
            }
        );
        
        const data = await res.json();
        if (data.embedding && data.embedding.values) {
            console.log(`✅ Success! Received vector of size: ${data.embedding.values.length}`);
            console.log(`First 5 values: ${data.embedding.values.slice(0, 5).join(', ')}...`);
            return data.embedding.values;
        } else {
            console.error('❌ Error response:', JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('❌ Fetch failed:', e.message);
    }
}

testEmbedding('ASA NEXUS: Inteligencia Artificial Autónoma');
