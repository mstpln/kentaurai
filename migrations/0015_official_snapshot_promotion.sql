CREATE TABLE horse_profile_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  age_years INTEGER CHECK (age_years IS NULL OR age_years >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  quality_status TEXT NOT NULL DEFAULT 'verified_official_snapshot',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (horse_id, source_record_id)
);
CREATE INDEX idx_horse_profile_snapshots_asof
  ON horse_profile_snapshots(horse_id, observed_at DESC, id DESC);

CREATE TABLE horse_stat_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  snapshot_scope TEXT NOT NULL,
  stat_year INTEGER,
  starts INTEGER CHECK (starts IS NULL OR starts >= 0),
  earnings_raw INTEGER CHECK (earnings_raw IS NULL OR earnings_raw >= 0),
  wins INTEGER CHECK (wins IS NULL OR wins >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK (thirds IS NULL OR thirds >= 0),
  win_percentage_raw INTEGER CHECK (win_percentage_raw IS NULL OR win_percentage_raw >= 0),
  place_percentage_raw INTEGER CHECK (place_percentage_raw IS NULL OR place_percentage_raw >= 0),
  earnings_per_start_raw INTEGER CHECK (earnings_per_start_raw IS NULL OR earnings_per_start_raw >= 0),
  start_points INTEGER CHECK (start_points IS NULL OR start_points >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  quality_status TEXT NOT NULL DEFAULT 'verified_official_snapshot',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (snapshot_scope = 'life' AND stat_year IS NULL)
    OR (snapshot_scope LIKE 'year:%' AND stat_year IS NOT NULL)
  ),
  UNIQUE (horse_id, source_record_id, snapshot_scope)
);
CREATE INDEX idx_horse_stat_snapshots_asof
  ON horse_stat_snapshots(horse_id, snapshot_scope, observed_at DESC, id DESC);

CREATE TABLE horse_record_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  record_scope TEXT NOT NULL CHECK (record_scope IN ('current', 'year', 'life')),
  stat_year INTEGER,
  record_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (record_ordinal >= 0),
  code TEXT,
  start_method TEXT,
  distance_group TEXT,
  time_minutes INTEGER CHECK (time_minutes IS NULL OR time_minutes >= 0),
  time_seconds INTEGER CHECK (time_seconds IS NULL OR (time_seconds >= 0 AND time_seconds <= 59)),
  time_tenths INTEGER CHECK (time_tenths IS NULL OR (time_tenths >= 0 AND time_tenths <= 9)),
  place INTEGER CHECK (place IS NULL OR place >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  quality_status TEXT NOT NULL DEFAULT 'verified_official_snapshot',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (record_scope = 'year' AND stat_year IS NOT NULL)
    OR (record_scope IN ('current', 'life') AND stat_year IS NULL)
  ),
  UNIQUE (horse_id, source_record_id, record_scope, stat_year, record_ordinal)
);
CREATE INDEX idx_horse_record_snapshots_asof
  ON horse_record_snapshots(horse_id, record_scope, stat_year, observed_at DESC, record_ordinal, id DESC);

CREATE TABLE person_stat_snapshots (
  id TEXT PRIMARY KEY,
  person_type TEXT NOT NULL CHECK (person_type IN ('driver', 'trainer')),
  person_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  stat_year INTEGER NOT NULL,
  starts INTEGER CHECK (starts IS NULL OR starts >= 0),
  earnings_raw INTEGER CHECK (earnings_raw IS NULL OR earnings_raw >= 0),
  wins INTEGER CHECK (wins IS NULL OR wins >= 0),
  seconds INTEGER CHECK (seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK (thirds IS NULL OR thirds >= 0),
  win_percentage_raw INTEGER CHECK (win_percentage_raw IS NULL OR win_percentage_raw >= 0),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  quality_status TEXT NOT NULL DEFAULT 'verified_official_snapshot',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (person_type, person_id, source_record_id, stat_year)
);
CREATE INDEX idx_person_stat_snapshots_asof
  ON person_stat_snapshots(person_type, person_id, stat_year, observed_at DESC, id DESC);

CREATE TABLE official_snapshot_source_sync (
  source_record_id TEXT PRIMARY KEY REFERENCES source_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  horse_profile_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_profile_count >= 0),
  horse_stat_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_stat_count >= 0),
  horse_record_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_record_count >= 0),
  person_stat_count INTEGER NOT NULL DEFAULT 0 CHECK (person_stat_count >= 0),
  skipped_unmapped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_unmapped_count >= 0),
  error_message TEXT
);