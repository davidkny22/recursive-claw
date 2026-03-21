import vm from 'node:vm';
import type { REPLResult } from '../../types.js';
import type { REPLBuiltins } from './repl-builtins.js';
import { validateCode } from './code-validator.js';
import { SandboxTimeoutError, RCError } from '../../errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_ITERATIONS = 20;

/**
 * REPL sandbox using Node.js vm module with hardened context.
 *
 * Security layers:
 * 1. Code validation rejects known escape patterns before reaching vm
 * 2. Context has no access to require, import, process, globalThis, etc.
 * 3. Prototype chain access is blocked by code validator
 * 4. Timeout enforcement per code block
 * 5. REPL mode is opt-in (tools mode is the default)
 *
 * Note: Node's vm module is NOT a security sandbox against determined
 * attackers. REPL mode is documented as an advanced/trusted feature.
 * The code validator provides defense-in-depth, not absolute isolation.
 */
export class REPLSandbox {
  private context: vm.Context | null = null;
  private builtins: REPLBuiltins;
  private output: string[] = [];
  private variables = new Map<string, string>();
  private iterationCount = 0;
  private finalAnswer: string | null = null;
  private timeoutMs: number;

  constructor(builtins: REPLBuiltins, opts?: { timeoutMs?: number }) {
    this.builtins = builtins;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async initialize(): Promise<void> {
    // Build a locked-down sandbox context
    const sandbox: Record<string, unknown> = {
      // Console
      print: (...args: unknown[]) => {
        const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        this.output.push(line);
      },
      console: {
        log: (...args: unknown[]) => {
          const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
          this.output.push(line);
        },
      },

      // Variable persistence
      store: (name: string, value: unknown) => {
        this.variables.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      },
      get: (name: string) => {
        const v = this.variables.get(name);
        if (v === undefined) return null;
        try { return JSON.parse(v); } catch { return v; }
      },

      // Completion signals
      FINAL: (value: unknown) => {
        this.finalAnswer = typeof value === 'string' ? value : JSON.stringify(value);
      },
      FINAL_VAR: (name: string) => {
        const val = this.variables.get(name);
        if (val !== undefined) {
          this.finalAnswer = val;
          return val;
        }
        return `Error: Variable '${name}' not found. Available: ${[...this.variables.keys()].join(', ')}`;
      },

      // Retrieval builtins (async — require await in user code)
      peek: async (offset: number, length?: number, sessionId?: string) => {
        const json = await this.builtins.peek(offset, length ?? 10, sessionId);
        return JSON.parse(json);
      },
      grep: async (pattern: string, opts?: Record<string, unknown>) => {
        const json = await this.builtins.grep(pattern, opts ? JSON.stringify(opts) : undefined);
        return JSON.parse(json);
      },
      slice: async (start: number, end: number, sessionId?: string) => {
        const json = await this.builtins.slice(start, end, sessionId);
        return JSON.parse(json);
      },
      query: async (question: string, opts?: Record<string, unknown>) => {
        const json = await this.builtins.query(question, opts ? JSON.stringify(opts) : undefined);
        return JSON.parse(json);
      },
      timeline: async (sessionId?: string) => {
        const json = await this.builtins.timeline(sessionId);
        return JSON.parse(json);
      },
      llm_query: async (prompt: string, context?: string) => {
        return this.builtins.llm_query(prompt, context);
      },

      // Utility
      len: (x: unknown) => {
        if (typeof x === 'string') return x.length;
        if (Array.isArray(x)) return x.length;
        return 0;
      },
      chunk: (text: string, size: number) => {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
        return chunks;
      },

      // Standard JS builtins that are safe
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      setTimeout: undefined, // blocked
      setInterval: undefined, // blocked
    };

    this.context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
  }

  async runCode(code: string): Promise<REPLResult> {
    if (!this.context) {
      throw new RCError('SANDBOX_ERROR', 'Sandbox not initialized. Call initialize() first.');
    }

    if (this.iterationCount >= MAX_ITERATIONS) {
      return {
        output: `Error: Maximum iterations (${MAX_ITERATIONS}) reached.`,
        error: 'Max iterations exceeded',
        variables: Object.fromEntries(this.variables),
        executionTimeMs: 0,
      };
    }

    // Validate code before running
    const validation = validateCode(code);
    if (!validation.valid) {
      return {
        output: `Code rejected: ${validation.reason}`,
        error: validation.reason,
        variables: Object.fromEntries(this.variables),
        executionTimeMs: 0,
      };
    }

    this.iterationCount++;
    this.output = [];
    this.finalAnswer = null;
    const startTime = Date.now();

    try {
      // Wrap in async IIFE for top-level await support
      const wrappedCode = `(async () => { ${code} })()`;

      const script = new vm.Script(wrappedCode);
      const promise = script.runInContext(this.context, { timeout: this.timeoutMs });

      // Await the async IIFE result
      await promise;

      const rawOutput = this.output.join('\n');
      const output = rawOutput.length > MAX_OUTPUT_CHARS
        ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + `\n... [truncated, ${rawOutput.length - MAX_OUTPUT_CHARS} chars omitted]`
        : rawOutput;

      return {
        output,
        finalAnswer: this.finalAnswer ?? undefined,
        variables: Object.fromEntries(this.variables),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = `${err}`;

      if (message.includes('Script execution timed out')) {
        throw new SandboxTimeoutError(this.timeoutMs);
      }

      // Runtime errors returned as output — model learns and retries
      return {
        output: this.output.join('\n'),
        error: message,
        variables: Object.fromEntries(this.variables),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  getFinalAnswer(): string | null {
    return this.finalAnswer;
  }

  getIterationCount(): number {
    return this.iterationCount;
  }

  dispose(): void {
    this.context = null;
  }
}
