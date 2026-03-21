import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../src/storage/sqlite-storage.js';
import { RetrievalEngine } from '../../src/retrieval/retrieval-engine.js';
import { SubQueryEngine } from '../../src/subquery/subquery-engine.js';
import { ProviderRouter } from '../../src/subquery/provider-router.js';
import { CostTracker } from '../../src/subquery/cost-tracker.js';
import { createMessage, resetFixtures } from '../helpers/fixtures.js';
import type { SubQueryConfig } from '../../src/types.js';

// Mock router that always succeeds
class MockRouter extends ProviderRouter {
  async complete(): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number }; cost: number }> {
    return { content: 'Mock answer', usage: { inputTokens: 50, outputTokens: 25 }, cost: 0.03 };
  }
}

describe('Budget enforcement integration', () => {
  let storage: SQLiteStorage;
  let retrieval: RetrievalEngine;
  let costTracker: CostTracker;
  let engine: SubQueryEngine;
  let tempDir: string;

  const config: SubQueryConfig = {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    providers: {},
    maxBudgetPerQuery: 0.05,
    maxBudgetPerTurn: 0.05,
    maxConcurrent: 4,
    maxDepth: 1,
    timeout: 30000,
  };

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-budget-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
    await storage.ensureSession('s1');

    for (let i = 0; i < 20; i++) {
      await storage.storeMessage(createMessage({
        sessionId: 's1',
        messageIndex: i,
        content: `Discussion about authentication and JWT tokens: message ${i}`,
      }));
    }

    retrieval = new RetrievalEngine(storage, 's1');
    costTracker = new CostTracker(config.maxBudgetPerQuery, config.maxBudgetPerTurn);
    const router = new MockRouter(config);
    engine = new SubQueryEngine(retrieval, router, costTracker);
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows first query within budget', async () => {
    const result = await engine.query('JWT authentication');
    expect(result.answer).toBe('Mock answer');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(costTracker.getTurnTotal()).toBeGreaterThan(0);
  });

  it('blocks query when turn budget exhausted', async () => {
    // First query costs 0.03
    await engine.query('JWT authentication');

    // Second query costs 0.03, total would be 0.06, but turn cap is 0.08
    await engine.query('JWT tokens');

    // Third query would push to 0.09 > 0.08 turn cap
    const result = await engine.query('authentication');
    expect(result.confidence).toBe('low');
    expect(result.answer).toContain('Budget limit');
  });

  it('resets budget after turn', async () => {
    // Use up budget
    await engine.query('JWT');
    await engine.query('tokens');

    // Reset
    costTracker.resetTurn();

    // Should work again
    const result = await engine.query('authentication');
    expect(result.answer).toBe('Mock answer');
  });
});
