import type { StorageInterface } from '../storage/storage-interface.js';
import type {
  StoredMessage,
  SearchResult,
  TimelineEntry,
  SearchOptions,
  SubQueryResult,
} from '../types.js';

/**
 * Core retrieval operations shared by both tools mode and REPL mode.
 * Thin wrapper over StorageInterface that adds formatting and validation.
 */
export class RetrievalEngine {
  private storage: StorageInterface;
  private currentSessionId: string;

  // Sub-query engine injected after Phase 3. Null until wired.
  private subQueryFn: ((question: string, opts?: { scope?: 'current' | 'all'; model?: string; budget?: number }) => Promise<SubQueryResult>) | null = null;

  constructor(storage: StorageInterface, currentSessionId: string) {
    this.storage = storage;
    this.currentSessionId = currentSessionId;
  }

  setSubQueryFn(fn: typeof this.subQueryFn): void {
    this.subQueryFn = fn;
  }

  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  async peek(offset: number, length: number, sessionId?: string): Promise<StoredMessage[]> {
    const sid = sessionId ?? this.currentSessionId;
    const count = await this.storage.getMessageCount(sid);
    const start = Math.max(0, count - offset - length);
    const end = count - offset;

    if (start >= end) return [];
    return this.storage.getMessages(sid, { start, end });
  }

  async grep(
    pattern: string,
    opts?: {
      mode?: 'fts' | 'regex';
      scope?: 'current' | 'all';
      since?: string;
      before?: string;
      limit?: number;
    }
  ): Promise<SearchResult[]> {
    const mode = opts?.mode ?? 'fts';
    const searchOpts: SearchOptions = {
      sessionId: this.currentSessionId,
      scope: opts?.scope ?? 'current',
      since: opts?.since ? new Date(opts.since).getTime() : undefined,
      before: opts?.before ? new Date(opts.before).getTime() : undefined,
      limit: opts?.limit ?? 20,
    };

    if (mode === 'regex') {
      return this.storage.regexSearch(pattern, searchOpts);
    }
    return this.storage.fullTextSearch(pattern, searchOpts);
  }

  async slice(start: number, end: number, sessionId?: string): Promise<StoredMessage[]> {
    const sid = sessionId ?? this.currentSessionId;
    return this.storage.getMessages(sid, { start, end });
  }

  async query(
    question: string,
    opts?: { scope?: 'current' | 'all'; model?: string; budget?: number }
  ): Promise<SubQueryResult> {
    if (!this.subQueryFn) {
      return {
        answer: 'Sub-query engine not initialized. Use rc_grep for direct search.',
        sources: [],
        confidence: 'low',
        tokensUsed: 0,
        costUsd: 0,
      };
    }
    return this.subQueryFn(question, opts);
  }

  async timeline(sessionId?: string): Promise<TimelineEntry[]> {
    const sid = sessionId ?? this.currentSessionId;
    return this.storage.getTimeline(sid);
  }
}
