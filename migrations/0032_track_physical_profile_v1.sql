PRAGMA foreign_keys = ON;

-- Detailed physical track geometry. Real production values are private data and are
-- populated through the admin enrichment path; public migrations contain schema only.
CREATE TABLE IF NOT EXISTS track_profile_fact_observations (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'lap_length_m',
    'home_stretch_m',
    'open_stretch_lanes',
    'angled_mobile_wing',
    'width_1640_m',
    'width_2140_m',
    'large_curve_radius_m',
    'first_turn_radius_m',
    'second_turn_radius_m',
    'first_turn_banking_percent',
    'second_turn_banking_percent'
  )),
  numeric_value REAL NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('verified','calculated')),
  source_type TEXT NOT NULL CHECK (source_type IN ('official_track','official_sport','measurement','secondary','calculation')),
  source_url TEXT,
  verified_at TEXT NOT NULL,
  layout_effective_from TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','conflict')),
  calculation_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, fact_type, numeric_value, evidence_type, source_type, source_url, layout_effective_from)
);

CREATE INDEX IF NOT EXISTS idx_track_profile_fact_current
  ON track_profile_fact_observations(track_id, fact_type, status, layout_effective_from, evidence_type, verified_at DESC);

CREATE TABLE IF NOT EXISTS track_first_turn_distances (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  race_distance_m INTEGER NOT NULL CHECK (race_distance_m > 0),
  start_method TEXT NOT NULL DEFAULT 'unknown' CHECK (start_method IN ('auto','volt','unknown')),
  distance_to_first_turn_m REAL NOT NULL CHECK (distance_to_first_turn_m > 0),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('verified','calculated')),
  source_type TEXT NOT NULL CHECK (source_type IN ('official_track','official_sport','measurement','secondary','calculation')),
  source_url TEXT,
  verified_at TEXT NOT NULL,
  layout_effective_from TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','conflict')),
  calculation_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, race_distance_m, start_method, distance_to_first_turn_m, evidence_type, source_type, source_url, layout_effective_from)
);

CREATE INDEX IF NOT EXISTS idx_track_first_turn_current
  ON track_first_turn_distances(track_id, race_distance_m, start_method, status, layout_effective_from, evidence_type, verified_at DESC);
