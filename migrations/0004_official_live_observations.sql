CREATE TABLE IF NOT EXISTS normalized_observations (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  observed_at TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'normalized_verified_subset',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, source_record_id)
);
CREATE INDEX IF NOT EXISTS idx_normalized_observations_entity
  ON normalized_observations(entity_type, entity_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_normalized_observations_source
  ON normalized_observations(source_record_id);
