import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

class StatementAdapter {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) { this.args = args; return this; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) } };
  }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
}

class D1Adapter {
  constructor(db) { this.db = db; }
  prepare(sql) { return new StatementAdapter(this.db, sql); }
}

export function createTestEnv() {
  const db = new DatabaseSync(':memory:');
  for (const migration of [
    '../../migrations/0001_core.sql',
    '../../migrations/0002_reference_round.sql',
    '../../migrations/0003_nullable_reference_prediction.sql',
    '../../migrations/0004_official_live_observations.sql'
  ]) {
    db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  }

  const objects = new Map();
  return {
    db,
    env: {
      DB: new D1Adapter(db),
      RAW_BUCKET: {
        async put(key, body, options) {
          objects.set(key, { body, options });
        },
        async get(key) {
          const stored = objects.get(key);
          if (!stored) return null;
          return {
            async text() { return stored.body; }
          };
        }
      }
    },
    objects
  };
}
