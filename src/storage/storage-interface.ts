import type {
  StoredMessage,
  SearchOptions,
  SearchResult,
  TimelineEntry,
  SessionInfo,
  CrossSessionOptions,
} from '../types.js';

/**
 * Abstract storage interface for recursive-claw.
 *
 * The default implementation uses node-sqlite3-wasm (pure WebAssembly,
 * no native bindings). All methods return Promises for backend
 * compatibility. Future backends (Postgres, cloud sync) must be
 * genuinely async.
 */
export interface StorageInterface {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Messages
  storeMessage(msg: StoredMessage): Promise<void>;
  getMessages(sessionId: string, range?: { start: number; end: number }): Promise<StoredMessage[]>;
  getMessageCount(sessionId: string): Promise<number>;
  getTailMessages(sessionId: string, count: number): Promise<StoredMessage[]>;
  getNextMessageIndex(sessionId: string): Promise<number>;

  // Search
  fullTextSearch(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  regexSearch(pattern: string, opts?: SearchOptions): Promise<SearchResult[]>;

  // Metadata
  getTimeline(sessionId: string): Promise<TimelineEntry[]>;
  getSessions(): Promise<SessionInfo[]>;
  getSession(sessionId: string): Promise<SessionInfo | null>;
  ensureSession(sessionId: string): Promise<void>;

  // Cross-session
  getMessagesAcrossSessions(query: string, opts?: CrossSessionOptions): Promise<SearchResult[]>;

  // Maintenance
  rebuildFTSIndex(): Promise<void>;
}
