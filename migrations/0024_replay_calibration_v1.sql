PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS replay_runs (
  id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-replay-v1'),
  replay_version TEXT NOT NULL,
  track TEXT NOT NULL CHECK(track IN ('sports_feature','v85_v86_decision')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source_data_cutoff TEXT NOT NULL,
  walk_forward_policy_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  reference_targets_json TEXT NOT NULL DEFAULT '[]',
  cursor_event_at TEXT,
  cursor_target_id TEXT,
  processed_targets INTEGER NOT NULL DEFAULT 0 CHECK(processed_targets >= 0),
  scored_forecasts INTEGER NOT NULL DEFAULT 0 CHECK(scored_forecasts >= 0),
  skipped_targets INTEGER NOT NULL DEFAULT 0 CHECK(skipped_targets >= 0),
  summary_json TEXT,
  calibration_json TEXT,
  run_fingerprint TEXT UNIQUE,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_replay_runs_track_status
  ON replay_runs(track, status, created_at DESC, id DESC);


CREATE TABLE IF NOT EXISTS replay_target_skips (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK(track IN ('sports_feature','v85_v86_decision')),
  target_id TEXT NOT NULL,
  event_at TEXT,
  reason_code TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(replay_run_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_replay_target_skips_run
  ON replay_target_skips(replay_run_id, reason_code, target_id);

CREATE TABLE IF NOT EXISTS forecast_evaluations (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK(track IN ('sports_feature','v85_v86_decision')),
  target_id TEXT NOT NULL,
  target_group_id TEXT,
  event_at TEXT NOT NULL,
  forecast_as_of TEXT NOT NULL,
  fold_index INTEGER NOT NULL CHECK(fold_index >= 0),
  evidence_eligible INTEGER NOT NULL CHECK(evidence_eligible IN (0,1)),
  is_reference INTEGER NOT NULL CHECK(is_reference IN (0,1)),
  forecast_key TEXT NOT NULL,
  forecast_version TEXT NOT NULL,
  model_version_id TEXT REFERENCES model_versions(id),
  winner_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  winner_probability REAL NOT NULL CHECK(winner_probability >= 0 AND winner_probability <= 1),
  log_loss REAL NOT NULL CHECK(log_loss >= 0),
  brier_score REAL NOT NULL CHECK(brier_score >= 0),
  top1_hit INTEGER NOT NULL CHECK(top1_hit IN (0,1)),
  top2_coverage INTEGER NOT NULL CHECK(top2_coverage IN (0,1)),
  entry_count INTEGER NOT NULL CHECK(entry_count >= 2),
  feature_fingerprint TEXT,
  feature_manifest_json TEXT,
  coverage_bucket TEXT CHECK(coverage_bucket IS NULL OR coverage_bucket IN ('zero','low','mixed','high')),
  probability_json TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(replay_run_id, target_id, forecast_key)
);

CREATE INDEX IF NOT EXISTS idx_forecast_evaluations_run_event
  ON forecast_evaluations(replay_run_id, event_at, target_id, forecast_key);
CREATE INDEX IF NOT EXISTS idx_forecast_evaluations_forecast
  ON forecast_evaluations(replay_run_id, forecast_key, evidence_eligible, is_reference);

CREATE TABLE IF NOT EXISTS forecast_probability_observations (
  evaluation_id TEXT NOT NULL REFERENCES forecast_evaluations(id) ON DELETE CASCADE,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  probability REAL NOT NULL CHECK(probability >= 0 AND probability <= 1),
  won INTEGER NOT NULL CHECK(won IN (0,1)),
  calibration_bin INTEGER NOT NULL CHECK(calibration_bin BETWEEN 0 AND 9),
  PRIMARY KEY(evaluation_id, race_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_probability_observations_eval
  ON forecast_probability_observations(evaluation_id, calibration_bin);

CREATE TABLE IF NOT EXISTS replay_system_evaluations (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  optimizer_run_id TEXT NOT NULL REFERENCES analysis_optimizer_runs(id),
  event_at TEXT NOT NULL,
  is_reference INTEGER NOT NULL CHECK(is_reference IN (0,1)),
  estimated_p8 REAL NOT NULL CHECK(estimated_p8 >= 0 AND estimated_p8 <= 1),
  actual_all_covered INTEGER NOT NULL CHECK(actual_all_covered IN (0,1)),
  covered_legs INTEGER NOT NULL CHECK(covered_legs BETWEEN 0 AND 8),
  spike_misses INTEGER NOT NULL CHECK(spike_misses BETWEEN 0 AND 3),
  row_count INTEGER NOT NULL CHECK(row_count > 0),
  cost_sek REAL NOT NULL CHECK(cost_sek > 0),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(replay_run_id, optimizer_run_id)
);

CREATE TABLE IF NOT EXISTS replay_ablation_results (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  declared_feature_family TEXT NOT NULL,
  baseline_forecast_key TEXT NOT NULL,
  candidate_forecast_key TEXT NOT NULL,
  coverage_bucket TEXT NOT NULL CHECK(coverage_bucket IN ('all','zero','low','mixed','high')),
  paired_target_count INTEGER NOT NULL CHECK(paired_target_count >= 0),
  baseline_log_loss REAL,
  candidate_log_loss REAL,
  delta_log_loss REAL,
  baseline_brier REAL,
  candidate_brier REAL,
  delta_brier REAL,
  evidence_status TEXT NOT NULL CHECK(evidence_status IN ('insufficient','candidate_better','candidate_worse','mixed_no_clear_gain')),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(replay_run_id, coverage_bucket)
);

CREATE INDEX IF NOT EXISTS idx_replay_ablation_run
  ON replay_ablation_results(replay_run_id, coverage_bucket);
