import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { RetrievalEngine } from '../../../src/retrieval/retrieval-engine.js';
import { createMessages, resetFixtures } from '../../helpers/fixtures.js';

describe('RetrievalEngine', () => {
  let storage: SQLiteStorage;
  let engine: RetrievalEngine;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-retrieval-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
    await storage.ensureSession('s1');

    const msgs = createMessages(50, 's1');
    for (const msg of msgs) await storage.storeMessage(msg);

    engine = new RetrievalEngine(storage, 's1');
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('peek', () => {
    it('returns messages from the end', async () => {
      const msgs = await engine.peek(0, 5);
      expect(msgs).toHaveLength(5);
      expect(msgs[4].messageIndex).toBe(49);
    });

    it('handles offset', async () => {
      const msgs = await engine.peek(10, 5);
      expect(msgs).toHaveLength(5);
      expect(msgs[4].messageIndex).toBe(39);
    });

    it('returns empty for out-of-range', async () => {
      const msgs = await engine.peek(100, 5);
      expect(msgs).toEqual([]);
    });
  });

  describe('grep', () => {
    it('searches by FTS', async () => {
      const results = await engine.grep('message');
      expect(results.length).toBeGreaterThan(0);
    });

    it('searches by regex', async () => {
      const results = await engine.grep('Message \\d+', { mode: 'regex' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('respects limit', async () => {
      const results = await engine.grep('message', { limit: 3 });
      expect(results).toHaveLength(3);
    });
  });

  describe('slice', () => {
    it('returns messages in range', async () => {
      const msgs = await engine.slice(10, 15);
      expect(msgs).toHaveLength(5);
      expect(msgs[0].messageIndex).toBe(10);
      expect(msgs[4].messageIndex).toBe(14);
    });

    it('returns empty for non-existent range', async () => {
      const msgs = await engine.slice(100, 110);
      expect(msgs).toEqual([]);
    });
  });

  describe('query', () => {
    it('returns stub when sub-query engine not set', async () => {
      const result = await engine.query('what happened?');
      expect(result.confidence).toBe('low');
      expect(result.answer).toContain('not initialized');
    });

    it('delegates to sub-query function when set', async () => {
      engine.setSubQueryFn(async (question) => ({
        answer: `Answer to: ${question}`,
        sources: [],
        confidence: 'high',
        tokensUsed: 100,
        costUsd: 0.001,
      }));

      const result = await engine.query('what happened?');
      expect(result.answer).toBe('Answer to: what happened?');
      expect(result.confidence).toBe('high');
    });
  });

  describe('timeline', () => {
    it('returns timeline entries', async () => {
      const tl = await engine.timeline();
      expect(tl.length).toBeGreaterThanOrEqual(1);
      const totalMsgs = tl.reduce((sum, e) => sum + e.messageCount, 0);
      expect(totalMsgs).toBe(50);
    });
  });
});
