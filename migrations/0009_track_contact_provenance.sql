PRAGMA foreign_keys = ON;

-- Provenance for manually verified track contact facts. Real values live only in private D1.
CREATE TABLE IF NOT EXISTS track_contact_fact_observations (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('street_address','postal_code','website_url')),
  fact_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_track','official_sport','secondary')),
  first_verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified','conflict')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, fact_type, fact_value, source_url)
);

CREATE INDEX IF NOT EXISTS idx_track_contact_fact_observations_track
  ON track_contact_fact_observations(track_id, fact_type, status);
