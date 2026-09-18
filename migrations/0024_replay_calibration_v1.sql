PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS replay_runs (
  id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-replay-v1'),
  replay_version TEXT NOT NULL,
  track TEXT NOT NULL CHECK(track IN ('sports_feature','v85_v86_decision')),
  status TEXT NOT NULL CHECK(status IN ('completed','insufficient_evidence')),
  config_json TEXT NOT NULL,
  version_metadata_json TEXT NOT NULL,
  cohort_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_fingerprint TEXT NOT NULL UNIQUE,
  target_count INTEGER NOT NULL CHECK(target_count >= 0),
  fold_count INTEGER NOT NULL CHECK(fold_count >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecast_evaluations (
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_group_id TEXT NOT NULL,
  target_at TEXT NOT NULL,
  forecast_variant TEXT NOT NULL,
  winner_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  entry_count INTEGER NOT NULL CHECK(entry_count >= 2),
  log_loss REAL NOT NULL CHECK(log_loss >= 0),
  brier_score REAL NOT NULL CHECK(brier_score >= 0),
  top1_hit INTEGER NOT NULL CHECK(top1_hit IN (0,1)),
  winner_rank INTEGER NOT NULL CHECK(winner_rank >= 1),
  forecast_json TEXT NOT NULL,
  PRIMARY KEY(replay_run_id, target_id, forecast_variant)
);

CREATE TABLE IF NOT EXISTS replay_ablation_results (
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
  ablation_id TEXT NOT NULL,
  feature_family TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('add','remove')),
  baseline_variant TEXT NOT NULL,
  candidate_variant TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK(target_count >= 0),
  baseline_log_loss REAL,
  candidate_log_loss REAL,
  delta_log_loss REAL,
  baseline_brier REAL,
  candidate_brier REAL,
  delta_brier REAL,
  result_json TEXT NOT NULL,
  PRIMARY KEY(replay_run_id, ablation_id)
);

CREATE INDEX IF NOT EXISTS idx_replay_runs_track_created
  ON replay_runs(track, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_evaluations_target
  ON forecast_evaluations(target_group_id, target_at, replay_run_id);
CREATE INDEX IF NOT EXISTS idx_replay_ablation_results_family
  ON replay_ablation_results(feature_family, replay_run_id);
