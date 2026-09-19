PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_external_runs (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  model_version_id TEXT NOT NULL REFERENCES model_versions(id),
  main_system_id TEXT NOT NULL REFERENCES systems(id),
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-external-analysis-run-v1'),
  flow_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic')),
  model TEXT NOT NULL,
  step1_pack_id TEXT NOT NULL,
  step1_pack_as_of TEXT NOT NULL,
  step1_generated_at TEXT NOT NULL,
  step1_facts_fingerprint TEXT NOT NULL,
  step2_market_fingerprint TEXT NOT NULL,
  step2_market_cutoff TEXT NOT NULL,
  step2_generated_at TEXT NOT NULL,
  analysis_blindness TEXT NOT NULL CHECK(analysis_blindness IN ('declared_unsealed','declared_unsealed_post_race_import')),
  import_timing TEXT NOT NULL CHECK(import_timing IN ('pre_race','post_race_recovery')),
  learning_eligibility TEXT NOT NULL CHECK(learning_eligibility IN ('eligible_by_timing','manual_review_required')),
  payload_digest TEXT NOT NULL,
  supersedes_run_id TEXT REFERENCES analysis_external_runs(id),
  created_at TEXT NOT NULL,
  UNIQUE(model_version_id),
  UNIQUE(main_system_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_external_runs_round_created
  ON analysis_external_runs(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_external_runs_learning
  ON analysis_external_runs(learning_eligibility, step2_market_cutoff, created_at);

CREATE TABLE IF NOT EXISTS post_race_reviews_external_v1 (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  race_id TEXT NOT NULL REFERENCES races(id),
  leg_number INTEGER NOT NULL CHECK(leg_number BETWEEN 1 AND 8),
  winner_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  external_run_id TEXT NOT NULL REFERENCES analysis_external_runs(id),
  system_id TEXT NOT NULL REFERENCES systems(id),
  review_version TEXT NOT NULL,
  pre_race_fingerprint TEXT NOT NULL,
  winner_blind_probability REAL CHECK(winner_blind_probability IS NULL OR (winner_blind_probability >= 0 AND winner_blind_probability <= 1)),
  winner_rank INTEGER,
  scenario_match TEXT NOT NULL CHECK(scenario_match IN ('matched','missed','unavailable')),
  scenario_confidence REAL CHECK(scenario_confidence IS NULL OR (scenario_confidence >= 0 AND scenario_confidence <= 1)),
  data_quality_summary TEXT,
  coverage_json TEXT NOT NULL,
  winner_market_percent REAL CHECK(winner_market_percent IS NULL OR (winner_market_percent >= 0 AND winner_market_percent <= 100)),
  winner_market_rank INTEGER,
  system_selected INTEGER NOT NULL CHECK(system_selected IN (0,1)),
  system_is_spike INTEGER NOT NULL CHECK(system_is_spike IN (0,1)),
  system_selected_count INTEGER NOT NULL CHECK(system_selected_count >= 1),
  failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN (
    'ranking','probability','scenario','system_allocation','spike','incident','data_gap'
  )),
  learning_eligible INTEGER NOT NULL CHECK(learning_eligible IN (0,1)),
  learning_classification TEXT NOT NULL CHECK(learning_classification IN ('no_change','candidate_learning','confirmed_learning')),
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(external_run_id, race_id)
);

CREATE INDEX IF NOT EXISTS idx_post_race_reviews_external_round
  ON post_race_reviews_external_v1(game_round_id, leg_number);
CREATE INDEX IF NOT EXISTS idx_post_race_reviews_external_run
  ON post_race_reviews_external_v1(external_run_id, leg_number);
CREATE INDEX IF NOT EXISTS idx_post_race_reviews_external_failure
  ON post_race_reviews_external_v1(failure_class, learning_classification);

CREATE TABLE IF NOT EXISTS post_race_learning_links_external_v1 (
  review_id TEXT NOT NULL REFERENCES post_race_reviews_external_v1(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL REFERENCES learning_hypotheses(id),
  observation_id TEXT NOT NULL REFERENCES learning_observations(id),
  PRIMARY KEY(review_id, hypothesis_id),
  UNIQUE(observation_id)
);
