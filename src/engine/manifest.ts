import type { StorageInterface } from '../storage/storage-interface.js';
import type { ContextManifest } from '../types.js';

/**
 * Build the context manifest — a lightweight metadata summary of what's stored.
 * This gets injected into the system prompt so the model knows what's available
 * without actually loading any history into the context window.
 */
export async function buildManifest(
  storage: StorageInterface,
  currentSessionId: string
): Promise<ContextManifest> {
  const sessions = await storage.getSessions();
  const currentSession = await storage.getSession(currentSessionId);

  let earliest: number | null = null;
  let latest: number | null = null;
  let totalTokens = 0;
  let messageCount = 0;

  for (const s of sessions) {
    if (earliest === null || s.createdAt < earliest) earliest = s.createdAt;
    if (latest === null || s.lastActive > latest) latest = s.lastActive;
    totalTokens += s.totalTokens;
    messageCount += s.messageCount;
  }

  return {
    messageCount,
    sessionCount: sessions.length,
    timeRange: earliest !== null && latest !== null ? { earliest, latest } : null,
    totalTokens,
    sessions,
    currentSessionId,
  };
}

/**
 * Format manifest into human-readable text for the system prompt addition.
 */
export function formatManifestForPrompt(manifest: ContextManifest): string {
  const lines: string[] = [];

  lines.push(`You have ${manifest.messageCount} messages of history available across ${manifest.sessionCount} session(s).`);

  if (manifest.timeRange) {
    const from = new Date(manifest.timeRange.earliest).toISOString();
    const to = new Date(manifest.timeRange.latest).toISOString();
    lines.push(`Time range: ${from} to ${to}`);
  }

  lines.push(`Total tokens stored: ~${manifest.totalTokens.toLocaleString()}`);
  lines.push('');
  lines.push('Use rc_peek, rc_grep, rc_slice, rc_query, and rc_timeline to access history.');
  lines.push('Do not guess about past context — query first.');

  return lines.join('\n');
}
