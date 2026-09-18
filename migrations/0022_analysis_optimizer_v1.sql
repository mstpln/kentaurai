PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_optimizer_runs (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  decision_run_id TEXT NOT NULL REFERENCES analysis_decision_runs(id),
  decision_fingerprint TEXT NOT NULL,
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-optimizer-v1'),
  optimizer_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  line_price_sek REAL NOT NULL CHECK(line_price_sek > 0),
  target_budget_min_sek REAL NOT NULL CHECK(target_budget_min_sek > 0),
  max_budget_sek REAL NOT NULL CHECK(max_budget_sek > 0),
  spike_count INTEGER NOT NULL CHECK(spike_count = 3),
  row_count INTEGER NOT NULL CHECK(row_count > 0),
  cost_sek REAL NOT NULL CHECK(cost_sek > 0),
  estimated_p8 REAL NOT NULL CHECK(estimated_p8 >= 0 AND estimated_p8 <= 1),
  policy_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  optimizer_json TEXT NOT NULL,
  optimizer_fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_optimizer_selections (
  optimizer_run_id TEXT NOT NULL REFERENCES analysis_optimizer_runs(id) ON DELETE CASCADE,
  leg_number INTEGER NOT NULL CHECK(leg_number BETWEEN 1 AND 8),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  is_spike INTEGER NOT NULL CHECK(is_spike IN (0,1)),
  decision_probability REAL NOT NULL CHECK(decision_probability >= 0 AND decision_probability <= 1),
  PRIMARY KEY(optimizer_run_id, leg_number, race_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_optimizer_runs_round_created
  ON analysis_optimizer_runs(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_optimizer_runs_decision
  ON analysis_optimizer_runs(decision_run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_optimizer_selections_entry
  ON analysis_optimizer_selections(race_entry_id, optimizer_run_id);
