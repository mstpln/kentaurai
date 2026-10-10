CREATE INDEX IF NOT EXISTS idx_cleanup_person_stat_source_page
  ON person_stat_snapshots(source_record_id,id);
