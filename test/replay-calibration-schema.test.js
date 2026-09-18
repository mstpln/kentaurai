import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

test('F1 migration stores replay metadata, forecast scores and declared ablation results', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationNames()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const runs = new Set(db.prepare('PRAGMA table_info(replay_runs)').all().map((row) => row.name));
  for (const required of [
    'id','contract_version','replay_version','track','status','config_json','version_metadata_json',
    'cohort_fingerprint','evaluation_fingerprint','result_json','result_fingerprint','target_count','fold_count','created_at'
  ]) assert.ok(runs.has(required), `missing replay_runs.${required}`);

  const evaluations = new Set(db.prepare('PRAGMA table_info(forecast_evaluations)').all().map((row) => row.name));
  for (const required of [
    'replay_run_id','target_id','target_group_id','target_at','forecast_variant','winner_entry_id',
    'entry_count','log_loss','brier_score','top1_hit','top2_hit','top3_hit','winner_rank','forecast_json'
  ]) assert.ok(evaluations.has(required), `missing forecast_evaluations.${required}`);

  const ablations = new Set(db.prepare('PRAGMA table_info(replay_ablation_results)').all().map((row) => row.name));
  for (const required of [
    'replay_run_id','ablation_id','feature_family','mode','baseline_variant','candidate_variant',
    'target_count','baseline_log_loss','candidate_log_loss','delta_log_loss','baseline_brier',
    'candidate_brier','delta_brier','result_json'
  ]) assert.ok(ablations.has(required), `missing replay_ablation_results.${required}`);

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_replay_runs_track_created'));
  assert.ok(indexes.has('idx_forecast_evaluations_target'));
  assert.ok(indexes.has('idx_replay_ablation_results_family'));
});
