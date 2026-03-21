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

  async assemble(
    sessionId: string,
    systemMessages: Array<{ role: string; content: unknown }>,
    pipelineMessages?: Array<{ role: string; content: unknown }>
  ): Promise<AssembleResult> {
    // 1. Get fresh tail from the pipeline messages (already in correct format)
    // We use the pipeline messages directly because they contain proper
    // tool_use_id references and Anthropic content block structure.
    // If no pipeline messages, fall back to DB.
    let tailMessages: Array<{ role: string; content: unknown }>;

    const nonSystemPipeline = pipelineMessages?.filter(m => m.role !== 'system') ?? [];
    if (nonSystemPipeline.length > 0) {
      // Use pipeline messages directly — they have proper content block structure.
      // Start from the end and walk backward to find a safe cut point where
      // no tool_result is orphaned (missing its tool_use in the window).
      let candidate = nonSystemPipeline.slice(-this.config.freshTailCount);

      // Walk forward: if first message contains tool_result blocks, skip it
      // to avoid orphaned references. Keep trimming until we start with a
      // user or assistant message (not a tool_result continuation).
      while (candidate.length > 0) {
        const first = candidate[0];
        const content = first.content;
        const isToolResult = first.role === 'tool'
          || (Array.isArray(content) && content.some((b: Record<string, unknown>) => b.type === 'tool_result'));
        if (isToolResult) {
          candidate = candidate.slice(1);
        } else {
          break;
        }
      }

      tailMessages = candidate;
    } else {
      const tail = await this.storage.getTailMessages(sessionId, this.config.freshTailCount);
      tailMessages = tail.map(m => ({
        role: m.role,
        content: m.metadata?.originalContent ?? m.content,
      }));
    }

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
    const totalText = messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('') + systemPromptAddition;
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
