import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RecursiveClawEngine } from '../../src/engine/context-engine.js';

describe('Cross-session retrieval', () => {
  let engine: RecursiveClawEngine;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rc-cross-session-'));
    engine = new RecursiveClawEngine(null, {
      mode: 'tools',
      databasePath: join(tempDir, 'context.db'),
    });
    await engine.bootstrap();

    // Seed session 1: authentication discussion
    for (let i = 0; i < 10; i++) {
      await engine.ingest({
        sessionId: 'session-auth',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: i === 0 ? 'Set up JWT authentication with refresh tokens'
            : i === 1 ? 'Implementing JWT auth with 15-minute access tokens and 7-day refresh tokens'
            : `Auth discussion message ${i}`,
        },
      });
    }

    // Seed session 2: database discussion
    for (let i = 0; i < 10; i++) {
      await engine.ingest({
        sessionId: 'session-db',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: i === 0 ? 'Migrate from SQLite to PostgreSQL for production'
            : i === 1 ? 'Setting up PostgreSQL with connection pooling via pgBouncer'
            : `Database discussion message ${i}`,
        },
      });
    }

    // Seed session 3: deployment discussion
    for (let i = 0; i < 10; i++) {
      await engine.ingest({
        sessionId: 'session-deploy',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: i === 0 ? 'Deploy everything to Railway with PostgreSQL addon'
            : i === 1 ? 'Railway deployment configured with auto-scaling and PostgreSQL addon'
            : `Deployment message ${i}`,
        },
      });
    }
  });

  afterEach(async () => {
    await engine.getStorage().close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds results across all sessions with scope:all', async () => {
    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('session-auth');

    const results = await retrieval.grep('PostgreSQL', { scope: 'all' });
    expect(results.length).toBeGreaterThanOrEqual(2);

    const sessionIds = new Set(results.map(r => r.message.sessionId));
    expect(sessionIds.size).toBeGreaterThanOrEqual(2);
  });

  it('scopes search to current session by default', async () => {
    const retrieval = engine.getRetrieval();
    retrieval.setCurrentSession('session-auth');

    const results = await retrieval.grep('JWT');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.message.sessionId === 'session-auth')).toBe(true);
  });

  it('assembles manifest with all sessions', async () => {
    const result = await engine.assemble({
      sessionId: 'session-auth',
      messages: [{ role: 'system', content: 'You are helpful.' }],
      tokenBudget: 100000,
    });

    expect(result.systemPromptAddition).toContain('30 messages');
    expect(result.systemPromptAddition).toContain('3 session(s)');
  });
});
