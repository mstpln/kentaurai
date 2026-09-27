CREATE INDEX idx_official_snapshot_observations_snapshot_lookup
  ON official_snapshot_observations(snapshot_family, snapshot_id, observed_at DESC, source_record_id DESC);
