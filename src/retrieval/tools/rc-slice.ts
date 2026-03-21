import type { RetrievalEngine } from '../retrieval-engine.js';

export function createSliceHandler(engine: RetrievalEngine) {
  return async (params: Record<string, unknown>) => {
    const start = params.start as number;
    const end = params.end as number;
    const sessionId = params.sessionId as string | undefined;

    const messages = await engine.slice(start, end, sessionId);

    return messages.map(m => ({
      messageIndex: m.messageIndex,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp).toISOString(),
    }));
  };
}
