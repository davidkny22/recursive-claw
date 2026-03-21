/**
 * Edge case gauntlet — 10 scenarios that stress-test recursive-claw.
 *
 * Note: This test file uses the REPL sandbox (vm module) for testing.
 * This is intentional sandboxed code verification, not arbitrary code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RecursiveClawEngine } from '../../src/engine/context-engine.js';
import { CostTracker } from '../../src/subquery/cost-tracker.js';
import { SQLiteStorage } from '../../src/storage/sqlite-storage.js';
import { createMessage, resetFixtures } from '../helpers/fixtures.js';

describe('Edge Cases', () => {
  let engine: RecursiveClawEngine;
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-edge-'));
    dbPath = join(tempDir, 'edge.db');
    engine = new RecursiveClawEngine(null, { databasePath: dbPath });
    await engine.bootstrap();
  });

  afterAll(async () => {
    await engine.getStorage().close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // 1. Empty session
  it('1. handles empty session gracefully', async () => {
    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('empty-session');
    await engine.getStorage().ensureSession('empty-session');

    expect(await retrieval.grep('anything')).toEqual([]);
    expect(await retrieval.peek(0, 10)).toEqual([]);
    expect(await retrieval.slice(0, 10)).toEqual([]);
    expect(await retrieval.timeline()).toEqual([]);

    const assembled = await engine.assemble({
      sessionId: 'empty-session',
      messages: [{ role: 'system', content: 'You are helpful.' }],
      tokenBudget: 100000,
    });
    expect(assembled.messages.length).toBeGreaterThanOrEqual(1);
    expect(assembled.systemPromptAddition).toContain('0 messages');
  });

  // 2. Single message session
  it('2. handles single-message session', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('single');
    await storage.storeMessage(createMessage({
      sessionId: 'single', messageIndex: 0,
      content: 'The only message about quantum computing.',
    }));

    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('single');

    const results = await retrieval.grep('quantum');
    expect(results).toHaveLength(1);

    const peek = await retrieval.peek(0, 5);
    expect(peek).toHaveLength(1);
  });

  // 3. Unicode/emoji/CJK
  it('3. handles unicode, emoji, and CJK content', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('unicode');

    const msgs = [
      { content: 'Discussion about 数据库设计 and architecture', idx: 0 },
      { content: 'The API returns 🦞 emoji for success', idx: 1 },
      { content: 'مرحبا — RTL text test', idx: 2 },
      { content: 'Ñoño señor — diacritics', idx: 3 },
      { content: '日本語テスト：東京タワー333メートル', idx: 4 },
    ];

    for (const m of msgs) {
      await storage.storeMessage(createMessage({ sessionId: 'unicode', messageIndex: m.idx, content: m.content }));
    }

    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('unicode');

    // Regex search for CJK
    const cjk = await retrieval.grep('数据库', { mode: 'regex' });
    expect(cjk.length).toBeGreaterThanOrEqual(1);

    // Emoji survives round-trip
    const emoji = await retrieval.grep('🦞', { mode: 'regex' });
    expect(emoji.length).toBeGreaterThanOrEqual(1);

    // Diacritics
    const diacritics = await retrieval.grep('señor', { mode: 'regex' });
    expect(diacritics.length).toBeGreaterThanOrEqual(1);

    // All stored
    const all = await retrieval.slice(0, 10);
    expect(all).toHaveLength(5);
  });

  // 4. Very long message (100K chars)
  it('4. handles very long messages', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('longmsg');

    const longContent = 'FINDME_MARKER ' + 'x'.repeat(100_000) + ' END_MARKER';
    await storage.storeMessage(createMessage({ sessionId: 'longmsg', messageIndex: 0, content: longContent }));

    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('longmsg');

    const results = await retrieval.grep('FINDME_MARKER');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet.length).toBeLessThanOrEqual(204);

    const slice = await retrieval.slice(0, 1);
    expect(slice[0].content.length).toBe(longContent.length);
  });

  // 5. Rapid concurrent writes
  it('5. handles rapid concurrent writes', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('rapid');

    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(storage.storeMessage(createMessage({
        sessionId: 'rapid', messageIndex: i,
        content: `Rapid message ${i}: concurrent write test`,
      })));
    }
    await Promise.all(promises);

    const count = await storage.getMessageCount('rapid');
    expect(count).toBe(100);

    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('rapid');
    const results = await retrieval.grep('concurrent write');
    expect(results.length).toBeGreaterThan(0);
  });

  // 6. Cross-session isolation
  it('6. scoped grep does not leak across sessions', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('secret-a');
    await storage.ensureSession('public-b');

    await storage.storeMessage(createMessage({
      sessionId: 'secret-a', messageIndex: 0,
      content: 'TOP SECRET: the nuclear launch codes are 12345',
    }));
    await storage.storeMessage(createMessage({
      sessionId: 'public-b', messageIndex: 0,
      content: 'Public information about weather patterns',
    }));

    const retrieval = engine.getRetrieval();

    retrieval.setCurrentSession('public-b');
    const scoped = await retrieval.grep('nuclear');
    expect(scoped).toHaveLength(0);

    const all = await retrieval.grep('nuclear', { scope: 'all' });
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  // 7. FTS5 special characters
  it('7. handles FTS5 special characters without crashing', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('special');
    await storage.storeMessage(createMessage({
      sessionId: 'special', messageIndex: 0,
      content: 'Error: connection failed at localhost:5432 (PostgreSQL)',
    }));

    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('special');

    const dangerousQueries = [
      'error?', '"connection failed"', 'localhost:5432',
      'error AND connection', 'error OR failed', '(PostgreSQL)',
      'error*', 'connection + failed', '***', '""', '((()',
    ];

    for (const q of dangerousQueries) {
      const results = await retrieval.grep(q);
      expect(Array.isArray(results)).toBe(true);
    }
  });

  // 8. Complex nested metadata
  it('8. stores and retrieves complex metadata', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('metadata');

    await storage.storeMessage(createMessage({
      sessionId: 'metadata', messageIndex: 0, role: 'tool',
      content: 'File created at /src/index.ts',
      metadata: {
        toolName: 'Write',
        filePath: '/src/index.ts',
        params: { content: 'function main() {}', overwrite: true },
        nested: { deep: { value: [1, 2, 3] } },
      },
    }));

    const msgs = await storage.getMessages('metadata');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].metadata!.toolName).toBe('Write');
    expect(msgs[0].metadata!.filePath).toBe('/src/index.ts');
    const nested = msgs[0].metadata!.nested as Record<string, Record<string, number[]>>;
    expect(nested.deep.value).toEqual([1, 2, 3]);
  });

  // 9. Budget exhaustion
  it('9. budget exhaustion blocks sub-queries', () => {
    const tracker = new CostTracker(0.01, 0.02);

    tracker.record({
      provider: 'anthropic', model: 'haiku',
      inputTokens: 1000, outputTokens: 500,
      costUsd: 0.02, timestamp: Date.now(),
    });

    expect(tracker.getRemainingTurnBudget()).toBe(0);
    expect(() => tracker.checkBudget(0.001)).toThrow();

    tracker.resetTurn();
    expect(tracker.getRemainingTurnBudget()).toBe(0.02);
    expect(() => tracker.checkBudget(0.001)).not.toThrow();
  });

  // 10. DB persistence across bootstrap cycles
  it('10. data persists across engine restart', async () => {
    const storage = engine.getStorage();
    await storage.ensureSession('persist');
    await storage.storeMessage(createMessage({
      sessionId: 'persist', messageIndex: 0,
      content: 'Must survive restart: PERSISTENCE_TOKEN_XYZ',
    }));

    await storage.close();

    // New engine, same DB path
    const engine2 = new RecursiveClawEngine(null, { databasePath: dbPath });
    await engine2.bootstrap();

    const retrieval2 = engine2.getRetrieval();
    retrieval2.setCurrentSession('persist');

    const results = await retrieval2.grep('PERSISTENCE_TOKEN_XYZ');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].message.content).toContain('PERSISTENCE_TOKEN_XYZ');

    expect(await engine2.getStorage().getMessageCount('persist')).toBe(1);

    await engine2.getStorage().close();

    // Reopen for afterAll cleanup
    const reopened = new SQLiteStorage(dbPath);
    await reopened.initialize();
    (engine as unknown as Record<string, unknown>).storage = reopened;
  });
});
