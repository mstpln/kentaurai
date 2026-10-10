CREATE INDEX IF NOT EXISTS idx_cleanup_horse_record_source_page
  ON horse_record_snapshots(source_record_id,id);
