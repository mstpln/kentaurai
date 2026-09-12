PRAGMA defer_foreign_keys = ON;

CREATE TABLE _0013_system_selections_backup AS
SELECT * FROM system_selections;

CREATE TABLE _0013_post_race_reviews_backup AS
SELECT * FROM post_race_reviews;

DROP TABLE system_selections;
DROP TABLE post_race_reviews;

CREATE TABLE systems_v2 (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  model_version_id TEXT REFERENCES model_versions(id),
  system_type TEXT NOT NULL DEFAULT 'main',
  budget_sek REAL NOT NULL,
  row_count INTEGER NOT NULL,
  line_price_sek REAL,
  spike_count INTEGER NOT NULL,
  estimated_hit_probability REAL,
  estimated_market_ownership REAL,
  value_metric REAL,
  risk_profile TEXT,
  created_at TEXT NOT NULL,
  metrics_json TEXT,
  notes TEXT,
  CHECK(spike_count IN (2, 3))
);

INSERT INTO systems_v2 (
  id, game_round_id, model_version_id, system_type, budget_sek, row_count,
  line_price_sek, spike_count, estimated_hit_probability,
  estimated_market_ownership, value_metric, risk_profile, created_at,
  metrics_json, notes
)
SELECT
  id, game_round_id, model_version_id, system_type, budget_sek, row_count,
  line_price_sek, spike_count, estimated_hit_probability,
  estimated_market_ownership, value_metric, risk_profile, created_at,
  NULL, NULL
FROM systems;

DROP TABLE systems;
ALTER TABLE systems_v2 RENAME TO systems;

CREATE TABLE system_selections (
  system_id TEXT NOT NULL REFERENCES systems(id),
  leg_number INTEGER NOT NULL,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  is_spike INTEGER NOT NULL DEFAULT 0,
  own_probability REAL,
  market_percent REAL,
  selection_reason TEXT,
  PRIMARY KEY(system_id, leg_number, race_entry_id)
);

INSERT INTO system_selections (
  system_id, leg_number, race_entry_id, is_spike,
  own_probability, market_percent, selection_reason
)
SELECT
  system_id, leg_number, race_entry_id, is_spike,
  own_probability, market_percent, selection_reason
FROM _0013_system_selections_backup;

CREATE TABLE post_race_reviews (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  race_id TEXT REFERENCES races(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  system_id TEXT REFERENCES systems(id),
  model_version_id TEXT REFERENCES model_versions(id),
  winner_rank INTEGER,
  winner_probability REAL,
  winner_market_percent REAL,
  selected_in_system INTEGER,
  error_type TEXT,
  scenario_match TEXT,
  review_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO post_race_reviews (
  id, game_round_id, race_id, race_entry_id, system_id, model_version_id,
  winner_rank, winner_probability, winner_market_percent,
  selected_in_system, error_type, scenario_match, review_json, created_at
)
SELECT
  id, game_round_id, race_id, race_entry_id, system_id, model_version_id,
  winner_rank, winner_probability, winner_market_percent,
  selected_in_system, error_type, scenario_match, review_json, created_at
FROM _0013_post_race_reviews_backup;

DROP TABLE _0013_system_selections_backup;
DROP TABLE _0013_post_race_reviews_backup;
