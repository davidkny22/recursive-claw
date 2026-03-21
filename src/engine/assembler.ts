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
      // Use pipeline messages directly — proper Anthropic content block structure.
      // Must ensure every tool_result has a matching tool_use in the window.
      tailMessages = sanitizeTail(nonSystemPipeline, this.config.freshTailCount);
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

/**
 * Extract tool_use IDs and tool_result IDs from a message's content blocks.
 */
function extractToolIds(msg: { role: string; content: unknown }): { toolUseIds: Set<string>; toolResultIds: Set<string> } {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  const content = msg.content;

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_use' && typeof b.id === 'string') {
          toolUseIds.add(b.id);
        }
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          toolResultIds.add(b.tool_use_id);
        }
      }
    }
  }

  return { toolUseIds, toolResultIds };
}

/**
 * Sanitize the tail to ensure every tool_result has a matching tool_use.
 *
 * Strategy: take the last N messages, collect all tool_use IDs and
 * tool_result IDs in the window. If any tool_result references an ID
 * not in the tool_use set, trim from the start until it's gone.
 * Also ensure the first message is a user message (Anthropic requirement).
 */
function sanitizeTail(
  messages: Array<{ role: string; content: unknown }>,
  maxCount: number
): Array<{ role: string; content: unknown }> {
  let tail = messages.slice(-maxCount);

  // Iteratively trim from the front until all tool_results are paired
  for (let attempts = 0; attempts < tail.length && tail.length > 0; attempts++) {
    const allToolUseIds = new Set<string>();
    const allToolResultIds = new Set<string>();

    for (const msg of tail) {
      const { toolUseIds, toolResultIds } = extractToolIds(msg);
      toolUseIds.forEach(id => allToolUseIds.add(id));
      toolResultIds.forEach(id => allToolResultIds.add(id));
    }

    // Check if any tool_result references an ID not in the window
    let hasOrphan = false;
    for (const resultId of allToolResultIds) {
      if (!allToolUseIds.has(resultId)) {
        hasOrphan = true;
        break;
      }
    }

    if (!hasOrphan) break;

    // Trim the first message and retry
    tail = tail.slice(1);
  }

  // Anthropic requires first message to be role 'user'
  while (tail.length > 0 && tail[0].role !== 'user') {
    tail = tail.slice(1);
  }

  return tail;
}
