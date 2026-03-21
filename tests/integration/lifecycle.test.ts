import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RecursiveClawEngine } from '../../src/engine/context-engine.js';
import type { ToolDefinition } from '../../src/types.js';

describe('Full lifecycle integration', () => {
  let engine: RecursiveClawEngine;
  let tempDir: string;
  let registeredTools: Map<string, ToolDefinition>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rc-lifecycle-test-'));
    registeredTools = new Map();

    // Mock OpenClaw API
    const mockApi = {
      registerContextEngine: () => {},
      registerTool: (name: string, def: ToolDefinition) => {
        registeredTools.set(name, def);
      },
    };

    engine = new RecursiveClawEngine(mockApi, {
      mode: 'tools',
      databasePath: join(tempDir, 'context.db'),
      freshTailCount: 10,
    });

    await engine.bootstrap();
  });

  afterEach(async () => {
    await engine.getStorage().close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers all 5 tools on bootstrap', () => {
    expect(registeredTools.size).toBe(5);
    expect(registeredTools.has('rc_peek')).toBe(true);
    expect(registeredTools.has('rc_grep')).toBe(true);
    expect(registeredTools.has('rc_slice')).toBe(true);
    expect(registeredTools.has('rc_query')).toBe(true);
    expect(registeredTools.has('rc_timeline')).toBe(true);
  });

  it('full flow: ingest → assemble → tool retrieval', async () => {
    // 1. Ingest 50 messages
    for (let i = 0; i < 50; i++) {
      const role = i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool';
      await engine.ingest({
        sessionId: 'session-1',
        message: {
          role,
          content: i === 10
            ? 'We decided to use PostgreSQL for the database'
            : i === 25
            ? 'Authentication will use JWT with refresh tokens'
            : `Message ${i} about topic ${Math.floor(i / 10)}`,
        },
      });
    }

    // 2. Assemble
    const assembled = await engine.assemble({
      sessionId: 'session-1',
      messages: [{ role: 'system', content: 'You are a coding assistant.' }],
      tokenBudget: 100000,
    });

    // Should have system + 10 tail messages
    expect(assembled.messages).toHaveLength(11);
    expect(assembled.systemPromptAddition).toContain('50 messages');

    // 3. Use rc_grep tool to find specific content
    const grepTool = registeredTools.get('rc_grep')!;
    const grepResults = await grepTool.handler({ pattern: 'PostgreSQL' }) as Array<Record<string, unknown>>;
    expect(grepResults.length).toBeGreaterThanOrEqual(1);
    expect((grepResults[0].snippet as string)).toContain('PostgreSQL');

    // 4. Use rc_peek to see recent messages
    const peekTool = registeredTools.get('rc_peek')!;
    const peekResults = await peekTool.handler({ offset: 0, length: 3 }) as Array<Record<string, unknown>>;
    expect(peekResults).toHaveLength(3);

    // 5. Use rc_slice to get a range
    const sliceTool = registeredTools.get('rc_slice')!;
    const sliceResults = await sliceTool.handler({ start: 10, end: 12 }) as Array<Record<string, unknown>>;
    expect(sliceResults).toHaveLength(2);
    expect((sliceResults[0].content as string)).toContain('PostgreSQL');

    // 6. Use rc_timeline
    const timelineTool = registeredTools.get('rc_timeline')!;
    const timeline = await timelineTool.handler({}) as Array<Record<string, unknown>>;
    expect(timeline.length).toBeGreaterThanOrEqual(1);

    // 7. Compact does not destroy data
    const compactResult = await engine.compact({ sessionId: 'session-1', force: true });
    expect(compactResult.ok).toBe(true);

    // 8. Data still fully searchable after compact
    const postCompactGrep = await grepTool.handler({ pattern: 'JWT' }) as Array<Record<string, unknown>>;
    expect(postCompactGrep.length).toBeGreaterThanOrEqual(1);
  });
});
