import { describe, it, expect } from 'vitest';
import { extractCodeBlocks, detectFinalSignal, parseModelOutput } from '../../../src/retrieval/repl/repl-parser.js';

describe('extractCodeBlocks', () => {
  it('extracts single code block', () => {
    const text = 'Some text\n```repl\nconst x = 1;\nprint(x);\n```\nMore text';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('const x = 1;\nprint(x);');
  });

  it('extracts multiple code blocks', () => {
    const text = '```repl\nfirst();\n```\nthinking...\n```repl\nsecond();\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].code).toBe('first();');
    expect(blocks[1].code).toBe('second();');
  });

  it('returns empty for no code blocks', () => {
    expect(extractCodeBlocks('Just plain text')).toEqual([]);
  });

  it('ignores non-repl code blocks', () => {
    const text = '```javascript\nconst x = 1;\n```\n```repl\nprint(x);\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('print(x);');
  });
});

describe('detectFinalSignal', () => {
  it('detects FINAL()', () => {
    const signal = detectFinalSignal('FINAL(The answer is 42)');
    expect(signal).toEqual({ type: 'final', value: 'The answer is 42' });
  });

  it('detects FINAL_VAR()', () => {
    const signal = detectFinalSignal('FINAL_VAR(result)');
    expect(signal).toEqual({ type: 'final_var', name: 'result' });
  });

  it('FINAL_VAR takes precedence over FINAL', () => {
    const signal = detectFinalSignal('FINAL_VAR(x)\nFINAL(something)');
    expect(signal?.type).toBe('final_var');
  });

  it('strips quotes from FINAL_VAR name', () => {
    const signal = detectFinalSignal("FINAL_VAR('result')");
    expect(signal).toEqual({ type: 'final_var', name: 'result' });
  });

  it('returns null when no signal', () => {
    expect(detectFinalSignal('just some text')).toBeNull();
  });

  it('handles FINAL with parentheses in content', () => {
    const signal = detectFinalSignal('FINAL(f(x) = x^2)');
    expect(signal).toEqual({ type: 'final', value: 'f(x) = x^2' });
  });
});

describe('parseModelOutput', () => {
  it('parses complete model response', () => {
    const text = `Let me search for that.
\`\`\`repl
const results = await grep("JWT");
print(results.length);
\`\`\`
Based on the results:
FINAL(JWT with refresh tokens)`;

    const result = parseModelOutput(text);
    expect(result.codeBlocks).toHaveLength(1);
    expect(result.codeBlocks[0].code).toContain('grep');
    expect(result.finalAnswer).toBe('JWT with refresh tokens');
  });
});
