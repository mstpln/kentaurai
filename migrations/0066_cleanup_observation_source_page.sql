CREATE INDEX IF NOT EXISTS idx_cleanup_observation_source_page
  ON official_snapshot_observations(snapshot_family,source_record_id,entity_key,scope_key,snapshot_id);
