PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

-- D1 keeps foreign-key enforcement enabled during migrations. Back up and
-- temporarily remove every table that directly references race_entries (and
-- editorial_signals, which references editorial_items) before rebuilding the
-- parent table. All rows are restored in the same transaction.
CREATE TABLE _0014_race_results_backup AS SELECT * FROM race_results;
CREATE TABLE _0014_race_positions_backup AS SELECT * FROM race_positions;
CREATE TABLE _0014_equipment_backup AS SELECT * FROM equipment;
CREATE TABLE _0014_xlabs_data_backup AS SELECT * FROM xlabs_data;
CREATE TABLE _0014_betting_snapshots_backup AS SELECT * FROM betting_snapshots;
CREATE TABLE _0014_odds_snapshots_backup AS SELECT * FROM odds_snapshots;
CREATE TABLE _0014_editorial_items_backup AS SELECT * FROM editorial_items;
CREATE TABLE _0014_editorial_signals_backup AS SELECT * FROM editorial_signals;
CREATE TABLE _0014_analysis_features_backup AS SELECT * FROM analysis_features;
CREATE TABLE _0014_ai_horse_predictions_backup AS SELECT * FROM ai_horse_predictions;
CREATE TABLE _0014_system_selections_backup AS SELECT * FROM system_selections;
CREATE TABLE _0014_post_race_reviews_backup AS SELECT * FROM post_race_reviews;
CREATE TABLE _0014_reference_observations_backup AS SELECT * FROM reference_observations;
CREATE TABLE _0014_horse_start_points_backup AS SELECT * FROM horse_start_points;

DROP TABLE editorial_signals;
DROP TABLE race_results;
DROP TABLE race_positions;
DROP TABLE equipment;
DROP TABLE xlabs_data;
DROP TABLE betting_snapshots;
DROP TABLE odds_snapshots;
DROP TABLE editorial_items;
DROP TABLE analysis_features;
DROP TABLE ai_horse_predictions;
DROP TABLE system_selections;
DROP TABLE post_race_reviews;
DROP TABLE reference_observations;
DROP TABLE horse_start_points;

CREATE TABLE race_entries_v2 (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  horse_id TEXT REFERENCES horses(id),
  driver_id TEXT REFERENCES drivers(id),
  trainer_id TEXT REFERENCES trainers(id),
  source_start_id TEXT,
  declared_horse_name TEXT,
  declared_driver_name TEXT,
  declared_trainer_name TEXT,
  start_number INTEGER,
  actual_lane INTEGER,
  start_tier INTEGER,
  handicap_m INTEGER NOT NULL DEFAULT 0,
  actual_start_distance_m INTEGER,
  springspar INTEGER,
  inner_lane INTEGER,
  back_row INTEGER,
  scratched INTEGER DEFAULT 0,
  scratch_reason TEXT,
  data_quality TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_id, horse_id),
  UNIQUE(race_id, source_start_id)
);

INSERT INTO race_entries_v2 (
  id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane,
  start_tier, handicap_m, actual_start_distance_m, springspar, inner_lane,
  back_row, scratched, scratch_reason, data_quality, created_at, updated_at
)
SELECT
  id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane,
  start_tier, handicap_m, actual_start_distance_m, springspar, inner_lane,
  back_row, CASE WHEN data_quality = 'official_declared_start_scratch_unverified' THEN NULL ELSE scratched END,
  scratch_reason, data_quality, created_at, updated_at
FROM race_entries;

DROP TABLE race_entries;
ALTER TABLE race_entries_v2 RENAME TO race_entries;

CREATE INDEX idx_entries_race ON race_entries(race_id);
CREATE INDEX idx_entries_horse ON race_entries(horse_id);
CREATE INDEX idx_entries_driver ON race_entries(driver_id, race_id)
  WHERE driver_id IS NOT NULL;
CREATE INDEX idx_entries_trainer ON race_entries(trainer_id, race_id)
  WHERE trainer_id IS NOT NULL;
