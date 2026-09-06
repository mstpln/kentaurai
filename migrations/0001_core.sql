PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_records (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  effective_at TEXT,
  raw_object_key TEXT,
  content_hash TEXT,
  quality_status TEXT NOT NULL DEFAULT 'unknown',
  rights_status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_records_unique_external
  ON source_records(source_type, external_id, fetched_at)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  error_json TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS horses (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  sex TEXT,
  birth_year INTEGER,
  breed TEXT,
  color TEXT,
  sire_name TEXT,
  dam_name TEXT,
  damsire_name TEXT,
  breeder TEXT,
  owner TEXT,
  current_trainer_id TEXT,
  home_track_id TEXT,
  country_code TEXT,
  active INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_horses_name ON horses(canonical_name);

CREATE TABLE IF NOT EXISTS horse_external_ids (
  horse_id TEXT NOT NULL REFERENCES horses(id),
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY(source_type, external_id),
  UNIQUE(horse_id, source_type)
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  country_code TEXT,
  home_track_id TEXT,
  active INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drivers_name ON drivers(canonical_name);

CREATE TABLE IF NOT EXISTS driver_external_ids (
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY(source_type, external_id),
  UNIQUE(driver_id, source_type)
);

CREATE TABLE IF NOT EXISTS trainers (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  country_code TEXT,
  active INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trainers_name ON trainers(canonical_name);

CREATE TABLE IF NOT EXISTS trainer_external_ids (
  trainer_id TEXT NOT NULL REFERENCES trainers(id),
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY(source_type, external_id),
  UNIQUE(trainer_id, source_type)
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  city TEXT,
  country_code TEXT,
  lap_length_m INTEGER,
  home_stretch_m INTEGER,
  curve_radius_m REAL,
  banking_degrees REAL,
  width_m REAL,
  surface TEXT,
  open_stretch_lanes INTEGER,
  angled_mobile_wing INTEGER,
  start_notes TEXT,
  track_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS track_external_ids (
  track_id TEXT NOT NULL REFERENCES tracks(id),
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY(source_type, external_id),
  UNIQUE(track_id, source_type)
);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  track_id TEXT REFERENCES tracks(id),
  race_date TEXT NOT NULL,
  race_number INTEGER,
  scheduled_start_at TEXT,
  distance_m INTEGER,
  start_method TEXT,
  field_size INTEGER,
  first_prize_sek INTEGER,
  race_name TEXT,
  main_class TEXT,
  class_flags_json TEXT,
  status TEXT,
  source_quality TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, race_date, race_number)
);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);

CREATE TABLE IF NOT EXISTS race_external_ids (
  race_id TEXT NOT NULL REFERENCES races(id),
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY(source_type, external_id),
  UNIQUE(race_id, source_type)
);

CREATE TABLE IF NOT EXISTS race_entries (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  horse_id TEXT NOT NULL REFERENCES horses(id),
  driver_id TEXT REFERENCES drivers(id),
  trainer_id TEXT REFERENCES trainers(id),
  start_number INTEGER,
  actual_lane INTEGER,
  start_tier INTEGER,
  handicap_m INTEGER NOT NULL DEFAULT 0,
  actual_start_distance_m INTEGER,
  springspar INTEGER,
  inner_lane INTEGER,
  back_row INTEGER,
  scratched INTEGER NOT NULL DEFAULT 0,
  scratch_reason TEXT,
  data_quality TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_id, horse_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_race ON race_entries(race_id);
CREATE INDEX IF NOT EXISTS idx_entries_horse ON race_entries(horse_id);

CREATE TABLE IF NOT EXISTS race_results (
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

CREATE TABLE IF NOT EXISTS race_positions (
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
CREATE INDEX IF NOT EXISTS idx_positions_entry ON race_positions(race_entry_id);

CREATE TABLE IF NOT EXISTS equipment (
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

CREATE TABLE IF NOT EXISTS xlabs_data (
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

CREATE TABLE IF NOT EXISTS race_conditions (
  race_id TEXT PRIMARY KEY REFERENCES races(id),
  track_status TEXT,
  temperature_c REAL,
  wind_mps REAL,
  wind_direction TEXT,
  precipitation_mm REAL,
  weather_text TEXT,
  day_profile_json TEXT,
  source_record_id TEXT REFERENCES source_records(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_rounds (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  round_date TEXT NOT NULL,
  primary_track_id TEXT REFERENCES tracks(id),
  scheduled_start_at TEXT,
  bet_stop_at TEXT,
  jackpot_sek INTEGER,
  turnover_sek INTEGER,
  payout_json TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rounds_type_date ON game_rounds(game_type, round_date);

CREATE TABLE IF NOT EXISTS game_legs (
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  leg_number INTEGER NOT NULL,
  race_id TEXT NOT NULL REFERENCES races(id),
  PRIMARY KEY(game_round_id, leg_number),
  UNIQUE(game_round_id, race_id)
);

CREATE TABLE IF NOT EXISTS betting_snapshots (
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
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_round_time ON betting_snapshots(game_round_id, captured_at);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  captured_at TEXT NOT NULL,
  market_type TEXT NOT NULL,
  odds REAL,
  source_record_id TEXT REFERENCES source_records(id),
  UNIQUE(race_entry_id, captured_at, market_type)
);

CREATE TABLE IF NOT EXISTS editorial_items (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS editorial_signals (
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
CREATE INDEX IF NOT EXISTS idx_editorial_signals_item ON editorial_signals(editorial_item_id);

CREATE TABLE IF NOT EXISTS analysis_features (
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
CREATE INDEX IF NOT EXISTS idx_analysis_features_entry ON analysis_features(race_entry_id, feature_version, as_of);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  prompt_version TEXT,
  ai_provider TEXT,
  ai_model TEXT,
  config_json TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS ai_race_analyses (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  model_version_id TEXT NOT NULL REFERENCES model_versions(id),
  data_snapshot_at TEXT NOT NULL,
  market_blind INTEGER NOT NULL,
  scenarios_json TEXT,
  race_shape_summary TEXT,
  conclusion TEXT,
  data_quality TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_horse_predictions (
  id TEXT PRIMARY KEY,
  ai_race_analysis_id TEXT NOT NULL REFERENCES ai_race_analyses(id),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  win_probability REAL NOT NULL,
  uncertainty_low REAL,
  uncertainty_high REAL,
  raw_rank INTEGER,
  abcd_group TEXT,
  value_ratio REAL,
  scenario_robustness REAL,
  reasoning_json TEXT,
  UNIQUE(ai_race_analysis_id, race_entry_id)
);

CREATE TABLE IF NOT EXISTS systems (
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
  CHECK(spike_count = 3)
);

CREATE TABLE IF NOT EXISTS system_selections (
  system_id TEXT NOT NULL REFERENCES systems(id),
  leg_number INTEGER NOT NULL,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  is_spike INTEGER NOT NULL DEFAULT 0,
  own_probability REAL,
  market_percent REAL,
  selection_reason TEXT,
  PRIMARY KEY(system_id, leg_number, race_entry_id)
);

CREATE TABLE IF NOT EXISTS post_race_reviews (
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

CREATE TABLE IF NOT EXISTS learning_hypotheses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  hypothesis_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  min_evidence_target INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_observations (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES learning_hypotheses(id),
  game_round_id TEXT REFERENCES game_rounds(id),
  race_id TEXT REFERENCES races(id),
  direction TEXT NOT NULL,
  strength REAL,
  observation_text TEXT NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_observations_hypothesis ON learning_observations(hypothesis_id);

CREATE TABLE IF NOT EXISTS model_change_log (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT REFERENCES learning_hypotheses(id),
  from_model_version_id TEXT REFERENCES model_versions(id),
  to_model_version_id TEXT REFERENCES model_versions(id),
  change_type TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
