CREATE TABLE official_snapshot_observations (
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  snapshot_family TEXT NOT NULL CHECK (snapshot_family IN ('horse_profile','horse_stat','horse_record','person_stat')),
  entity_key TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  factual_changed INTEGER NOT NULL CHECK (factual_changed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_record_id, snapshot_family, entity_key, scope_key)
);

CREATE INDEX idx_official_snapshot_observations_asof
  ON official_snapshot_observations(snapshot_family, entity_key, scope_key, observed_at DESC, source_record_id DESC);

CREATE INDEX idx_source_records_content_hash
  ON source_records(source_type, content_hash, id);

CREATE INDEX idx_source_records_raw_object_key
  ON source_records(raw_object_key, id);
