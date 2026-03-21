import type { RetrievalEngine } from '../retrieval-engine.js';
import { REPLSandbox } from '../repl/repl-sandbox.js';
import { createBuiltins } from '../repl/repl-builtins.js';

/**
 * Creates a handler for the rc_repl tool.
 * Runs JavaScript code in the REPL sandbox with access to all retrieval functions.
 */
export function createReplHandler(engine: RetrievalEngine) {
  // Persist sandbox across calls within a session for variable persistence
  let sandbox: REPLSandbox | null = null;

  return async (params: Record<string, unknown>) => {
    const code = params.code as string;
    if (!code || typeof code !== 'string') {
      return { output: 'Error: code parameter is required (string)', error: 'missing code' };
    }

    // Lazy init sandbox
    if (!sandbox) {
      const builtins = createBuiltins(engine);
      sandbox = new REPLSandbox(builtins, { timeoutMs: 30_000 });
      await sandbox.initialize();
    }

    const result = await sandbox.runCode(code);

    // Build response
    const parts: string[] = [];
    if (result.output) parts.push(result.output);
    if (result.error) parts.push(`Error: ${result.error}`);
    if (result.finalAnswer) parts.push(`FINAL: ${result.finalAnswer}`);

    const vars = Object.keys(result.variables);
    if (vars.length > 0) parts.push(`Variables: ${vars.join(', ')}`);

    return {
      output: parts.join('\n') || 'No output',
      finalAnswer: result.finalAnswer,
      executionTimeMs: result.executionTimeMs,
      iteration: sandbox.getIterationCount(),
    };
  };
}
