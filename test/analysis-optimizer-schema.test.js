import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

test('E2 migration persists versioned optimizer metrics, exact3 policy and normalized selections', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationNames()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const runs = new Map(db.prepare('PRAGMA table_info(analysis_optimizer_runs)').all().map((row) => [row.name, row]));
  for (const required of [
    'id','game_round_id','decision_run_id','decision_fingerprint','contract_version','optimizer_version',
    'policy_version','line_price_sek','target_budget_min_sek','max_budget_sek','spike_count','row_count',
    'cost_sek','estimated_p8','policy_json','metrics_json','optimizer_json','optimizer_fingerprint','created_at'
  ]) assert.ok(runs.has(required), `missing analysis_optimizer_runs.${required}`);

  const selections = new Map(db.prepare('PRAGMA table_info(analysis_optimizer_selections)').all().map((row) => [row.name, row]));
  for (const required of ['optimizer_run_id','leg_number','race_entry_id','is_spike','decision_probability']) {
    assert.ok(selections.has(required), `missing analysis_optimizer_selections.${required}`);
  }

  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='analysis_optimizer_runs'").get().sql;
  assert.match(sql, /CHECK\(spike_count = 3\)/);

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_analysis_optimizer_runs_round_created'));
  assert.ok(indexes.has('idx_analysis_optimizer_runs_decision'));
  assert.ok(indexes.has('idx_analysis_optimizer_selections_entry'));
});

test('E2 additive migration preserves legacy two-spike systems without rewriting history', () => {
  const db = new DatabaseSync(':memory:');
  const migrations = migrationNames();
  for (const name of migrations.filter((name) => name !== '0022_analysis_optimizer_v1.sql')) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }

  db.exec("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('legacy-round','V85','2099-01-01')");
  db.exec(`
    INSERT INTO systems (
      id,game_round_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json,notes
    ) VALUES (
      'legacy-two-spike','legacy-round','main',200,400,0.5,2,'2099-01-01T00:00:00.000Z','{}','legacy historical exception'
    )
  `);
  db.exec(readFileSync(new URL('../migrations/0022_analysis_optimizer_v1.sql', import.meta.url), 'utf8'));

  const legacy = db.prepare("SELECT id,spike_count,notes FROM systems WHERE id='legacy-two-spike'").get();
  assert.equal(legacy.spike_count, 2);
  assert.equal(legacy.notes, 'legacy historical exception');
});
