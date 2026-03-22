import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'node-sqlite3-wasm';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MigrationRunner } from '../../../src/storage/migration-runner.js';

describe('MigrationRunner', () => {
  let db: Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rc-migration-test-'));
    db = new Database(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs initial migration on fresh database', () => {
    const runner = new MigrationRunner(db);
    runner.run();

    expect(runner.getCurrentVersion()).toBe(1);

    const tables = db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ) as Array<{ name: string }>;
    const names = tables.map(t => t.name);

    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('schema_version');
  });

  it('is idempotent — running twice does not error', () => {
    const runner = new MigrationRunner(db);
    runner.run();
    runner.run();
    expect(runner.getCurrentVersion()).toBe(1);
  });

  it('skips already-applied migrations', () => {
    const runner = new MigrationRunner(db);
    runner.run();

    db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [99, Date.now()]);

    const runner2 = new MigrationRunner(db);
    expect(runner2.getCurrentVersion()).toBe(99);
  });
});
