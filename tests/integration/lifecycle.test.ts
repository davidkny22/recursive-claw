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

  it('bootstraps and exposes retrieval engine', () => {
    expect(engine.getRetrieval()).toBeDefined();
    expect(engine.getCostTracker()).toBeDefined();
    expect(engine.getStorage()).toBeDefined();
  });

  it('full flow: ingest → assemble → retrieval', async () => {
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

    // 3. Use retrieval engine to grep
    const retrieval = engine.getRetrieval();
    const grepResults = await retrieval.grep('PostgreSQL');
    expect(grepResults.length).toBeGreaterThanOrEqual(1);
    expect(grepResults[0].snippet).toContain('PostgreSQL');

    // 4. Peek recent messages
    const peekResults = await retrieval.peek(0, 3);
    expect(peekResults).toHaveLength(3);

    // 5. Slice a range
    const sliceResults = await retrieval.slice(10, 12);
    expect(sliceResults).toHaveLength(2);
    expect(sliceResults[0].content).toContain('PostgreSQL');

    // 6. Timeline
    const timeline = await retrieval.timeline();
    expect(timeline.length).toBeGreaterThanOrEqual(1);

    // 7. Compact does not destroy data
    const compactResult = await engine.compact({ sessionId: 'session-1', force: true });
    expect(compactResult.ok).toBe(true);

    // 8. Data still fully searchable after compact
    const postCompactGrep = await retrieval.grep('JWT');
    expect(postCompactGrep.length).toBeGreaterThanOrEqual(1);
  });
});
