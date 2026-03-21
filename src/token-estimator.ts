/**
 * Estimate token count for a string using the chars/4 heuristic.
 * This is a fast approximation — accurate enough for budget calculations
 * without requiring a tokenizer dependency.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
