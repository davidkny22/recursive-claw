import type { RetrievalEngine } from '../retrieval-engine.js';

export function createGrepHandler(engine: RetrievalEngine) {
  return async (params: Record<string, unknown>) => {
    const pattern = params.pattern as string;
    const mode = (params.mode as 'fts' | 'regex') ?? 'fts';
    const scope = (params.scope as 'current' | 'all') ?? 'current';
    const since = params.since as string | undefined;
    const before = params.before as string | undefined;
    const limit = (params.limit as number) ?? 20;

    const results = await engine.grep(pattern, { mode, scope, since, before, limit });

    return results.map(r => ({
      messageIndex: r.message.messageIndex,
      sessionId: r.message.sessionId,
      role: r.message.role,
      snippet: r.snippet,
      timestamp: new Date(r.message.timestamp).toISOString(),
      score: r.score,
    }));
  };
}
