import type { RetrievalEngine } from '../retrieval-engine.js';

export function createQueryHandler(engine: RetrievalEngine) {
  return async (params: Record<string, unknown>) => {
    const question = params.question as string;
    const scope = params.scope as 'current' | 'all' | undefined;
    const model = params.model as string | undefined;
    const budget = params.budget as number | undefined;

    const result = await engine.query(question, { scope, model, budget });

    return {
      answer: result.answer,
      sources: result.sources,
      confidence: result.confidence,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
    };
  };
}
