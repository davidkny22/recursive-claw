import type { RetrievalEngine } from '../retrieval/retrieval-engine.js';
import type { SubQueryResult, ProviderName } from '../types.js';
import { CostTracker } from './cost-tracker.js';
import { ProviderRouter } from './provider-router.js';
import { buildSubQueryMessages } from './prompt-templates.js';
import { estimateTokens } from '../token-estimator.js';
import { BudgetExceededError } from '../errors.js';

const MAX_MESSAGES_PER_QUERY = 50;
const MAX_TOKENS_PER_QUERY = 30_000;

export class SubQueryEngine {
  private retrieval: RetrievalEngine;
  private router: ProviderRouter;
  private costTracker: CostTracker;

  constructor(retrieval: RetrievalEngine, router: ProviderRouter, costTracker: CostTracker) {
    this.retrieval = retrieval;
    this.router = router;
    this.costTracker = costTracker;
  }

  async query(
    question: string,
    opts?: { scope?: 'current' | 'all'; model?: string; budget?: number }
  ): Promise<SubQueryResult> {
    // 1. Grep for relevant messages
    const grepResults = await this.retrieval.grep(question, {
      scope: opts?.scope ?? 'current',
      limit: MAX_MESSAGES_PER_QUERY,
    });

    // 2. If 0 results, return immediately without calling cheap model
    if (grepResults.length === 0) {
      return {
        answer: 'No relevant history found for this query.',
        sources: [],
        confidence: 'low',
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // 3. Trim to token budget
    let tokenCount = 0;
    const messages = [];
    for (const result of grepResults) {
      const msgTokens = estimateTokens(result.message.content);
      if (tokenCount + msgTokens > MAX_TOKENS_PER_QUERY) break;
      tokenCount += msgTokens;
      messages.push(result.message);
    }

    // 4. Check budget before dispatching
    try {
      // Rough estimate: input tokens + ~256 output tokens at Haiku pricing
      const estimatedCost = (tokenCount * 1.0 + 256 * 5.0) / 1_000_000;
      this.costTracker.checkBudget(estimatedCost);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return {
          answer: `Budget limit reached ($${this.costTracker.getTurnTotal().toFixed(4)} spent of turn cap). Use rc_peek or rc_grep for direct access (no sub-query cost).`,
          sources: [],
          confidence: 'low',
          tokensUsed: 0,
          costUsd: 0,
        };
      }
      throw err;
    }

    // 5. Build prompt and call cheap model
    const promptMessages = buildSubQueryMessages(question, messages);
    const completion = await this.router.complete(promptMessages, {
      model: opts?.model,
    });

    // 6. Record cost
    this.costTracker.record({
      provider: 'anthropic' as ProviderName, // TODO: derive from router
      model: 'claude-haiku-4-5',
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      costUsd: completion.cost,
      timestamp: Date.now(),
    });

    // 7. Return structured result
    return {
      answer: completion.content,
      sources: messages.map(m => ({
        sessionId: m.sessionId,
        messageIndex: m.messageIndex,
        timestamp: m.timestamp,
      })),
      confidence: grepResults.length >= 3 ? 'high' : 'low',
      tokensUsed: completion.usage.inputTokens + completion.usage.outputTokens,
      costUsd: completion.cost,
    };
  }

  getCostTracker(): CostTracker {
    return this.costTracker;
  }
}
