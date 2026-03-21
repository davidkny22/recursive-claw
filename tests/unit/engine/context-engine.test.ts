import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RecursiveClawEngine } from '../../../src/engine/context-engine.js';

describe('RecursiveClawEngine', () => {
  let engine: RecursiveClawEngine;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rc-engine-test-'));
    dbPath = join(tempDir, 'context.db');

    engine = new RecursiveClawEngine(null, {
      mode: 'tools',
      databasePath: dbPath,
    });

    await engine.bootstrap();
  });

  afterEach(async () => {
    const storage = engine.getStorage();
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('bootstraps with correct config', () => {
    const config = engine.getConfig();
    expect(config.mode).toBe('tools');
    expect(config.databasePath).toBe(dbPath);
  });

  it('has correct engine info', () => {
    expect(engine.info.id).toBe('recursive-claw');
    expect(engine.info.ownsCompaction).toBe(true);
  });

  it('ingests messages and increments index', async () => {
    await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'user', content: 'Hello world' },
    });
    await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'assistant', content: 'Hi there' },
    });

    const storage = engine.getStorage();
    const count = await storage.getMessageCount('test-session');
    expect(count).toBe(2);
  });

  it('skips heartbeat messages', async () => {
    await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'system', content: 'heartbeat' },
      isHeartbeat: true,
    });

    const storage = engine.getStorage();
    const session = await storage.getSession('test-session');
    expect(session).toBeNull();
  });

  it('assembles with fresh tail and manifest', async () => {
    // Ingest some messages
    for (let i = 0; i < 30; i++) {
      await engine.ingest({
        sessionId: 'test-session',
        message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` },
      });
    }

    const result = await engine.assemble({
      sessionId: 'test-session',
      messages: [{ role: 'system', content: 'You are helpful.' }],
      tokenBudget: 100000,
    });

    // 1 system + 20 tail (default freshTailCount)
    expect(result.messages).toHaveLength(21);
    expect(result.messages[0].content).toBe('You are helpful.');
    expect(result.systemPromptAddition).toContain('30 messages');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('compact returns ok without destroying data', async () => {
    await engine.ingest({
      sessionId: 's1',
      message: { role: 'user', content: 'Important context' },
    });

    const result = await engine.compact({ sessionId: 's1' });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);

    // Data still exists
    const count = await engine.getStorage().getMessageCount('s1');
    expect(count).toBe(1);
  });

  it('afterTurn resets cost tracker', async () => {
    const tracker = engine.getCostTracker();
    tracker.record({
      provider: 'anthropic', model: 'haiku',
      inputTokens: 100, outputTokens: 50,
      costUsd: 0.05, timestamp: Date.now(),
    });

    expect(tracker.getTurnTotal()).toBe(0.05);
    await engine.afterTurn();
    expect(tracker.getTurnTotal()).toBe(0);
  });
});
