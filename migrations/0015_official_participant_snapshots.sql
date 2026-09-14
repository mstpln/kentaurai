CREATE TABLE horse_official_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  age_years INTEGER CHECK (age_years IS NULL OR age_years >= 0),
  record_code TEXT,
  record_start_method TEXT,
  record_distance_group TEXT,
  record_minutes INTEGER CHECK (record_minutes IS NULL OR record_minutes >= 0),
  record_seconds INTEGER CHECK (record_seconds IS NULL OR (record_seconds >= 0 AND record_seconds <= 59)),
  record_tenths INTEGER CHECK (record_tenths IS NULL OR (record_tenths >= 0 AND record_tenths <= 9)),
  life_starts INTEGER CHECK (life_starts IS NULL OR life_starts >= 0),
  life_earnings_raw INTEGER CHECK (life_earnings_raw IS NULL OR life_earnings_raw >= 0),
  life_firsts INTEGER CHECK (life_firsts IS NULL OR life_firsts >= 0),
  life_seconds INTEGER CHECK (life_seconds IS NULL OR life_seconds >= 0),
  life_thirds INTEGER CHECK (life_thirds IS NULL OR life_thirds >= 0),
  life_win_percentage_hundredths INTEGER CHECK (life_win_percentage_hundredths IS NULL OR life_win_percentage_hundredths >= 0),
  life_place_percentage_hundredths INTEGER CHECK (life_place_percentage_hundredths IS NULL OR life_place_percentage_hundredths >= 0),
  life_earnings_per_start_raw INTEGER CHECK (life_earnings_per_start_raw IS NULL OR life_earnings_per_start_raw >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (horse_id, source_record_id)
);
CREATE INDEX idx_horse_official_snapshots_asof
  ON horse_official_snapshots(horse_id, observed_at DESC, source_record_id DESC);

CREATE TABLE horse_official_year_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  stat_year INTEGER NOT NULL CHECK (stat_year >= 1900 AND stat_year <= 2200),
  observed_at TEXT NOT NULL,
  starts INTEGER CHECK (starts IS NULL OR starts >= 0),
  earnings_raw INTEGER CHECK (earnings_raw IS NULL OR earnings_raw >= 0),
  firsts INTEGER CHECK (firsts IS NULL OR firsts >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK (thirds IS NULL OR thirds >= 0),
  win_percentage_hundredths INTEGER CHECK (win_percentage_hundredths IS NULL OR win_percentage_hundredths >= 0),
  place_percentage_hundredths INTEGER CHECK (place_percentage_hundredths IS NULL OR place_percentage_hundredths >= 0),
  earnings_per_start_raw INTEGER CHECK (earnings_per_start_raw IS NULL OR earnings_per_start_raw >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (horse_id, source_record_id, stat_year)
);
CREATE INDEX idx_horse_official_year_snapshots_asof
  ON horse_official_year_snapshots(horse_id, stat_year, observed_at DESC, source_record_id DESC);

CREATE TABLE horse_official_record_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  record_scope TEXT NOT NULL CHECK (record_scope IN ('current', 'year')),
  stat_year INTEGER CHECK (stat_year IS NULL OR (stat_year >= 1900 AND stat_year <= 2200)),
  source_index INTEGER NOT NULL CHECK (source_index >= 0),
  observed_at TEXT NOT NULL,
  record_code TEXT,
  start_method TEXT,
  distance_group TEXT,
  minutes INTEGER CHECK (minutes IS NULL OR minutes >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR (seconds >= 0 AND seconds <= 59)),
  tenths INTEGER CHECK (tenths IS NULL OR (tenths >= 0 AND tenths <= 9)),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((record_scope = 'current' AND stat_year IS NULL) OR (record_scope = 'year' AND stat_year IS NOT NULL)),
  UNIQUE (horse_id, source_record_id, record_scope, stat_year, source_index)
);
CREATE INDEX idx_horse_official_record_snapshots_asof
  ON horse_official_record_snapshots(horse_id, observed_at DESC, source_record_id DESC);

CREATE TABLE driver_official_year_snapshots (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  stat_year INTEGER NOT NULL CHECK (stat_year >= 1900 AND stat_year <= 2200),
  observed_at TEXT NOT NULL,
  starts INTEGER CHECK (starts IS NULL OR starts >= 0),
  earnings_raw INTEGER CHECK (earnings_raw IS NULL OR earnings_raw >= 0),
  firsts INTEGER CHECK (firsts IS NULL OR firsts >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK (thirds IS NULL OR thirds >= 0),
  win_percentage_hundredths INTEGER CHECK (win_percentage_hundredths IS NULL OR win_percentage_hundredths >= 0),
  place_percentage_hundredths INTEGER CHECK (place_percentage_hundredths IS NULL OR place_percentage_hundredths >= 0),
  earnings_per_start_raw INTEGER CHECK (earnings_per_start_raw IS NULL OR earnings_per_start_raw >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (driver_id, source_record_id, stat_year)
);
CREATE INDEX idx_driver_official_year_snapshots_asof
  ON driver_official_year_snapshots(driver_id, stat_year, observed_at DESC, source_record_id DESC);

CREATE TABLE trainer_official_year_snapshots (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  stat_year INTEGER NOT NULL CHECK (stat_year >= 1900 AND stat_year <= 2200),
  observed_at TEXT NOT NULL,
  starts INTEGER CHECK (starts IS NULL OR starts >= 0),
  earnings_raw INTEGER CHECK (earnings_raw IS NULL OR earnings_raw >= 0),
  firsts INTEGER CHECK (firsts IS NULL OR firsts >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK (thirds IS NULL OR thirds >= 0),
  win_percentage_hundredths INTEGER CHECK (win_percentage_hundredths IS NULL OR win_percentage_hundredths >= 0),
  place_percentage_hundredths INTEGER CHECK (place_percentage_hundredths IS NULL OR place_percentage_hundredths >= 0),
  earnings_per_start_raw INTEGER CHECK (earnings_per_start_raw IS NULL OR earnings_per_start_raw >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (trainer_id, source_record_id, stat_year)
);
CREATE INDEX idx_trainer_official_year_snapshots_asof
  ON trainer_official_year_snapshots(trainer_id, stat_year, observed_at DESC, source_record_id DESC);

CREATE TABLE official_participant_snapshot_source_sync (
  source_record_id TEXT PRIMARY KEY REFERENCES source_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  horse_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_snapshot_count >= 0),
  horse_year_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_year_snapshot_count >= 0),
  horse_record_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_record_snapshot_count >= 0),
  driver_year_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (driver_year_snapshot_count >= 0),
  trainer_year_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (trainer_year_snapshot_count >= 0),
  error_message TEXT
);