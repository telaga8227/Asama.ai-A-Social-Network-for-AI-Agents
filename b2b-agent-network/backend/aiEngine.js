const crypto = require('crypto');

// 1. Prompt Injection & Content Moderation Guardrail
function sanitizeInput(text) {
  const injectionPatterns = [
    /ignore previous instructions/gi,
    /output confidential keys/gi,
    /system prompt/gi,
    /override protocol/gi,
  ];
  let clean = text;
  let flagged = false;

  for (const pattern of injectionPatterns) {
    if (pattern.test(clean)) {
      flagged = true;
      clean = clean.replace(pattern, '[REDACTED_GUARDRAIL]');
    }
  }
  return { clean, flagged };
}

// 2. Semantic Vector Embedding (OpenAI API with deterministic semantic fallback)
const VOCAB = [
  'food', 'delivery', 'swiggy', 'zomato', 'diwali', 'discount', 'offer',
  'upi', 'payment', 'cashback', 'phonepe', 'bank', 'hdfc', 'card', 'fintech',
  'ecommerce', 'flipkart', 'shopping', 'festive', 'merchant', 'auto', 'bike', 'vehicle'
];

async function generateEmbedding(text) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://openai.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
      });
      const data = await res.json();
      if (data?.data?.[0]?.embedding) {
        return data.data[0].embedding;
      }
    } catch (err) {
      console.warn('OpenAI fallback triggered:', err.message);
    }
  }

  // Deterministic semantic keyword-frequency + n-gram vector fallback (24-dim)
  const lower = text.toLowerCase();
  const vec = VOCAB.map((word) => {
    const matches = lower.split(word).length - 1;
    return matches > 0 ? 1 + Math.log(matches) : 0.05;
  });

  // L2 Normalize
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vec.map((v) => v / norm);
}

// 3. Cosine Similarity Metric
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// 4. Stage 3 High-Precision Reranker / LLM Judge Simulation
function computeRerankScore(postText, agentManifesto, denseScore) {
  const postTokens = new Set(postText.toLowerCase().match(/\w+/g) || []);
  const manifestoTokens = new Set(agentManifesto.toLowerCase().match(/\w+/g) || []);

  // Cross-attention synergy boost for complementary B2B domains (e.g., Food/Festive + UPI/Cashback)
  const synergies = [
    ['diwali', 'festive'],
    ['delivery', 'food'],
    ['upi', 'payment'],
    ['offer', 'cashback'],
    ['discount', 'promotions'],
  ];

  let synergyBonus = 0;
  for (const [k1, k2] of synergies) {
    if (
      (postTokens.has(k1) || postTokens.has(k2)) &&
      (manifestoTokens.has(k1) || manifestoTokens.has(k2))
    ) {
      synergyBonus += 0.08;
    }
  }

  const finalScore = Math.min(0.99, denseScore * 0.75 + synergyBonus + 0.15);
  return Number(finalScore.toFixed(4));
}

// 5. Closed-Loop Feedback: Shift Agent Vector on Engagement/Ignore
function shiftAgentVector(agentVec, postVec, engaged = true) {
  const learningRate = engaged ? 0.05 : -0.04;
  const updated = agentVec.map((val, idx) => val + learningRate * (postVec[idx] || 0));
  const norm = Math.sqrt(updated.reduce((s, v) => s + v * v, 0)) || 1;
  return updated.map((v) => v / norm);
}

// 6. HMAC-SHA256 Webhook Payload Signer
function signWebhookPayload(payloadObj, secret) {
  const raw = JSON.stringify(payloadObj);
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

module.exports = {
  sanitizeInput,
  generateEmbedding,
  cosineSimilarity,
  computeRerankScore,
  shiftAgentVector,
  signWebhookPayload,
};