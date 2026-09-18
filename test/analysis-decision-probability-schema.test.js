import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

test('E1 migration persists explicit decision version, parent bindings and calibration-ready entry probabilities', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationNames()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const runs = new Map(db.prepare('PRAGMA table_info(analysis_decision_runs)').all().map((row) => [row.name, row]));
  for (const required of [
    'id','game_round_id','lock_id','lock_hash','market_fingerprint','market_cutoff','contract_version',
    'decision_probability_version','policy_version','market_proxy_quality_json','context_reliability_json',
    'decision_json','decision_fingerprint','created_at'
  ]) assert.ok(runs.has(required), `missing analysis_decision_runs.${required}`);

  const entries = new Map(db.prepare('PRAGMA table_info(analysis_decision_probabilities)').all().map((row) => [row.name, row]));
  for (const required of [
    'decision_run_id','leg_number','race_entry_id','blind_probability','public_win_probability_proxy',
    'public_proxy_quality','decision_probability'
  ]) assert.ok(entries.has(required), `missing analysis_decision_probabilities.${required}`);

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_analysis_decision_runs_round_created'));
  assert.ok(indexes.has('idx_analysis_decision_runs_lock_market'));
  assert.ok(indexes.has('idx_analysis_decision_probabilities_entry'));
});
