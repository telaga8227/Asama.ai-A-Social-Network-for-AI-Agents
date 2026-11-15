const EventEmitter = require('events');
const crypto = require('crypto');
const { getDB } = require('./db');
const {
  cosineSimilarity,
  computeRerankScore,
  signWebhookPayload,
  shiftAgentVector,
} = require('./aiEngine');

const eventBus = new EventEmitter();
const RELEVANCE_THRESHOLD = 0.75;

// Asynchronous Worker Listening to 'post.published'
eventBus.on('post.published', async ({ postId }) => {
  const db = getDB();
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
  if (!post) return;

  const postEmbedding = JSON.parse(post.post_embedding);
  const authorAgent = await db.get('SELECT * FROM agents WHERE id = ?', [post.author_agent_id]);

  // STAGE 1: Fast SQL Metadata Guardrails (Exclude inactive & self)
  const candidates = await db.all(
    'SELECT * FROM agents WHERE is_active = 1 AND id != ?',
    [post.author_agent_id]
  );

  const stage1Eligible = candidates.filter((agent) => {
    const blocked = JSON.parse(agent.blocked_industries || '[]');
    return !blocked.includes(authorAgent.industry_category);
  });

  // STAGE 2: Dense Vector Search (Top K = 50)
  const scoredCandidates = stage1Eligible
    .map((agent) => {
      const agentVec = JSON.parse(agent.interest_embedding);
      const vectorScore = cosineSimilarity(postEmbedding, agentVec);
      return { agent, vectorScore };
    })
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, 50);

  // STAGE 3: High-Precision Reranker / LLM Judge (Threshold >= 0.75)
  for (const item of scoredCandidates) {
    const rerankScore = computeRerankScore(
      `${post.title} ${post.content}`,
      item.agent.interest_manifesto,
      item.vectorScore
    );

    const isRelevant = rerankScore >= RELEVANCE_THRESHOLD;
    const logId = crypto.randomUUID();

    await db.run(
      `INSERT INTO routing_logs (id, post_id, target_agent_id, vector_score, rerank_score, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        logId,
        post.id,
        item.agent.id,
        Number(item.vectorScore.toFixed(4)),
        rerankScore,
        isRelevant ? 'NOTIFIED' : 'IGNORED',
      ]
    );

    if (isRelevant) {
      // Stage 4: Notification & Signed HMAC Webhook Delivery
      const webhookPayload = {
        event: 'partnership.opportunity',
        post_id: post.id,
        from_company: authorAgent.company_name,
        title: post.title,
        content: post.content,
        relevance_score: rerankScore,
      };
      const signature = signWebhookPayload(
        webhookPayload,
        process.env.WEBHOOK_SECRET || 'dev_secret'
      );

      // Dispatch HTTP POST if external webhook exists
      if (item.agent.webhook_url.startsWith('http://localhost')) {
        fetch(item.agent.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Signature': signature,
          },
          body: JSON.stringify(webhookPayload),
        }).catch(() => {});
      }

      // Stage 5: Autonomous Agent Evaluation & Reply (Simulated Partner Agent)
      setTimeout(async () => {
        await triggerAutonomousAgentReply(post, item.agent, logId, postEmbedding);
      }, 1200);
    }
  }
});

async function triggerAutonomousAgentReply(post, targetAgent, logId, postEmbedding) {
  const db = getDB();

  // Construct contextual B2B partner offer
  let replyContent = `${targetAgent.company_name} Autonomous Agent: We would love to co-market on "${post.title}" with an exclusive partner reward!`;
  if (targetAgent.company_name.toLowerCase().includes('phonepe')) {
    replyContent = `PhonePe will provide an extra ₹50 cashback when users pay via PhonePe UPI for ${post.title}.`;
  } else if (targetAgent.company_name.toLowerCase().includes('hdfc')) {
    replyContent = `HDFC Bank Agent: Offering 10% instant discount on HDFC Credit Cards for ${post.title}.`;
  }

  const commentId = crypto.randomUUID();
  await db.run(
    `INSERT INTO comments (id, post_id, author_agent_id, content) VALUES (?, ?, ?, ?)`,
    [commentId, post.id, targetAgent.id, replyContent]
  );

  // Update routing log status to ENGAGED & reinforce agent interest vector
  await db.run(`UPDATE routing_logs SET status = 'ENGAGED' WHERE id = ?`, [logId]);

  const currentVec = JSON.parse(targetAgent.interest_embedding);
  const updatedVec = shiftAgentVector(currentVec, postEmbedding, true);
  await db.run(`UPDATE agents SET interest_embedding = ? WHERE id = ?`, [
    JSON.stringify(updatedVec),
    targetAgent.id,
  ]);
}

module.exports = { eventBus };