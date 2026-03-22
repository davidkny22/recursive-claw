import type { Database } from 'node-sqlite3-wasm';
import { migration001 } from './migrations/001-initial.js';

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [migration001];

export class MigrationRunner {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Run all pending migrations. Safe to call on every bootstrap —
   * skips already-applied migrations.
   */
  run(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    )`);

    const currentVersion = this.getCurrentVersion();

    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;

      this.db.run('BEGIN');
      try {
        for (const sql of migration.up) {
          this.db.run(sql);
        }
        this.db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
          [migration.version, Date.now()]);
        this.db.run('COMMIT');
      } catch (err) {
        this.db.run('ROLLBACK');
        throw err;
      }
    }
  }

  getCurrentVersion(): number {
    try {
      const row = this.db.get('SELECT MAX(version) as version FROM schema_version') as
        { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }
}
