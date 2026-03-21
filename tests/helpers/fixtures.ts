import type { StoredMessage } from '../../src/types.js';
import { estimateTokens } from '../../src/token-estimator.js';

let idCounter = 0;

export function createMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  idCounter++;
  const content = overrides.content ?? `Test message ${idCounter}`;
  return {
    id: overrides.id ?? `msg-${idCounter}`,
    sessionId: overrides.sessionId ?? 'session-1',
    role: overrides.role ?? 'user',
    content,
    timestamp: overrides.timestamp ?? Date.now(),
    messageIndex: overrides.messageIndex ?? idCounter - 1,
    tokenEstimate: overrides.tokenEstimate ?? estimateTokens(content),
    metadata: overrides.metadata,
  };
}

export function createMessages(count: number, sessionId = 'session-1'): StoredMessage[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const role = i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool';
    return createMessage({
      sessionId,
      role: role as StoredMessage['role'],
      content: `Message ${i} in ${sessionId}: This is a test message about topic ${Math.floor(i / 5)}`,
      timestamp: now + i * 1000,
      messageIndex: i,
    });
  });
}

export function resetFixtures(): void {
  idCounter = 0;
}
