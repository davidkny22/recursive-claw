import type { StorageInterface } from '../storage/storage-interface.js';
import type { AssembleResult, RecursiveClawConfig } from '../types.js';
import { buildManifest, formatManifestForPrompt } from './manifest.js';
import { estimateTokens } from '../token-estimator.js';

/**
 * Assembler handles the assemble() hook — building what goes into the context window.
 *
 * The key insight: we include ONLY the fresh tail + a manifest + tool/REPL instructions.
 * History stays external. The model queries it on demand.
 */
export class Assembler {
  private storage: StorageInterface;
  private config: RecursiveClawConfig;

  constructor(storage: StorageInterface, config: RecursiveClawConfig) {
    this.storage = storage;
    this.config = config;
  }

  async assemble(sessionId: string, systemMessages: Array<{ role: string; content: string }>): Promise<AssembleResult> {
    // 1. Get fresh tail
    const tail = await this.storage.getTailMessages(sessionId, this.config.freshTailCount);
    const tailMessages = tail.map(m => ({ role: m.role, content: m.content }));

    // 2. Build manifest
    const manifest = await buildManifest(this.storage, sessionId);

    // 3. Generate system prompt addition based on mode
    let systemPromptAddition: string;

    if (this.config.mode === 'repl') {
      systemPromptAddition = this.buildREPLInstructions(manifest);
    } else {
      systemPromptAddition = formatManifestForPrompt(manifest);
    }

    // 4. Combine: system messages + tail
    const messages = [...systemMessages, ...tailMessages];

    // 5. Estimate tokens
    const totalText = messages.map(m => m.content).join('') + systemPromptAddition;
    const estimatedTokens = estimateTokens(totalText);

    return {
      messages,
      estimatedTokens,
      systemPromptAddition,
    };
  }

  private buildREPLInstructions(manifest: ReturnType<typeof buildManifest> extends Promise<infer T> ? T : never): string {
    const lines: string[] = [];

    lines.push(`You have ${manifest.messageCount} messages of history available across ${manifest.sessionCount} session(s).`);

    if (manifest.timeRange) {
      const from = new Date(manifest.timeRange.earliest).toISOString();
      const to = new Date(manifest.timeRange.latest).toISOString();
      lines.push(`Time range: ${from} to ${to}`);
    }

    lines.push(`Total tokens stored: ~${manifest.totalTokens.toLocaleString()}`);
    lines.push('');
    lines.push('You have a REPL environment available. Write JavaScript in ```repl``` code blocks to query history.');
    lines.push('Available functions: peek(offset, length), grep(pattern, opts), slice(start, end),');
    lines.push('query(question, opts), timeline(), llm_query(prompt, context), llm_query_parallel(queries),');
    lines.push('len(x), chunk(arr, size), print(...args), store(name, value), get(name).');
    lines.push('Signal completion with FINAL(answer) or FINAL_VAR(variableName).');

    return lines.join('\n');
  }
}
