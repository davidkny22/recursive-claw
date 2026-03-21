/**
 * Parse model output for ```repl``` code blocks and FINAL/FINAL_VAR signals.
 *
 * Note: RegExp methods used here are standard JavaScript pattern matching,
 * not child_process or shell invocation.
 */

export interface ParsedBlock {
  code: string;
  startIndex: number;
  endIndex: number;
}

export interface ParseResult {
  codeBlocks: ParsedBlock[];
  finalAnswer: string | null;
  finalVarName: string | null;
}

const CODE_BLOCK_PATTERN = /```repl\n([\s\S]*?)```/g;
const FINAL_PATTERN = /^\s*FINAL\(([\s\S]*)\)\s*$/m;
const FINAL_VAR_PATTERN = /^\s*FINAL_VAR\((.*?)\)/m;

/**
 * Extract ```repl``` code blocks from model output.
 */
export function extractCodeBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const matches = text.matchAll(CODE_BLOCK_PATTERN);

  for (const match of matches) {
    blocks.push({
      code: match[1].trim(),
      startIndex: match.index!,
      endIndex: match.index! + match[0].length,
    });
  }

  return blocks;
}

/**
 * Detect FINAL() or FINAL_VAR() signals in text or code output.
 * Checks FINAL_VAR first (takes precedence).
 */
export function detectFinalSignal(text: string): { type: 'final'; value: string } | { type: 'final_var'; name: string } | null {
  // Check FINAL_VAR first
  const varMatch = text.match(FINAL_VAR_PATTERN);
  if (varMatch) {
    const name = varMatch[1].trim().replace(/^['"]|['"]$/g, '');
    return { type: 'final_var', name };
  }

  // Check FINAL
  const finalMatch = text.match(FINAL_PATTERN);
  if (finalMatch) {
    return { type: 'final', value: finalMatch[1].trim() };
  }

  return null;
}

/**
 * Full parse of model output: extract code blocks and detect signals.
 */
export function parseModelOutput(text: string): ParseResult {
  const codeBlocks = extractCodeBlocks(text);
  const signal = detectFinalSignal(text);

  return {
    codeBlocks,
    finalAnswer: signal?.type === 'final' ? signal.value : null,
    finalVarName: signal?.type === 'final_var' ? signal.name : null,
  };
}
