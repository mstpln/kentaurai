import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function apply(db, names) {
  for (const name of names) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}

test('D2 migration creates immutable Step 1 lock persistence on a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, migrationNames());
  const columns = new Map(db.prepare('PRAGMA table_info(analysis_step1_locks)').all().map((row) => [row.name, row]));
  for (const required of ['id','game_round_id','contract_version','pack_id','pack_as_of','facts_fingerprint','provider','model','prompt_version','lock_json','lock_hash','created_at']) {
    assert.ok(columns.has(required), `missing analysis_step1_locks.${required}`);
  }
  for (const required of ['game_round_id','contract_version','pack_id','pack_as_of','facts_fingerprint','provider','model','prompt_version','lock_json','lock_hash','created_at']) {
    assert.equal(columns.get(required).notnull, 1, `analysis_step1_locks.${required} must be required`);
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_analysis_step1_locks_round_created'));
  assert.ok(indexes.has('idx_analysis_step1_locks_pack'));
});

test('D2 migration upgrades a legacy database without rewriting readable two-spike systems', () => {
  const names = migrationNames();
  const d2Migration = '0019_analysis_step1_locks.sql';
  const d2Index = names.indexOf(d2Migration);
  assert.notEqual(d2Index, -1, `${d2Migration} must remain available`);
  const db = new DatabaseSync(':memory:');
  apply(db, names.slice(0, d2Index));
  db.prepare("INSERT INTO game_rounds (id, game_type, round_date) VALUES ('legacy-round', 'V85', '2026-09-06')").run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at, notes)
    VALUES ('legacy-system', 'legacy-round', 'main', 200, 400, 2, '2026-09-06T00:00:00Z', 'synthetic legacy reason')`).run();

  apply(db, [d2Migration]);
  const legacy = db.prepare("SELECT spike_count FROM systems WHERE id='legacy-system'").get();
  assert.equal(legacy.spike_count, 2);

  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'lock-1','legacy-round','kentaurai-step1-lock-v1','pack-1','2026-09-06T08:00:00.000Z','sha256:facts',
    'openai','synthetic-model','step1-prompt-v3-d2','{}','sha256:lock','2026-09-06T08:10:00.000Z'
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analysis_step1_locks").get().n, 1);
  assert.throws(() => db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES ('bad','legacy-round','wrong-contract','p','2026-09-06T08:00:00Z','f','openai','m','p','{}','h','2026-09-06T08:00:00Z')`).run(), /CHECK constraint failed/);
});