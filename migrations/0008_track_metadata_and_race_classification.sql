ALTER TABLE tracks ADD COLUMN street_address TEXT;
ALTER TABLE tracks ADD COLUMN postal_code TEXT;
ALTER TABLE tracks ADD COLUMN website_url TEXT;

ALTER TABLE races ADD COLUMN stl_class TEXT;
ALTER TABLE races ADD COLUMN race_types_json TEXT;

CREATE INDEX IF NOT EXISTS idx_races_track_stl_class
  ON races(track_id, stl_class);
