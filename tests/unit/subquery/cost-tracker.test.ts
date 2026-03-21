import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '../../../src/subquery/cost-tracker.js';
import { BudgetExceededError } from '../../../src/errors.js';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker(0.05, 0.10);
  });

  it('starts with zero totals', () => {
    expect(tracker.getTurnTotal()).toBe(0);
    expect(tracker.getRemainingTurnBudget()).toBe(0.10);
  });

  it('records usage and accumulates cost', () => {
    tracker.record({
      provider: 'anthropic', model: 'haiku', inputTokens: 1000, outputTokens: 200, costUsd: 0.002, timestamp: Date.now(),
    });
    expect(tracker.getTurnTotal()).toBe(0.002);
    expect(tracker.getRemainingTurnBudget()).toBeCloseTo(0.098);
  });

  it('throws BudgetExceededError when query exceeds per-query budget', () => {
    expect(() => tracker.checkBudget(0.06)).toThrow(BudgetExceededError);
  });

  it('throws BudgetExceededError when accumulated cost exceeds turn budget', () => {
    tracker.record({
      provider: 'anthropic', model: 'haiku', inputTokens: 1000, outputTokens: 200, costUsd: 0.08, timestamp: Date.now(),
    });
    expect(() => tracker.checkBudget(0.03)).toThrow(BudgetExceededError);
  });

  it('allows queries within budget', () => {
    expect(() => tracker.checkBudget(0.04)).not.toThrow();
  });

  it('resets turn totals', () => {
    tracker.record({
      provider: 'anthropic', model: 'haiku', inputTokens: 1000, outputTokens: 200, costUsd: 0.05, timestamp: Date.now(),
    });
    tracker.resetTurn();
    expect(tracker.getTurnTotal()).toBe(0);
    expect(tracker.getRemainingTurnBudget()).toBe(0.10);
  });

  it('generates summary by provider', () => {
    tracker.record({ provider: 'anthropic', model: 'haiku', inputTokens: 100, outputTokens: 50, costUsd: 0.001, timestamp: Date.now() });
    tracker.record({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100, costUsd: 0.002, timestamp: Date.now() });
    tracker.record({ provider: 'anthropic', model: 'haiku', inputTokens: 150, outputTokens: 75, costUsd: 0.0015, timestamp: Date.now() });

    const summary = tracker.getSummary();
    expect(summary.callCount).toBe(3);
    expect(summary.totalCostUsd).toBeCloseTo(0.0045);
    expect(summary.byProvider.anthropic?.callCount).toBe(2);
    expect(summary.byProvider.openai?.callCount).toBe(1);
  });
});
