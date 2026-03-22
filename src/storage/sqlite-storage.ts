import Database from 'better-sqlite3';
import type { StorageInterface } from './storage-interface.js';
import { MigrationRunner } from './migration-runner.js';
import { StorageError } from '../errors.js';
import type {
  StoredMessage,
  SearchOptions,
  SearchResult,
  TimelineEntry,
  SessionInfo,
  CrossSessionOptions,
} from '../types.js';

/**
 * SQLite-backed StorageInterface using better-sqlite3.
 *
 * better-sqlite3 is synchronous by design. All methods return Promises
 * (wrapping sync calls) for StorageInterface compatibility. Future backends
 * (Postgres, cloud sync) must be genuinely async.
 *
 */
export class SQLiteStorage implements StorageInterface {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      // Register custom regex function for regexSearch
      this.db.function('regexp', { deterministic: true }, (pattern: unknown, value: unknown) => {
        if (typeof pattern !== 'string' || typeof value !== 'string') return 0;
        try {
          return new RegExp(pattern, 'i').test(value) ? 1 : 0;
        } catch {
          return 0;
        }
      });

      const runner = new MigrationRunner(this.db);
      runner.run();
    } catch (err) {
      throw new StorageError(`Failed to initialize database at ${this.dbPath}: ${err}`);
    }
  }

  async close(): Promise<void> {
    this.requireDb().close();
    this.db = null;
  }

  async storeMessage(msg: StoredMessage): Promise<void> {
    const db = this.requireDb();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, message_index, token_estimate, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.sessionId,
      msg.role,
      msg.content,
      msg.timestamp,
      msg.messageIndex,
      msg.tokenEstimate,
      msg.metadata ? JSON.stringify(msg.metadata) : null,
    );

    // Update session counters
    db.prepare(`
      UPDATE sessions SET
        last_active = MAX(last_active, ?),
        message_count = message_count + 1,
        total_tokens = total_tokens + ?
      WHERE session_id = ?
    `).run(msg.timestamp, msg.tokenEstimate, msg.sessionId);
  }

  async getMessages(sessionId: string, range?: { start: number; end: number }): Promise<StoredMessage[]> {
    const db = this.requireDb();
    let rows: unknown[];

    if (range) {
      rows = db.prepare(`
        SELECT * FROM messages
        WHERE session_id = ? AND message_index >= ? AND message_index < ?
        ORDER BY message_index ASC
      `).all(sessionId, range.start, range.end);
    } else {
      rows = db.prepare(`
        SELECT * FROM messages
        WHERE session_id = ?
        ORDER BY message_index ASC
      `).all(sessionId);
    }

    return rows.map(row => this.rowToMessage(row));
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const row = this.requireDb().prepare(
      'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
    ).get(sessionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async getTailMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    const rows = this.requireDb().prepare(`
      SELECT * FROM messages
      WHERE session_id = ?
      ORDER BY message_index DESC
      LIMIT ?
    `).all(sessionId, count);

    return rows.map(row => this.rowToMessage(row)).reverse();
  }

  async getNextMessageIndex(sessionId: string): Promise<number> {
    const row = this.requireDb().prepare(
      'SELECT MAX(message_index) as max_idx FROM messages WHERE session_id = ?'
    ).get(sessionId) as { max_idx: number | null } | undefined;
    return (row?.max_idx ?? -1) + 1;
  }

  async fullTextSearch(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = opts?.limit ?? 20;

    // Sanitize query for FTS5: remove special characters that break FTS5 syntax
    const sanitized = query.replace(/[?*"(){}[\]:^~!@#$%&]/g, ' ').trim();
    if (!sanitized) return [];

    const params: unknown[] = [sanitized];

    let sql = `
      SELECT m.*, bm25(messages_fts) as score
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH ?
    `;

    if (opts?.sessionId && opts.scope !== 'all') {
      sql += ' AND m.session_id = ?';
      params.push(opts.sessionId);
    }
    if (opts?.since) {
      sql += ' AND m.timestamp >= ?';
      params.push(opts.since);
    }
    if (opts?.before) {
      sql += ' AND m.timestamp < ?';
      params.push(opts.before);
    }

    sql += ' ORDER BY score LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this.rowToSearchResult(row));
  }

  async regexSearch(pattern: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = opts?.limit ?? 20;
    const conditions: string[] = ['regexp(?, content)'];
    const params: unknown[] = [pattern];

    if (opts?.sessionId && opts.scope !== 'all') {
      conditions.push('session_id = ?');
      params.push(opts.sessionId);
    }
    if (opts?.since) {
      conditions.push('timestamp >= ?');
      params.push(opts.since);
    }
    if (opts?.before) {
      conditions.push('timestamp < ?');
      params.push(opts.before);
    }

    const sql = `
      SELECT *, 1.0 as score FROM messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this.rowToSearchResult(row));
  }

  async getTimeline(sessionId: string): Promise<TimelineEntry[]> {
    const db = this.requireDb();

    const rows = db.prepare(`
      SELECT
        (timestamp / 3600000) * 3600000 as period_start,
        COUNT(*) as msg_count,
        SUM(token_estimate) as token_count,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_count,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistant_count,
        SUM(CASE WHEN role = 'tool' THEN 1 ELSE 0 END) as tool_count,
        MIN(message_index) as min_idx,
        MAX(message_index) as max_idx
      FROM messages
      WHERE session_id = ?
      GROUP BY period_start
      ORDER BY period_start ASC
    `).all(sessionId) as Array<{
      period_start: number;
      msg_count: number;
      token_count: number;
      user_count: number;
      assistant_count: number;
      tool_count: number;
      min_idx: number;
      max_idx: number;
    }>;

    return rows.map(row => {
      const start = new Date(row.period_start);
      const end = new Date(row.period_start + 3600000);
      const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16);

      return {
        period: `${fmt(start)}-${fmt(end)}`,
        messageCount: row.msg_count,
        tokenCount: row.token_count,
        roles: {
          user: row.user_count,
          assistant: row.assistant_count,
          tool: row.tool_count,
        },
        topKeywords: [],
        messageIndexRange: { start: row.min_idx, end: row.max_idx },
        sessionId,
      };
    });
  }

  async getSessions(): Promise<SessionInfo[]> {
    const rows = this.requireDb().prepare(
      'SELECT * FROM sessions ORDER BY last_active DESC'
    ).all() as Array<{
      session_id: string;
      created_at: number;
      last_active: number;
      message_count: number;
      total_tokens: number;
    }>;

    return rows.map(row => ({
      sessionId: row.session_id,
      createdAt: row.created_at,
      lastActive: row.last_active,
      messageCount: row.message_count,
      totalTokens: row.total_tokens,
    }));
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const row = this.requireDb().prepare(
      'SELECT * FROM sessions WHERE session_id = ?'
    ).get(sessionId) as {
      session_id: string;
      created_at: number;
      last_active: number;
      message_count: number;
      total_tokens: number;
    } | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      createdAt: row.created_at,
      lastActive: row.last_active,
      messageCount: row.message_count,
      totalTokens: row.total_tokens,
    };
  }

  async ensureSession(sessionId: string): Promise<void> {
    const now = Date.now();
    this.requireDb().prepare(`
      INSERT OR IGNORE INTO sessions (session_id, created_at, last_active, message_count, total_tokens)
      VALUES (?, ?, ?, 0, 0)
    `).run(sessionId, now, now);
  }

  async getMessagesAcrossSessions(query: string, opts?: CrossSessionOptions): Promise<SearchResult[]> {
    return this.fullTextSearch(query, {
      scope: 'all',
      since: opts?.since,
      before: opts?.before,
      limit: opts?.limit ?? 20,
    });
  }

  async rebuildFTSIndex(): Promise<void> {
    const db = this.requireDb();
    db.prepare("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')").run();
  }

  // --- Private helpers ---

  private requireDb(): Database.Database {
    if (!this.db) throw new StorageError('Database not initialized. Call initialize() first.');
    return this.db;
  }

  private rowToMessage(row: unknown): StoredMessage {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as StoredMessage['role'],
      content: r.content as string,
      timestamp: r.timestamp as number,
      messageIndex: r.message_index as number,
      tokenEstimate: r.token_estimate as number,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json as string) : undefined,
    };
  }

  private rowToSearchResult(row: unknown): SearchResult {
    const msg = this.rowToMessage(row);
    const r = row as Record<string, unknown>;
    const snippet = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;

    return {
      message: msg,
      snippet,
      score: (r.score as number) ?? 1.0,
    };
  }
}
