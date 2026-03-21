import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { REPLSandbox } from '../../../src/retrieval/repl/repl-sandbox.js';
import type { REPLBuiltins } from '../../../src/retrieval/repl/repl-builtins.js';

// Minimal mock builtins for sandbox testing
function createMockBuiltins(): REPLBuiltins {
  return {
    peek: async () => JSON.stringify([{ messageIndex: 0, role: 'user', content: 'test' }]),
    grep: async () => JSON.stringify([{ messageIndex: 0, snippet: 'test result' }]),
    slice: async () => JSON.stringify([]),
    query: async () => JSON.stringify({ answer: 'mock answer' }),
    timeline: async () => JSON.stringify([]),
    llm_query: async (prompt: string) => `Answer to: ${prompt}`,
    len: (text: string) => text.length,
    chunk: (text: string, size: number) => {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      return JSON.stringify(chunks);
    },
  };
}

describe('REPLSandbox', () => {
  let sandbox: REPLSandbox;

  beforeEach(async () => {
    sandbox = new REPLSandbox(createMockBuiltins(), { timeoutMs: 5000 });
    await sandbox.initialize();
  });

  afterEach(() => {
    sandbox.dispose();
  });

  it('runs simple code and captures print output', async () => {
    const result = await sandbox.runCode('print("hello world");');
    expect(result.output).toBe('hello world');
    expect(result.error).toBeUndefined();
  });

  it('persists variables across code blocks via store/get', async () => {
    await sandbox.runCode('store("myVar", "hello");');
    const result = await sandbox.runCode('print(get("myVar"));');
    expect(result.output).toBe('hello');
  });

  it('detects FINAL signal', async () => {
    const result = await sandbox.runCode('FINAL("the answer is 42");');
    expect(result.finalAnswer).toBe('the answer is 42');
    expect(sandbox.getFinalAnswer()).toBe('the answer is 42');
  });

  it('detects FINAL_VAR signal', async () => {
    await sandbox.runCode('store("result", "computed value");');
    const result = await sandbox.runCode('FINAL_VAR("result");');
    expect(result.finalAnswer).toBe('computed value');
  });

  it('handles runtime errors gracefully', async () => {
    const result = await sandbox.runCode('undefinedFunction();');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('undefinedFunction');
  });

  it('rejects blocked code patterns', async () => {
    const result = await sandbox.runCode('process.env.SECRET');
    expect(result.error).toBeDefined();
    expect(result.output).toContain('rejected');
  });

  it('tracks iteration count', async () => {
    await sandbox.runCode('print("1");');
    await sandbox.runCode('print("2");');
    expect(sandbox.getIterationCount()).toBe(2);
  });

  it('enforces max iterations', async () => {
    // Create sandbox with very low iteration for testing
    const limitedSandbox = new REPLSandbox(createMockBuiltins(), { timeoutMs: 5000 });
    await limitedSandbox.initialize();

    // Run 20 iterations
    for (let i = 0; i < 20; i++) {
      await limitedSandbox.runCode(`print("${i}");`);
    }

    // 21st should fail
    const result = await limitedSandbox.runCode('print("too many");');
    expect(result.error).toContain('Max iterations');

    limitedSandbox.dispose();
  });

  it('truncates long output', async () => {
    const result = await sandbox.runCode(`
      for (let i = 0; i < 10000; i++) {
        print("x".repeat(100));
      }
    `);
    // Output should be truncated to ~20K chars
    expect(result.output.length).toBeLessThanOrEqual(20100);
    if (result.output.length > 20000) {
      expect(result.output).toContain('truncated');
    }
  });

  it('calls peek builtin', async () => {
    const result = await sandbox.runCode(`
      const msgs = await peek(0, 10);
      print(JSON.stringify(msgs));
    `);
    expect(result.output).toContain('messageIndex');
  });

  it('calls grep builtin', async () => {
    const result = await sandbox.runCode(`
      const results = await grep("test");
      print(results.length);
    `);
    expect(result.output).toBe('1');
  });
});
