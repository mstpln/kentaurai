PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_decision_runs (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  lock_hash TEXT NOT NULL,
  market_fingerprint TEXT NOT NULL,
  market_cutoff TEXT NOT NULL,
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-decision-probability-v1'),
  decision_probability_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  market_proxy_quality_json TEXT NOT NULL,
  context_reliability_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  decision_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(lock_id, market_fingerprint, decision_probability_version)
);

CREATE TABLE IF NOT EXISTS analysis_decision_probabilities (
  decision_run_id TEXT NOT NULL REFERENCES analysis_decision_runs(id) ON DELETE CASCADE,
  leg_number INTEGER NOT NULL CHECK(leg_number BETWEEN 1 AND 8),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  blind_probability REAL NOT NULL CHECK(blind_probability >= 0 AND blind_probability <= 1),
  public_win_probability_proxy REAL CHECK(public_win_probability_proxy IS NULL OR (public_win_probability_proxy >= 0 AND public_win_probability_proxy <= 1)),
  public_proxy_quality TEXT NOT NULL,
  decision_probability REAL NOT NULL CHECK(decision_probability >= 0 AND decision_probability <= 1),
  PRIMARY KEY(decision_run_id, leg_number, race_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_decision_runs_round_created
  ON analysis_decision_runs(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_decision_runs_lock_market
  ON analysis_decision_runs(lock_id, market_fingerprint);
CREATE INDEX IF NOT EXISTS idx_analysis_decision_probabilities_entry
  ON analysis_decision_probabilities(race_entry_id, decision_run_id);
