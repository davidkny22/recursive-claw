import type { StoredMessage } from '../types.js';

/**
 * Build the messages array for a retrieval sub-query.
 * The cheap model receives a system prompt + the question + formatted history.
 */
export function buildSubQueryMessages(
  question: string,
  messages: StoredMessage[]
): Array<{ role: string; content: string }> {
  const formattedHistory = messages
    .map(m => {
      const ts = new Date(m.timestamp).toISOString();
      return `[${ts}] [${m.role}] ${m.content}`;
    })
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `You are a retrieval assistant. Answer the following question using ONLY the provided conversation history. Be concise and specific. If the history doesn't contain enough information, say so.`,
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nHistory:\n${formattedHistory}`,
    },
  ];
}
