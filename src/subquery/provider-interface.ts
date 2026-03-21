import type { SubQueryCompletion } from '../types.js';

export interface SubQueryProvider {
  readonly name: string;
  readonly model: string;

  complete(
    messages: Array<{ role: string; content: string }>,
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<SubQueryCompletion>;
}
