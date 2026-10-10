CREATE INDEX IF NOT EXISTS idx_cleanup_horse_stat_source_page
  ON horse_stat_snapshots(source_record_id,id);
