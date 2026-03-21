import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { buildManifest, formatManifestForPrompt } from '../../../src/engine/manifest.js';
import { createMessages, resetFixtures } from '../../helpers/fixtures.js';

describe('buildManifest', () => {
  let storage: SQLiteStorage;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-manifest-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds manifest with correct counts', async () => {
    await storage.ensureSession('s1');
    const msgs = createMessages(25, 's1');
    for (const msg of msgs) await storage.storeMessage(msg);

    const manifest = await buildManifest(storage, 's1');
    expect(manifest.messageCount).toBe(25);
    expect(manifest.sessionCount).toBe(1);
    expect(manifest.totalTokens).toBeGreaterThan(0);
    expect(manifest.currentSessionId).toBe('s1');
    expect(manifest.timeRange).not.toBeNull();
  });

  it('aggregates across multiple sessions', async () => {
    await storage.ensureSession('s1');
    await storage.ensureSession('s2');
    const msgs1 = createMessages(10, 's1');
    const msgs2 = createMessages(15, 's2');
    for (const msg of [...msgs1, ...msgs2]) await storage.storeMessage(msg);

    const manifest = await buildManifest(storage, 's1');
    expect(manifest.messageCount).toBe(25);
    expect(manifest.sessionCount).toBe(2);
    expect(manifest.sessions).toHaveLength(2);
  });

  it('returns null timeRange for empty storage', async () => {
    const manifest = await buildManifest(storage, 's1');
    expect(manifest.timeRange).toBeNull();
    expect(manifest.messageCount).toBe(0);
  });
});

describe('formatManifestForPrompt', () => {
  it('formats manifest into human-readable text', () => {
    const text = formatManifestForPrompt({
      messageCount: 100,
      sessionCount: 3,
      timeRange: { earliest: Date.now() - 86400000, latest: Date.now() },
      totalTokens: 50000,
      sessions: [],
      currentSessionId: 's1',
    });

    expect(text).toContain('100 messages');
    expect(text).toContain('3 session(s)');
    expect(text).toContain('50,000');
    expect(text).toContain('rc_peek');
    expect(text).toContain('rc_grep');
  });
});
