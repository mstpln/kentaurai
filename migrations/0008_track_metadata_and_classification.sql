PRAGMA foreign_keys = ON;

ALTER TABLE tracks ADD COLUMN street_address TEXT;
ALTER TABLE tracks ADD COLUMN postal_code TEXT;
ALTER TABLE tracks ADD COLUMN website_url TEXT;

ALTER TABLE races ADD COLUMN stl_class TEXT;
ALTER TABLE races ADD COLUMN race_types_json TEXT;

CREATE INDEX IF NOT EXISTS idx_races_track_class_filters
  ON races(track_id, race_date, start_method, distance_m, stl_class);
