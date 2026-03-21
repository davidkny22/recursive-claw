/**
 * End-to-end verification test.
 *
 * Simulates a realistic multi-session OpenClaw conversation with planted
 * facts at known depths, tool calls, and cross-session references. Verifies
 * that recursive-claw can find every planted fact, maintains zero information
 * loss, and produces correct assemble() output.
 *
 * This file intentionally uses the REPL sandbox (Node.js vm module) for
 * testing model-generated code patterns. This is not arbitrary code — it
 * verifies the sandbox integration against real storage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RecursiveClawEngine } from '../../src/engine/context-engine.js';
import { REPLSandbox } from '../../src/retrieval/repl/repl-sandbox.js';
import { createBuiltins } from '../../src/retrieval/repl/repl-builtins.js';
import type { RetrievalEngine } from '../../src/retrieval/retrieval-engine.js';

// ======================================================================
// Planted facts — ground truth we verify retrieval against
// ======================================================================
const PLANTED_FACTS = {
  dbChoice: { session: 'arch-session', index: 3, content: 'DECISION: We will use PostgreSQL 16 with pgvector extension for embeddings storage' },
  authChoice: { session: 'arch-session', index: 7, content: 'DECISION: JWT authentication with RS256 signing, 15-minute access tokens, 7-day refresh tokens stored server-side in Redis' },
  cacheChoice: { session: 'arch-session', index: 15, content: 'DECISION: Redis for session cache and rate limiting, with 5-minute TTL on API responses' },
  apiEndpoint: { session: 'impl-session', index: 5, content: 'Created POST /api/v1/agents endpoint with OpenAPI schema validation and rate limiting at 100 req/min' },
  errorFormat: { session: 'impl-session', index: 12, content: 'STANDARD: All API errors return { error: { code: string, message: string, details?: unknown } } with appropriate HTTP status codes' },
  envConfig: { session: 'impl-session', index: 20, content: 'Environment config: DATABASE_URL, REDIS_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, RATE_LIMIT_WINDOW=60000, RATE_LIMIT_MAX=100' },
  rootCause: { session: 'debug-session', index: 25, content: 'ROOT CAUSE: The connection pool was exhausted because pgBouncer max_client_conn was set to 20 but the app spawns 50 concurrent queries during batch ingestion' },
  fix: { session: 'debug-session', index: 30, content: 'FIX APPLIED: Increased pgBouncer max_client_conn to 100, added connection timeout of 5s, and implemented query batching to limit concurrent queries to 10' },
};

describe('E2E: Realistic multi-session verification', () => {
  let engine: RecursiveClawEngine;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rc-e2e-'));

    engine = new RecursiveClawEngine(null, {
      mode: 'tools',
      databasePath: join(tempDir, 'e2e.db'),
      freshTailCount: 10,
    });
    await engine.bootstrap();

    // Session 1: Architecture decisions (40 messages)
    for (let i = 0; i < 40; i++) {
      const planted = Object.values(PLANTED_FACTS).find(f => f.session === 'arch-session' && f.index === i);
      await engine.ingest({
        sessionId: 'arch-session',
        message: {
          role: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool',
          content: planted?.content ?? `Architecture discussion turn ${i}: exploring options for the system design`,
        },
      });
    }

    // Session 2: Implementation (35 messages with tool calls)
    for (let i = 0; i < 35; i++) {
      const planted = Object.values(PLANTED_FACTS).find(f => f.session === 'impl-session' && f.index === i);
      const role = i % 4 === 0 ? 'user' : i % 4 === 1 ? 'assistant' : i % 4 === 2 ? 'tool' : 'assistant';
      await engine.ingest({
        sessionId: 'impl-session',
        message: {
          role,
          content: planted?.content ?? `Implementation work turn ${i}: writing code and running tests`,
          ...(role === 'tool' ? { metadata: { toolName: 'Write', filePath: `src/file-${i}.ts` } } : {}),
        },
      });
    }

    // Session 3: Debug session (40 messages, facts planted deep)
    for (let i = 0; i < 40; i++) {
      const planted = Object.values(PLANTED_FACTS).find(f => f.session === 'debug-session' && f.index === i);
      await engine.ingest({
        sessionId: 'debug-session',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: planted?.content ?? `Debug investigation turn ${i}: analyzing logs and stack traces`,
        },
      });
    }
  });

  afterAll(async () => {
    await engine.getStorage().close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ==================================================================
  // 1. ASSEMBLE OUTPUT SHAPE
  // ==================================================================
  describe('assemble() output', () => {
    it('returns correct message count in manifest', async () => {
      const result = await engine.assemble({
        sessionId: 'arch-session',
        messages: [{ role: 'system', content: 'You are a coding assistant.' }],
        tokenBudget: 200000,
      });

      expect(result.messages).toHaveLength(11);
      expect(result.systemPromptAddition).toContain('115 messages');
      expect(result.systemPromptAddition).toContain('3 session(s)');
    });

    it('fresh tail contains only the most recent messages', async () => {
      const result = await engine.assemble({
        sessionId: 'debug-session',
        messages: [],
        tokenBudget: 200000,
      });

      expect(result.messages).toHaveLength(10);
      expect(result.messages[9].content).toContain('turn 39');
    });

    it('does NOT include full history in assembled context', async () => {
      const result = await engine.assemble({
        sessionId: 'arch-session',
        messages: [{ role: 'system', content: 'System prompt.' }],
        tokenBudget: 200000,
      });

      const allContent = result.messages.map(m => m.content).join(' ');
      expect(allContent).not.toContain('PostgreSQL 16 with pgvector');
    });
  });

  // ==================================================================
  // 2. RETRIEVAL ACCURACY — find every planted fact
  // ==================================================================
  describe('retrieval accuracy', () => {
    let r: ReturnType<typeof engine.getRetrieval>;
    beforeAll(() => { r = engine.getRetrieval(); r.setCurrentSession('arch-session'); });

    it('finds database decision (FTS)', async () => {
      const results = await r.grep('PostgreSQL pgvector', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(res => res.snippet.includes('pgvector'))).toBe(true);
    });

    it('finds auth decision (FTS)', async () => {
      const results = await r.grep('JWT RS256 refresh', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(res => res.snippet.includes('RS256'))).toBe(true);
    });

    it('finds cache decision (FTS)', async () => {
      const results = await r.grep('Redis TTL', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds API endpoint (FTS)', async () => {
      const results = await r.grep('agents endpoint OpenAPI', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds error format (FTS)', async () => {
      const results = await r.grep('error code message', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds root cause (regex)', async () => {
      const results = await r.grep('pgBouncer.*max_client_conn', { mode: 'regex', scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(res => res.snippet.includes('exhausted'))).toBe(true);
    });

    it('finds fix (FTS)', async () => {
      const results = await r.grep('FIX query batching', { scope: 'all' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('retrieves planted fact by exact position (slice)', async () => {
      const results = await r.slice(3, 4, 'arch-session');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('PostgreSQL 16 with pgvector');
    });

    it('retrieves deep fact via peek with offset', async () => {
      const results = await r.peek(14, 1, 'debug-session');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('connection pool was exhausted');
    });
  });

  // ==================================================================
  // 3. CROSS-SESSION
  // ==================================================================
  describe('cross-session retrieval', () => {
    it('finds mentions across sessions', async () => {
      const r = engine.getRetrieval();
      const results = await r.grep('PostgreSQL', { scope: 'all' });
      const sessions = new Set(results.map(res => res.message.sessionId));
      expect(sessions.size).toBeGreaterThanOrEqual(1);
    });

    it('timeline shows correct totals', async () => {
      const r = engine.getRetrieval();
      const entries = await r.timeline('arch-session');
      const totalMsgs = entries.reduce((sum, e) => sum + e.messageCount, 0);
      expect(totalMsgs).toBe(40);
    });
  });

  // ==================================================================
  // 4. COMPACT PRESERVES ALL DATA
  // ==================================================================
  describe('compact preserves data', () => {
    it('all facts survive compact', async () => {
      await engine.compact({ sessionId: 'arch-session', force: true });
      await engine.compact({ sessionId: 'impl-session', force: true });
      await engine.compact({ sessionId: 'debug-session', force: true });

      const r = engine.getRetrieval();

      const r1 = await r.grep('pgvector', { scope: 'all' });
      expect(r1.length).toBeGreaterThanOrEqual(1);

      const r2 = await r.grep('RS256', { scope: 'all' });
      expect(r2.length).toBeGreaterThanOrEqual(1);

      const r3 = await r.grep('query batching', { scope: 'all' });
      expect(r3.length).toBeGreaterThanOrEqual(1);

      const storage = engine.getStorage();
      const total = await storage.getMessageCount('arch-session')
        + await storage.getMessageCount('impl-session')
        + await storage.getMessageCount('debug-session');
      expect(total).toBe(115);
    });
  });

  // ==================================================================
  // 5. REPL MODE INTEGRATION (against real storage)
  // ==================================================================
  describe('REPL sandbox with real storage', () => {
    it('grep from REPL finds planted fact', async () => {
      engine.getRetrieval().setCurrentSession('arch-session');
      const builtins = createBuiltins(engine.getRetrieval());
      const sandbox = new REPLSandbox(builtins, { timeoutMs: 10000 });
      await sandbox.initialize();

      const result = await sandbox.runCode(`
        const results = await grep("PostgreSQL pgvector");
        print("Found " + results.length + " results");
        if (results.length > 0) {
          FINAL(results[0].snippet);
        } else {
          FINAL("not found");
        }
      `);

      expect(result.output).toContain('Found');
      expect(result.finalAnswer).toContain('pgvector');
      sandbox.dispose();
    });

    it('variable persistence across code blocks', async () => {
      const builtins = createBuiltins(engine.getRetrieval());
      const sandbox = new REPLSandbox(builtins, { timeoutMs: 10000 });
      await sandbox.initialize();

      await sandbox.runCode('store("count", 42);');
      const result = await sandbox.runCode('const count = get("count"); FINAL("Count is " + count);');
      expect(result.finalAnswer).toBe('Count is 42');
      sandbox.dispose();
    });

    it('peek from REPL reads recent messages', async () => {
      engine.getRetrieval().setCurrentSession('debug-session');
      const builtins = createBuiltins(engine.getRetrieval());
      const sandbox = new REPLSandbox(builtins, { timeoutMs: 10000 });
      await sandbox.initialize();

      const result = await sandbox.runCode(`
        const msgs = await peek(0, 3);
        print("Got " + msgs.length + " messages");
        FINAL(msgs.map(m => m.messageIndex).join(","));
      `);

      expect(result.output).toContain('Got 3');
      expect(result.finalAnswer).toContain('37,38,39');
      sandbox.dispose();
    });
  });

  // ==================================================================
  // 6. COST TRACKING
  // ==================================================================
  describe('cost tracking', () => {
    it('tracker starts at zero each turn', () => {
      expect(engine.getCostTracker().getTurnTotal()).toBe(0);
    });

    it('afterTurn resets cost', async () => {
      const tracker = engine.getCostTracker();
      tracker.record({
        provider: 'anthropic', model: 'haiku',
        inputTokens: 500, outputTokens: 200,
        costUsd: 0.003, timestamp: Date.now(),
      });
      expect(tracker.getTurnTotal()).toBe(0.003);

      await engine.afterTurn();
      expect(tracker.getTurnTotal()).toBe(0);
    });
  });
});
