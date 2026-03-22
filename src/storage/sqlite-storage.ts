import { Database } from 'node-sqlite3-wasm';
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
 * SQLite-backed StorageInterface using node-sqlite3-wasm.
 *
 * Pure WebAssembly — no native bindings, no compilation required.
 * Writes directly to disk via Node.js fs API. Supports FTS5.
 */
export class SQLiteStorage implements StorageInterface {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);

      // Register custom regex function
      this.db.function('regexp', (pattern: unknown, value: unknown) => {
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
    db.run(`
      INSERT INTO messages (id, session_id, role, content, timestamp, message_index, token_estimate, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      msg.id, msg.sessionId, msg.role, msg.content,
      msg.timestamp, msg.messageIndex, msg.tokenEstimate,
      msg.metadata ? JSON.stringify(msg.metadata) : null,
    ]);

    db.run(`
      UPDATE sessions SET
        last_active = MAX(last_active, ?),
        message_count = message_count + 1,
        total_tokens = total_tokens + ?
      WHERE session_id = ?
    `, [msg.timestamp, msg.tokenEstimate, msg.sessionId]);
  }

  async getMessages(sessionId: string, range?: { start: number; end: number }): Promise<StoredMessage[]> {
    const db = this.requireDb();

    if (range) {
      return db.all(`
        SELECT * FROM messages
        WHERE session_id = ? AND message_index >= ? AND message_index < ?
        ORDER BY message_index ASC
      `, [sessionId, range.start, range.end]).map(row => this.rowToMessage(row));
    }

    return db.all(`
      SELECT * FROM messages WHERE session_id = ? ORDER BY message_index ASC
    `, [sessionId]).map(row => this.rowToMessage(row));
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const row = this.requireDb().get(
      'SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [sessionId]
    ) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async getTailMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    return this.requireDb().all(`
      SELECT * FROM messages WHERE session_id = ?
      ORDER BY message_index DESC LIMIT ?
    `, [sessionId, count]).map(row => this.rowToMessage(row)).reverse();
  }

  async getNextMessageIndex(sessionId: string): Promise<number> {
    const row = this.requireDb().get(
      'SELECT MAX(message_index) as max_idx FROM messages WHERE session_id = ?', [sessionId]
    ) as { max_idx: number | null } | undefined;
    return (row?.max_idx ?? -1) + 1;
  }

  async fullTextSearch(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = opts?.limit ?? 20;

    // Sanitize for FTS5
    const sanitized = query.replace(/[?*"(){}[\]:^~!@#$%&]/g, ' ').trim();
    if (!sanitized) return [];

    const params: (string | number | null)[] = [sanitized];
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

    return db.all(sql, params).map(row => this.rowToSearchResult(row));
  }

  async regexSearch(pattern: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = opts?.limit ?? 20;
    const conditions: string[] = ['regexp(?, content)'];
    const params: (string | number | null)[] = [pattern];

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
      ORDER BY timestamp DESC LIMIT ?
    `;
    params.push(limit);

    return db.all(sql, params).map(row => this.rowToSearchResult(row));
  }

  async getTimeline(sessionId: string): Promise<TimelineEntry[]> {
    return this.requireDb().all(`
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
    `, [sessionId]).map((row: Record<string, unknown>) => {
      const periodStart = row.period_start as number;
      const start = new Date(periodStart);
      const end = new Date(periodStart + 3600000);
      const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16);

      return {
        period: `${fmt(start)}-${fmt(end)}`,
        messageCount: row.msg_count as number,
        tokenCount: row.token_count as number,
        roles: {
          user: row.user_count as number,
          assistant: row.assistant_count as number,
          tool: row.tool_count as number,
        },
        topKeywords: [],
        messageIndexRange: { start: row.min_idx as number, end: row.max_idx as number },
        sessionId,
      };
    });
  }

  async getSessions(): Promise<SessionInfo[]> {
    return this.requireDb().all(
      'SELECT * FROM sessions ORDER BY last_active DESC'
    ).map((row: Record<string, unknown>) => ({
      sessionId: row.session_id as string,
      createdAt: row.created_at as number,
      lastActive: row.last_active as number,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
    }));
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const row = this.requireDb().get(
      'SELECT * FROM sessions WHERE session_id = ?', [sessionId]
    ) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id as string,
      createdAt: row.created_at as number,
      lastActive: row.last_active as number,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
    };
  }

  async ensureSession(sessionId: string): Promise<void> {
    const now = Date.now();
    this.requireDb().run(`
      INSERT OR IGNORE INTO sessions (session_id, created_at, last_active, message_count, total_tokens)
      VALUES (?, ?, ?, 0, 0)
    `, [sessionId, now, now]);
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
    this.requireDb().run("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  }

  private requireDb(): Database {
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
