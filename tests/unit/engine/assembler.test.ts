import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { Assembler } from '../../../src/engine/assembler.js';
import { resolveConfig } from '../../../src/config.js';
import { createMessages, resetFixtures } from '../../helpers/fixtures.js';

describe('Assembler', () => {
  let storage: SQLiteStorage;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-assembler-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
    await storage.ensureSession('s1');

    const msgs = createMessages(50, 's1');
    for (const msg of msgs) await storage.storeMessage(msg);
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns fresh tail + system messages in tools mode', async () => {
    const config = resolveConfig({ mode: 'tools', freshTailCount: 10 });
    const assembler = new Assembler(storage, config);

    const result = await assembler.assemble('s1', [
      { role: 'system', content: 'You are a helpful assistant.' },
    ]);

    // System message + 10 tail messages
    expect(result.messages).toHaveLength(11);
    expect(result.messages[0].role).toBe('system');
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.systemPromptAddition).toContain('50 messages');
    expect(result.systemPromptAddition).toContain('rc_peek');
  });

  it('returns REPL instructions in repl mode', async () => {
    const config = resolveConfig({ mode: 'repl', freshTailCount: 5 });
    const assembler = new Assembler(storage, config);

    const result = await assembler.assemble('s1', [
      { role: 'system', content: 'You are a helpful assistant.' },
    ]);

    expect(result.messages).toHaveLength(6); // 1 system + 5 tail
    expect(result.systemPromptAddition).toContain('REPL');
    expect(result.systemPromptAddition).toContain('FINAL');
    expect(result.systemPromptAddition).toContain('grep');
  });

  it('handles empty session gracefully', async () => {
    await storage.ensureSession('empty');
    const config = resolveConfig({ mode: 'tools' });
    const assembler = new Assembler(storage, config);

    const result = await assembler.assemble('empty', []);
    expect(result.messages).toHaveLength(0);
    expect(result.estimatedTokens).toBeGreaterThan(0); // manifest text
  });
});
