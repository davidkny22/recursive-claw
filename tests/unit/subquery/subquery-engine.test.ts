import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { RetrievalEngine } from '../../../src/retrieval/retrieval-engine.js';
import { SubQueryEngine } from '../../../src/subquery/subquery-engine.js';
import { ProviderRouter } from '../../../src/subquery/provider-router.js';
import { CostTracker } from '../../../src/subquery/cost-tracker.js';
import { createMessage, resetFixtures } from '../../helpers/fixtures.js';
import type { SubQueryConfig } from '../../../src/types.js';

// Mock provider router that uses a simple mock instead of real APIs
class MockRouter extends ProviderRouter {
  mockResponse = 'JWT with refresh tokens, stored server-side.';
  callCount = 0;

  async complete(): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number }; cost: number }> {
    this.callCount++;
    return {
      content: this.mockResponse,
      usage: { inputTokens: 100, outputTokens: 50 },
      cost: 0.001,
    };
  }
}

const mockConfig: SubQueryConfig = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-haiku-4-5',
  providers: {},
  maxBudgetPerQuery: 0.05,
  maxBudgetPerTurn: 0.10,
  maxConcurrent: 4,
  maxDepth: 1,
  timeout: 30000,
};

describe('SubQueryEngine', () => {
  let storage: SQLiteStorage;
  let retrieval: RetrievalEngine;
  let router: MockRouter;
  let costTracker: CostTracker;
  let engine: SubQueryEngine;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-subquery-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
    await storage.ensureSession('s1');

    // Seed with relevant messages
    const messages = [
      createMessage({ sessionId: 's1', messageIndex: 0, role: 'user', content: 'Set up authentication with JWT tokens' }),
      createMessage({ sessionId: 's1', messageIndex: 1, role: 'assistant', content: 'I will use JWT with refresh tokens stored server-side' }),
      createMessage({ sessionId: 's1', messageIndex: 2, role: 'user', content: 'Add rate limiting to the API' }),
      createMessage({ sessionId: 's1', messageIndex: 3, role: 'assistant', content: 'Adding express-rate-limit with 100 requests per minute' }),
      createMessage({ sessionId: 's1', messageIndex: 4, role: 'user', content: 'Deploy everything to Railway' }),
    ];
    for (const msg of messages) await storage.storeMessage(msg);

    retrieval = new RetrievalEngine(storage, 's1');
    router = new MockRouter(mockConfig);
    costTracker = new CostTracker(0.05, 0.10);
    engine = new SubQueryEngine(retrieval, router, costTracker);
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns focused answer from cheap model', async () => {
    const result = await engine.query('JWT tokens authentication');
    expect(result.answer).toBe('JWT with refresh tokens, stored server-side.');
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(router.callCount).toBe(1);
  });

  it('returns low-confidence empty result when no grep matches', async () => {
    const result = await engine.query('What color is the sky on Mars?');
    expect(result.confidence).toBe('low');
    expect(result.answer).toContain('No relevant history');
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(router.callCount).toBe(0);
  });

  it('records cost after successful query', async () => {
    await engine.query('JWT authentication');
    const summary = costTracker.getSummary();
    expect(summary.callCount).toBe(1);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
  });

  it('returns budget message when turn budget exhausted', async () => {
    // Exhaust budget completely — exceed the turn cap
    costTracker.record({
      provider: 'anthropic', model: 'haiku',
      inputTokens: 10000, outputTokens: 5000, costUsd: 0.10, timestamp: Date.now(),
    });

    const result = await engine.query('JWT');
    expect(result.confidence).toBe('low');
    expect(result.answer).toContain('Budget limit');
    expect(result.costUsd).toBe(0);
  });

  it('reports high confidence when 3+ grep results', async () => {
    // Add more JWT-related messages to get 3+ hits
    await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 5, content: 'JWT token expiry set to 15 minutes' }));
    await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 6, content: 'JWT secret rotated weekly' }));

    const result = await engine.query('JWT');
    expect(result.confidence).toBe('high');
  });
});
