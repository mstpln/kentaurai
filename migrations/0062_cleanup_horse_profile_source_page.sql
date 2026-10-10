CREATE INDEX IF NOT EXISTS idx_cleanup_horse_profile_source_page
  ON horse_profile_snapshots(source_record_id,id);
