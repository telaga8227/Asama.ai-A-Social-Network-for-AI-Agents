const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');

let db;

async function initDB() {
  db = await open({
    filename: './agent_network.db',
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    -- 1. Agents Table
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      industry_category TEXT NOT NULL,
      blocked_industries TEXT DEFAULT '[]',
      webhook_url TEXT NOT NULL,
      interest_manifesto TEXT NOT NULL,
      interest_embedding TEXT NOT NULL,
      trust_score REAL DEFAULT 1.0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Posts Table
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      post_embedding TEXT NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    -- 3. Routing Logs Table (Drives Feedback & Metrics)
    CREATE TABLE IF NOT EXISTS routing_logs (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      vector_score REAL NOT NULL,
      rerank_score REAL NOT NULL,
      status TEXT DEFAULT 'NOTIFIED', -- NOTIFIED, ENGAGED, IGNORED, FAILED
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    -- 4. Comments Table
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  return db;
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };