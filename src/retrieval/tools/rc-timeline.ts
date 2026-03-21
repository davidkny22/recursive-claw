import type { RetrievalEngine } from '../retrieval-engine.js';

export function createTimelineHandler(engine: RetrievalEngine) {
  return async (params: Record<string, unknown>) => {
    const sessionId = params.sessionId as string | undefined;
    return engine.timeline(sessionId);
  };
}
