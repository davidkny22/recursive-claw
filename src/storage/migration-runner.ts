import type Database from 'better-sqlite3';
import { migration001 } from './migrations/001-initial.js';

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [migration001];

export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Run all pending migrations. Safe to call on every bootstrap —
   * skips already-applied migrations.
   *
   * Note: db.exec() below is better-sqlite3's SQL execution method,
   * not child_process — it runs SQL statements against the database.
   */
  run(): void {
    // Ensure schema_version table exists (bootstrap for first run)
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    )`);

    const currentVersion = this.getCurrentVersion();

    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;

      const transaction = this.db.transaction(() => {
        for (const sql of migration.up) {
          this.db.exec(sql);
        }
        this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          Date.now()
        );
      });

      transaction();
    }
  }

  getCurrentVersion(): number {
    try {
      const row = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
        | { version: number | null }
        | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }
}
