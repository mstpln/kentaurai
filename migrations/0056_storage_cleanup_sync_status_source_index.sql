CREATE INDEX IF NOT EXISTS idx_official_snapshot_source_sync_status_source
  ON official_snapshot_source_sync(status, source_record_id);
