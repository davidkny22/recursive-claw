import type { RetrievalEngine } from '../retrieval-engine.js';

export function createPeekHandler(engine: RetrievalEngine) {
  return async (params: Record<string, unknown>) => {
    const offset = (params.offset as number) ?? 0;
    const length = (params.length as number) ?? 10;
    const sessionId = params.sessionId as string | undefined;

    const messages = await engine.peek(offset, length, sessionId);

    return messages.map(m => ({
      messageIndex: m.messageIndex,
      role: m.role,
      content: m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content,
      timestamp: new Date(m.timestamp).toISOString(),
    }));
  };
}
