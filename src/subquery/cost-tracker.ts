import type { UsageRecord, CostSummary, ProviderName } from '../types.js';
import { BudgetExceededError } from '../errors.js';

export class CostTracker {
  private records: UsageRecord[] = [];
  private maxBudgetPerQuery: number;
  private maxBudgetPerTurn: number;
  private turnTotal = 0;

  constructor(maxBudgetPerQuery: number, maxBudgetPerTurn: number) {
    this.maxBudgetPerQuery = maxBudgetPerQuery;
    this.maxBudgetPerTurn = maxBudgetPerTurn;
  }

  /**
   * Check if a query with estimated cost would exceed budgets.
   * Call before dispatching a sub-query.
   */
  checkBudget(estimatedCost: number): void {
    if (estimatedCost > this.maxBudgetPerQuery) {
      throw new BudgetExceededError(estimatedCost, this.maxBudgetPerQuery, 'query');
    }
    if (this.turnTotal + estimatedCost > this.maxBudgetPerTurn) {
      throw new BudgetExceededError(this.turnTotal + estimatedCost, this.maxBudgetPerTurn, 'turn');
    }
  }

  record(usage: UsageRecord): void {
    this.records.push(usage);
    this.turnTotal += usage.costUsd;
  }

  getRemainingTurnBudget(): number {
    return Math.max(0, this.maxBudgetPerTurn - this.turnTotal);
  }

  getTurnTotal(): number {
    return this.turnTotal;
  }

  resetTurn(): void {
    this.turnTotal = 0;
  }

  getSummary(): CostSummary {
    const byProvider: CostSummary['byProvider'] = {};

    for (const r of this.records) {
      const p = byProvider[r.provider] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, callCount: 0 };
      p.costUsd += r.costUsd;
      p.inputTokens += r.inputTokens;
      p.outputTokens += r.outputTokens;
      p.callCount += 1;
      byProvider[r.provider] = p;
    }

    return {
      totalCostUsd: this.records.reduce((sum, r) => sum + r.costUsd, 0),
      totalInputTokens: this.records.reduce((sum, r) => sum + r.inputTokens, 0),
      totalOutputTokens: this.records.reduce((sum, r) => sum + r.outputTokens, 0),
      callCount: this.records.length,
      byProvider,
    };
  }
}
