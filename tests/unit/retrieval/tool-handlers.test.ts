import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { RetrievalEngine } from '../../../src/retrieval/retrieval-engine.js';
import { createPeekHandler } from '../../../src/retrieval/tools/rc-peek.js';
import { createGrepHandler } from '../../../src/retrieval/tools/rc-grep.js';
import { createSliceHandler } from '../../../src/retrieval/tools/rc-slice.js';
import { createQueryHandler } from '../../../src/retrieval/tools/rc-query.js';
import { createTimelineHandler } from '../../../src/retrieval/tools/rc-timeline.js';
import { createMessage, resetFixtures } from '../../helpers/fixtures.js';

describe('Tool handlers', () => {
  let storage: SQLiteStorage;
  let engine: RetrievalEngine;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-tools-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
    await storage.ensureSession('s1');

    // Insert diverse messages
    const messages = [
      createMessage({ sessionId: 's1', messageIndex: 0, role: 'user', content: 'Set up the authentication system with JWT' }),
      createMessage({ sessionId: 's1', messageIndex: 1, role: 'assistant', content: 'I will implement JWT auth with refresh tokens' }),
      createMessage({ sessionId: 's1', messageIndex: 2, role: 'tool', content: 'Created auth/jwt.ts with sign and verify functions', metadata: { toolName: 'Write' } }),
      createMessage({ sessionId: 's1', messageIndex: 3, role: 'user', content: 'Now add rate limiting to the API endpoints' }),
      createMessage({ sessionId: 's1', messageIndex: 4, role: 'assistant', content: 'Adding express-rate-limit middleware to all routes' }),
    ];
    for (const msg of messages) await storage.storeMessage(msg);

    engine = new RetrievalEngine(storage, 's1');
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('rc_peek', () => {
    it('returns formatted messages from end', async () => {
      const handler = createPeekHandler(engine);
      const result = await handler({ offset: 0, length: 2 }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(2);
      expect(result[0].messageIndex).toBe(3);
      expect(result[1].messageIndex).toBe(4);
      expect(result[0]).toHaveProperty('role');
      expect(result[0]).toHaveProperty('content');
      expect(result[0]).toHaveProperty('timestamp');
    });

    it('truncates long content', async () => {
      await storage.storeMessage(createMessage({
        sessionId: 's1',
        messageIndex: 5,
        content: 'x'.repeat(1000),
      }));

      const handler = createPeekHandler(engine);
      const result = await handler({ offset: 0, length: 1 }) as Array<Record<string, unknown>>;
      const content = result[0].content as string;
      expect(content.length).toBeLessThanOrEqual(504); // 500 + '...'
    });
  });

  describe('rc_grep', () => {
    it('finds messages by FTS', async () => {
      const handler = createGrepHandler(engine);
      const result = await handler({ pattern: 'JWT' }) as Array<Record<string, unknown>>;

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toHaveProperty('snippet');
      expect(result[0]).toHaveProperty('score');
    });

    it('finds messages by regex', async () => {
      const handler = createGrepHandler(engine);
      const result = await handler({ pattern: 'rate.*limit', mode: 'regex' }) as Array<Record<string, unknown>>;

      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rc_slice', () => {
    it('returns full message content in range', async () => {
      const handler = createSliceHandler(engine);
      const result = await handler({ start: 1, end: 3 }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(2);
      expect(result[0].messageIndex).toBe(1);
      expect(result[1].messageIndex).toBe(2);
      expect(result[0]).toHaveProperty('content');
    });
  });

  describe('rc_query', () => {
    it('returns stub without sub-query engine', async () => {
      const handler = createQueryHandler(engine);
      const result = await handler({ question: 'What auth system did we choose?' }) as Record<string, unknown>;

      expect(result.confidence).toBe('low');
      expect(result.answer).toContain('not initialized');
    });
  });

  describe('rc_timeline', () => {
    it('returns timeline entries', async () => {
      const handler = createTimelineHandler(engine);
      const result = await handler({}) as Array<Record<string, unknown>>;

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toHaveProperty('period');
      expect(result[0]).toHaveProperty('messageCount');
      expect(result[0]).toHaveProperty('roles');
    });
  });
});
