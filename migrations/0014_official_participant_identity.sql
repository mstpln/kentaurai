PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

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
  scratched INTEGER,
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
  back_row,
  CASE
    WHEN data_quality = 'official_declared_start_scratch_unverified' THEN NULL
    ELSE scratched
  END,
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

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
