PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS post_race_reviews_v2 (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  race_id TEXT NOT NULL REFERENCES races(id),
  leg_number INTEGER NOT NULL CHECK(leg_number BETWEEN 1 AND 8),
  winner_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  analysis_v3_id TEXT NOT NULL REFERENCES analysis_v3_runs(id),
  lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  decision_run_id TEXT NOT NULL REFERENCES analysis_decision_runs(id),
  optimizer_run_id TEXT NOT NULL REFERENCES analysis_optimizer_runs(id),
  review_version TEXT NOT NULL,
  pre_race_fingerprint TEXT NOT NULL,
  winner_blind_probability REAL CHECK(winner_blind_probability IS NULL OR (winner_blind_probability >= 0 AND winner_blind_probability <= 1)),
  winner_decision_probability REAL CHECK(winner_decision_probability IS NULL OR (winner_decision_probability >= 0 AND winner_decision_probability <= 1)),
  winner_rank INTEGER,
  winner_assessment_confidence REAL CHECK(winner_assessment_confidence IS NULL OR (winner_assessment_confidence >= 0 AND winner_assessment_confidence <= 1)),
  scenario_match TEXT NOT NULL CHECK(scenario_match IN ('matched','missed','unavailable')),
  scenario_confidence REAL CHECK(scenario_confidence IS NULL OR (scenario_confidence >= 0 AND scenario_confidence <= 1)),
  data_quality_summary TEXT,
  coverage_json TEXT NOT NULL,
  winner_market_percent REAL CHECK(winner_market_percent IS NULL OR (winner_market_percent >= 0 AND winner_market_percent <= 1)),
  winner_market_rank INTEGER,
  public_win_probability_proxy REAL CHECK(public_win_probability_proxy IS NULL OR (public_win_probability_proxy >= 0 AND public_win_probability_proxy <= 1)),
  public_proxy_quality TEXT,
  optimizer_selected INTEGER NOT NULL CHECK(optimizer_selected IN (0,1)),
  optimizer_is_spike INTEGER NOT NULL CHECK(optimizer_is_spike IN (0,1)),
  optimizer_selected_count INTEGER NOT NULL CHECK(optimizer_selected_count >= 1),
  failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN (
    'ranking','probability','scenario','system_allocation','spike','incident','data_gap'
  )),
  learning_classification TEXT NOT NULL CHECK(learning_classification IN ('no_change','candidate_learning','confirmed_learning')),
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(analysis_v3_id, race_id)
);

CREATE INDEX IF NOT EXISTS idx_post_race_reviews_v2_round
  ON post_race_reviews_v2(game_round_id, leg_number);
CREATE INDEX IF NOT EXISTS idx_post_race_reviews_v2_analysis
  ON post_race_reviews_v2(analysis_v3_id, leg_number);
CREATE INDEX IF NOT EXISTS idx_post_race_reviews_v2_failure
  ON post_race_reviews_v2(failure_class, learning_classification);

CREATE TABLE IF NOT EXISTS post_race_learning_links (
  review_id TEXT NOT NULL REFERENCES post_race_reviews_v2(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL REFERENCES learning_hypotheses(id),
  observation_id TEXT NOT NULL REFERENCES learning_observations(id),
  PRIMARY KEY(review_id, hypothesis_id),
  UNIQUE(observation_id)
);
