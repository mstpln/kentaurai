PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_step2_results (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  lock_hash TEXT NOT NULL,
  market_fingerprint TEXT NOT NULL,
  market_cutoff TEXT NOT NULL,
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-step2-result-v1'),
  step2_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic')),
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_v3_runs (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  lock_hash TEXT NOT NULL,
  market_fingerprint TEXT NOT NULL,
  market_cutoff TEXT NOT NULL,
  step2_result_id TEXT NOT NULL REFERENCES analysis_step2_results(id),
  decision_run_id TEXT NOT NULL REFERENCES analysis_decision_runs(id),
  optimizer_run_id TEXT NOT NULL REFERENCES analysis_optimizer_runs(id),
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-analysis-v3'),
  analysis_version TEXT NOT NULL,
  step2_version TEXT NOT NULL,
  decision_probability_version TEXT NOT NULL,
  optimizer_version TEXT NOT NULL,
  step2_fingerprint TEXT NOT NULL,
  decision_fingerprint TEXT NOT NULL,
  optimizer_fingerprint TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  analysis_fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(step2_result_id, decision_run_id, optimizer_run_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_step2_results_round_created
  ON analysis_step2_results(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_step2_results_lock_market
  ON analysis_step2_results(lock_id, market_fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_v3_runs_round_created
  ON analysis_v3_runs(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_v3_runs_lock_market
  ON analysis_v3_runs(lock_id, market_fingerprint, created_at DESC);
