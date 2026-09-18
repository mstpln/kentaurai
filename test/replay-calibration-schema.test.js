import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrations() {
  return readdirSync(new URL('../migrations/', import.meta.url)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

test('F1 schema stores chronological replay, forecasts, calibration observations, systems and ablations', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrations()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const required = {
    replay_runs: ['id','track','source_data_cutoff','walk_forward_policy_json','config_fingerprint','reference_targets_json','cursor_event_at','processed_targets','summary_json','calibration_json','run_fingerprint'],
    replay_target_skips: ['replay_run_id','track','target_id','reason_code','details_json'],
    forecast_evaluations: ['replay_run_id','target_id','target_group_id','event_at','forecast_as_of','fold_index','evidence_eligible','is_reference','forecast_key','log_loss','brier_score','coverage_bucket','feature_manifest_json'],
    forecast_probability_observations: ['evaluation_id','race_entry_id','probability','won','calibration_bin'],
    replay_system_evaluations: ['replay_run_id','game_round_id','optimizer_run_id','estimated_p8','actual_all_covered','covered_legs','spike_misses'],
    replay_ablation_results: ['replay_run_id','declared_feature_family','coverage_bucket','paired_target_count','delta_log_loss','delta_brier','evidence_status']
  };
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of columns) assert.ok(actual.has(column), `missing ${table}.${column}`);
  }

  const runSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='replay_runs'").get().sql;
  assert.match(runSql, /sports_feature/);
  assert.match(runSql, /v85_v86_decision/);
  const evalSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='forecast_evaluations'").get().sql;
  assert.match(evalSql, /evidence_eligible/);
  assert.match(evalSql, /is_reference/);
  const ablationSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='replay_ablation_results'").get().sql;
  assert.match(ablationSql, /candidate_better/);
  assert.match(ablationSql, /candidate_worse/);
});

test('F1 additive migration does not mutate existing analyses, systems or model-change history', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrations().filter((name) => name !== '0024_replay_calibration_v1.sql')) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec("INSERT INTO tracks (id,canonical_name) VALUES ('t','Track')");
  db.exec("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('g','V85','2099-01-01')");
  db.exec("INSERT INTO systems (id,game_round_id,system_type,budget_sek,row_count,spike_count,created_at) VALUES ('s','g','main',200,400,2,'2099-01-01T00:00:00Z')");
  db.exec("INSERT INTO learning_hypotheses (id,title,category,hypothesis_text,status,created_at,updated_at) VALUES ('h','T','c','H','candidate','2099-01-01','2099-01-01')");
  db.exec("INSERT INTO model_change_log (id,hypothesis_id,change_type,change_summary,evidence_summary,changed_at) VALUES ('m','h','manual','old','old','2099-01-01')");
  db.exec(readFileSync(new URL('../migrations/0024_replay_calibration_v1.sql', import.meta.url), 'utf8'));

  assert.equal(db.prepare("SELECT spike_count FROM systems WHERE id='s'").get().spike_count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM model_change_log").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replay_runs").get().n, 0);
});
