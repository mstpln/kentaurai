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

CREATE INDEX idx_horse_start_points_horse_observed
  ON horse_start_points(horse_id, observed_at DESC, id DESC);

CREATE INDEX idx_horse_start_points_points_observed
  ON horse_start_points(points DESC, observed_at DESC, horse_id);

ALTER TABLE horses ADD COLUMN current_start_points INTEGER CHECK (current_start_points >= 0);
ALTER TABLE horses ADD COLUMN current_start_points_observed_at TEXT;
ALTER TABLE horses ADD COLUMN current_start_points_source_record_id TEXT REFERENCES source_records(id) ON DELETE SET NULL;
