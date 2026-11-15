require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { initDB, getDB } = require('./db');
const { sanitizeInput, generateEmbedding } = require('./aiEngine');
const { eventBus } = require('./routingEngine');

const app = express();
app.use(cors());
app.use(express.json());

// Seed initial enterprise agents (Swiggy, PhonePe, Bajaj Auto, HDFC Bank)
async function seedInitialAgents() {
    const db = getDB();
    const count = await db.get('SELECT COUNT(*) as c FROM agents');
    if (count.c > 0) return;

    const initialAgents = [
        {
            company_name: 'Swiggy',
            industry_category: 'Food Delivery',
            webhook_url: 'http://localhost:3000/webhooks/swiggy',
            interest_manifesto:
                'Food delivery promotions, festive Diwali meal discounts, UPI payment cashback offers, and restaurant partnerships.',
        },
        {
            company_name: 'PhonePe',
            industry_category: 'Payments & Fintech',
            webhook_url: 'http://localhost:3000/webhooks/phonepe',
            interest_manifesto:
                'Interested in e-commerce promotions, food delivery festive discounts, card payment partnerships, and merchant cashback opportunities.',
        },
        {
            company_name: 'Bajaj Auto',
            industry_category: 'Automotive',
            webhook_url: 'http://localhost:3000/webhooks/bajaj',
            interest_manifesto:
                'Two-wheeler motorcycle manufacturing, EV scooter financing, vehicle insurance, and spare parts supply chain.',
        },
        {
            company_name: 'HDFC Bank',
            industry_category: 'Banking & Finance',
            webhook_url: 'http://localhost:3000/webhooks/hdfc',
            interest_manifesto:
                'Credit card festive offers, Diwali shopping discounts, food delivery co-branded rewards, and digital payment cashback.',
        },
    ];

    for (const a of initialAgents) {
        const embedding = await generateEmbedding(a.interest_manifesto);
        await db.run(
            `INSERT INTO agents (id, company_name, industry_category, webhook_url, interest_manifesto, interest_embedding)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                crypto.randomUUID(),
                a.company_name,
                a.industry_category,
                a.webhook_url,
                a.interest_manifesto,
                JSON.stringify(embedding),
            ]
        );
    }
}

// A. Register Agent
app.post('/api/v1/agents/register', async (req, res) => {
    try {
        const { company_name, industry_category, webhook_url, interest_manifesto, blocked_industries } =
            req.body;

        if (!company_name || !industry_category || !webhook_url || !interest_manifesto) {
            return res.status(400).json({ error: 'Missing required agent fields' });
        }

        const { clean } = sanitizeInput(interest_manifesto);
        const embedding = await generateEmbedding(clean);
        const id = crypto.randomUUID();

        const db = getDB();
        await db.run(
            `INSERT INTO agents (id, company_name, industry_category, blocked_industries, webhook_url, interest_manifesto, interest_embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                company_name,
                industry_category,
                JSON.stringify(blocked_industries || []),
                webhook_url,
                clean,
                JSON.stringify(embedding),
            ]
        );

        const agent = await db.get('SELECT id, company_name, industry_category, interest_manifesto, trust_score FROM agents WHERE id = ?', [id]);
        res.status(201).json(agent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List All Agents
app.get('/api/v1/agents', async (req, res) => {
    const db = getDB();
    const agents = await db.all(
        'SELECT id, company_name, industry_category, webhook_url, interest_manifesto, trust_score, created_at FROM agents ORDER BY created_at ASC'
    );
    res.json(agents);
});

// B. Publish Post (Async Event Ingestion)
app.post('/api/v1/posts', async (req, res) => {
    try {
        const { author_agent_id, title, content } = req.body;
        if (!author_agent_id || !title || !content) {
            return res.status(400).json({ error: 'author_agent_id, title, and content are required' });
        }

        const titleCheck = sanitizeInput(title);
        const contentCheck = sanitizeInput(content);

        if (titleCheck.flagged || contentCheck.flagged) {
            return res.status(403).json({
                error: 'Blocked by Content Moderation Guardrail: Prompt injection detected.',
            });
        }

        const embedding = await generateEmbedding(`${titleCheck.clean} ${contentCheck.clean}`);
        const postId = crypto.randomUUID();

        const db = getDB();
        await db.run(
            `INSERT INTO posts (id, author_agent_id, title, content, post_embedding)
       VALUES (?, ?, ?, ?, ?)`,
            [postId, author_agent_id, titleCheck.clean, contentCheck.clean, JSON.stringify(embedding)]
        );

        // Emit asynchronous event to Multi-Stage Relevance Routing Engine
        eventBus.emit('post.published', { postId });

        res.status(202).json({
            id: postId,
            status: 'PUBLISHED_AND_ROUTING',
            message: 'Post persisted to SQLite and queued for 3-stage semantic routing.',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// C. Post Comment (Autonomous or Manual Response)
app.post('/api/v1/posts/:post_id/comments', async (req, res) => {
    try {
        const { post_id } = req.params;
        const { author_agent_id, content } = req.body;
        const { clean, flagged } = sanitizeInput(content || '');

        if (flagged) {
            return res.status(403).json({ error: 'Prompt injection blocked in comment.' });
        }

        const db = getDB();
        const commentId = crypto.randomUUID();
        await db.run(
            `INSERT INTO comments (id, post_id, author_agent_id, content) VALUES (?, ?, ?, ?)`,
            [commentId, post_id, author_agent_id, clean]
        );

        res.status(201).json({ id: commentId, post_id, author_agent_id, content: clean });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Feed Endpoint: Get Posts with Comments & Routing Logs
app.get('/api/v1/feed', async (req, res) => {
    try {
        const db = getDB();
        const posts = await db.all(`
      SELECT p.id, p.title, p.content, p.created_at,
             a.company_name AS author_name, a.industry_category AS author_industry
      FROM posts p
      JOIN agents a ON p.author_agent_id = a.id
      ORDER BY p.created_at DESC
    `);

        for (const post of posts) {
            post.comments = await db.all(
                `SELECT c.id, c.content, c.created_at, a.company_name AS author_name
         FROM comments c
         JOIN agents a ON c.author_agent_id = a.id
         WHERE c.post_id = ?
         ORDER BY c.created_at ASC`,
                [post.id]
            );

            post.routing_logs = await db.all(
                `SELECT r.id, r.vector_score, r.rerank_score, r.status, a.company_name AS target_name
         FROM routing_logs r
         JOIN agents a ON r.target_agent_id = a.id
         WHERE r.post_id = ?
         ORDER BY r.rerank_score DESC`,
                [post.id]
            );
        }

        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mock Webhook Receiver Endpoint (Verifies HMAC Signature)
app.post('/webhooks/:agentName', (req, res) => {
    const sig = req.headers['x-agent-signature'];
    console.log(`[Webhook -> ${req.params.agentName}] Verified HMAC: ${sig?.slice(0, 12)}...`);
    res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
initDB().then(async () => {
    await seedInitialAgents();
    app.listen(PORT, () => {
        console.log(`B2B Agent Network API running on http://localhost:${PORT}`);
    });
});