CREATE INDEX idx_entries_source_start ON race_entries(source_start_id)
  WHERE source_start_id IS NOT NULL;

CREATE TABLE race_results (
  race_entry_id TEXT PRIMARY KEY REFERENCES race_entries(id),
  placing INTEGER,
  placing_text TEXT,
  finish_time TEXT,
  km_time TEXT,
  prize_sek INTEGER,
  gallop INTEGER,
  disqualified INTEGER,
  distance_behind_winner_m REAL,
  official_odds REAL,
  result_status TEXT,
  source_record_id TEXT REFERENCES source_records(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO race_results SELECT * FROM _0014_race_results_backup;

CREATE TABLE race_positions (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  observed_at_m INTEGER,
  position INTEGER,
  lane INTEGER,
  leader INTEGER,
  pocket INTEGER,
  death_seat INTEGER,
  second_over INTEGER,
  third_over INTEGER,
  wide_trip INTEGER,
  uncovered_move INTEGER,
  traffic_event TEXT,
  event_json TEXT,
  source_record_id TEXT REFERENCES source_records(id)
);
CREATE INDEX idx_positions_entry ON race_positions(race_entry_id);
INSERT INTO race_positions SELECT * FROM _0014_race_positions_backup;

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  shoes_front TEXT,
  shoes_rear TEXT,
  barefoot_front INTEGER,
  barefoot_rear INTEGER,
  sulky_type TEXT,
  exact_sulky TEXT,
  headgear TEXT,
  earplugs TEXT,
  other_equipment TEXT,
  change_from_previous_json TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unknown',
  source_record_id TEXT REFERENCES source_records(id),
  UNIQUE(race_entry_id, source_record_id)
);
INSERT INTO equipment SELECT * FROM _0014_equipment_backup;

CREATE TABLE xlabs_data (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  first_200_time TEXT,
  last_200_time TEXT,
  last_400_time TEXT,
  last_500_time TEXT,
  last_800_time TEXT,
  last_1000_time TEXT,
  actual_distance_m REAL,
  extra_distance_m REAL,
  converted_km_time TEXT,
  slipstream_m REAL,
  segments_json TEXT,
  quality_status TEXT NOT NULL DEFAULT 'unknown',
  source_record_id TEXT REFERENCES source_records(id),
  UNIQUE(race_entry_id, source_record_id)
);
INSERT INTO xlabs_data SELECT * FROM _0014_xlabs_data_backup;

CREATE TABLE betting_snapshots (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  leg_number INTEGER NOT NULL,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  captured_at TEXT NOT NULL,
  bet_percent REAL,
  market_rank INTEGER,
  source_record_id TEXT REFERENCES source_records(id),
  UNIQUE(game_round_id, leg_number, race_entry_id, captured_at)
);
CREATE INDEX idx_betting_snapshots_round_time ON betting_snapshots(game_round_id, captured_at);
CREATE INDEX idx_betting_snapshots_entry_time ON betting_snapshots(race_entry_id, captured_at);
INSERT INTO betting_snapshots SELECT * FROM _0014_betting_snapshots_backup;

CREATE TABLE odds_snapshots (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  captured_at TEXT NOT NULL,
  market_type TEXT NOT NULL,
  odds REAL,
  source_record_id TEXT REFERENCES source_records(id),
  UNIQUE(race_entry_id, captured_at, market_type)
);
INSERT INTO odds_snapshots SELECT * FROM _0014_odds_snapshots_backup;

CREATE TABLE editorial_items (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT REFERENCES race_entries(id),
  horse_id TEXT REFERENCES horses(id),
  speaker_name TEXT,
  speaker_role TEXT,
  published_at TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT,
  summary_text TEXT,
  rights_status TEXT NOT NULL DEFAULT 'structured_only',
  source_record_id TEXT REFERENCES source_records(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  race_id TEXT REFERENCES races(id),
  game_round_id TEXT REFERENCES game_rounds(id)
);
INSERT INTO editorial_items SELECT * FROM _0014_editorial_items_backup;

CREATE TABLE editorial_signals (
  id TEXT PRIMARY KEY,
  editorial_item_id TEXT NOT NULL REFERENCES editorial_items(id),
  signal_type TEXT NOT NULL,
  value_text TEXT,
  polarity TEXT,
  strength REAL,
  fact_or_opinion TEXT NOT NULL,
  confidence REAL,
  evidence_excerpt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editorial_signals_item ON editorial_signals(editorial_item_id);
INSERT INTO editorial_signals SELECT * FROM _0014_editorial_signals_backup;

CREATE TABLE analysis_features (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  feature_version TEXT NOT NULL,
  as_of TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  uncertainty_low REAL,
  uncertainty_high REAL,
  data_quality TEXT,
  provenance_json TEXT,
  UNIQUE(race_entry_id, feature_version, as_of, feature_name)
);
CREATE INDEX idx_analysis_features_entry ON analysis_features(race_entry_id, feature_version, as_of);
INSERT INTO analysis_features SELECT * FROM _0014_analysis_features_backup;

CREATE TABLE ai_horse_predictions (
  id TEXT PRIMARY KEY,
  ai_race_analysis_id TEXT NOT NULL REFERENCES ai_race_analyses(id),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  win_probability REAL,
  uncertainty_low REAL,
  uncertainty_high REAL,
  raw_rank INTEGER,
  abcd_group TEXT,
  value_ratio REAL,
  scenario_robustness REAL,
  reasoning_json TEXT,
  UNIQUE(ai_race_analysis_id, race_entry_id)
);
INSERT INTO ai_horse_predictions SELECT * FROM _0014_ai_horse_predictions_backup;

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
INSERT INTO system_selections SELECT * FROM _0014_system_selections_backup;

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
INSERT INTO post_race_reviews SELECT * FROM _0014_post_race_reviews_backup;

CREATE TABLE reference_observations (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  current_race_entry_id TEXT REFERENCES race_entries(id),
  observation_type TEXT NOT NULL,
  observed_at TEXT,
  payload_json TEXT NOT NULL,
  source_refs_json TEXT,
  quality_status TEXT NOT NULL DEFAULT 'reference_only',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_reference_observations_round ON reference_observations(game_round_id, observation_type);
CREATE INDEX idx_reference_observations_entry ON reference_observations(current_race_entry_id, observation_type);
INSERT INTO reference_observations SELECT * FROM _0014_reference_observations_backup;

CREATE TABLE horse_start_points (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points >= 0),
  observed_at TEXT NOT NULL,
  race_entry_id TEXT REFERENCES race_entries(id) ON DELETE SET NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (horse_id, source_record_id)
);
CREATE INDEX idx_horse_start_points_horse_observed ON horse_start_points(horse_id, observed_at DESC, id DESC);
CREATE INDEX idx_horse_start_points_points_observed ON horse_start_points(points DESC, observed_at DESC, horse_id);
INSERT INTO horse_start_points SELECT * FROM _0014_horse_start_points_backup;

DROP TABLE _0014_race_results_backup;
DROP TABLE _0014_race_positions_backup;
DROP TABLE _0014_equipment_backup;
DROP TABLE _0014_xlabs_data_backup;
DROP TABLE _0014_betting_snapshots_backup;
DROP TABLE _0014_odds_snapshots_backup;
DROP TABLE _0014_editorial_items_backup;
DROP TABLE _0014_editorial_signals_backup;
DROP TABLE _0014_analysis_features_backup;
DROP TABLE _0014_ai_horse_predictions_backup;
DROP TABLE _0014_system_selections_backup;
DROP TABLE _0014_post_race_reviews_backup;
DROP TABLE _0014_reference_observations_backup;
DROP TABLE _0014_horse_start_points_backup;

PRAGMA legacy_alter_table = OFF;
