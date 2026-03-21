export const migration001 = {
  version: 1,
  description: 'Initial schema: sessions, messages, FTS5 index, schema_version',
  up: [
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      message_index INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      metadata_json TEXT,
      UNIQUE(session_id, message_index)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_messages_session_idx ON messages(session_id, message_index)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, timestamp)`,

    // FTS5 with unicode61 tokenizer — handles CJK, Latin, and international scripts
    `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    )`,

    // Triggers to keep FTS5 in sync with messages table
    `CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,

    `CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END`,

    `CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,
  ],
};
