import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/token-estimator.js';

describe('estimateTokens', () => {
  it('estimates tokens as ceil(chars/4)', () => {
    expect(estimateTokens('hello')).toBe(2); // 5/4 = 1.25 → 2
    expect(estimateTokens('hi')).toBe(1); // 2/4 = 0.5 → 1
    expect(estimateTokens('hello world')).toBe(3); // 11/4 = 2.75 → 3
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles long text', () => {
    const text = 'a'.repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });

  it('handles unicode/CJK characters', () => {
    const text = '你好世界'; // 4 CJK chars = 12 bytes in UTF-8, but 4 JS chars
    expect(estimateTokens(text)).toBe(1);
  });
});
