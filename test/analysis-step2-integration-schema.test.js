import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

test('E3 schema stores Step 2 interpretation and integrated version/fingerprint references', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationNames()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const step2 = new Set(db.prepare('PRAGMA table_info(analysis_step2_results)').all().map((row) => row.name));
  for (const required of [
    'id','game_round_id','lock_id','lock_hash','market_fingerprint','market_cutoff','contract_version',
    'step2_version','prompt_version','provider','model','result_json','result_fingerprint','created_at'
  ]) assert.ok(step2.has(required), `missing analysis_step2_results.${required}`);

  const runs = new Set(db.prepare('PRAGMA table_info(analysis_v3_runs)').all().map((row) => row.name));
  for (const required of [
    'id','game_round_id','lock_id','lock_hash','market_fingerprint','market_cutoff','step2_result_id',
    'decision_run_id','optimizer_run_id','contract_version','analysis_version','step2_version',
    'decision_probability_version','optimizer_version','step2_fingerprint','decision_fingerprint',
    'optimizer_fingerprint','analysis_json','analysis_fingerprint','narrative_json','narrative_fingerprint','created_at'
  ]) assert.ok(runs.has(required), `missing analysis_v3_runs.${required}`);

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_analysis_step2_results_round_created'));
  assert.ok(indexes.has('idx_analysis_step2_results_lock_market'));
  assert.ok(indexes.has('idx_analysis_v3_runs_round_created'));
  assert.ok(indexes.has('idx_analysis_v3_runs_lock_market'));
});
