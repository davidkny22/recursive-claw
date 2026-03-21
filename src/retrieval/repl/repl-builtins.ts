import type { RetrievalEngine } from '../retrieval-engine.js';
import type { StoredMessage, SearchResult, TimelineEntry, SubQueryResult } from '../../types.js';

/**
 * Build the set of functions available inside the REPL sandbox.
 * These are async functions that bridge from the isolate back to the host.
 *
 * In isolated-vm, we can't pass complex objects directly. Instead we
 * serialize to JSON, pass strings across the boundary, and parse back.
 * The builtins here are the HOST-SIDE implementations that get called
 * via isolated-vm's callback mechanism.
 */
export interface REPLBuiltins {
  peek: (offset: number, length: number, sessionId?: string) => Promise<string>;
  grep: (pattern: string, optsJson?: string) => Promise<string>;
  slice: (start: number, end: number, sessionId?: string) => Promise<string>;
  query: (question: string, optsJson?: string) => Promise<string>;
  timeline: (sessionId?: string) => Promise<string>;
  llm_query: (prompt: string, context?: string) => Promise<string>;
  len: (text: string) => number;
  chunk: (textJson: string, size: number) => string;
}

export function createBuiltins(engine: RetrievalEngine): REPLBuiltins {
  return {
    async peek(offset: number, length: number, sessionId?: string): Promise<string> {
      const msgs = await engine.peek(offset, length, sessionId);
      return JSON.stringify(msgs.map(formatMessage));
    },

    async grep(pattern: string, optsJson?: string): Promise<string> {
      const opts = optsJson ? JSON.parse(optsJson) : undefined;
      const results = await engine.grep(pattern, opts);
      return JSON.stringify(results.map(formatSearchResult));
    },

    async slice(start: number, end: number, sessionId?: string): Promise<string> {
      const msgs = await engine.slice(start, end, sessionId);
      return JSON.stringify(msgs.map(formatMessage));
    },

    async query(question: string, optsJson?: string): Promise<string> {
      const opts = optsJson ? JSON.parse(optsJson) : undefined;
      const result = await engine.query(question, opts);
      return JSON.stringify(result);
    },

    async timeline(sessionId?: string): Promise<string> {
      const entries = await engine.timeline(sessionId);
      return JSON.stringify(entries);
    },

    async llm_query(prompt: string, _context?: string): Promise<string> {
      // Delegates to the sub-query engine via retrieval.query
      const result = await engine.query(prompt);
      return result.answer;
    },

    len(text: string): number {
      return text.length;
    },

    chunk(textJson: string, size: number): string {
      const text = textJson;
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
      }
      return JSON.stringify(chunks);
    },
  };
}

function formatMessage(m: StoredMessage) {
  return {
    messageIndex: m.messageIndex,
    role: m.role,
    content: m.content,
    timestamp: new Date(m.timestamp).toISOString(),
  };
}

function formatSearchResult(r: SearchResult) {
  return {
    messageIndex: r.message.messageIndex,
    role: r.message.role,
    snippet: r.snippet,
    sessionId: r.message.sessionId,
    score: r.score,
  };
}
