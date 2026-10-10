CREATE INDEX IF NOT EXISTS idx_cleanup_horse_record_order
  ON horse_record_snapshots(
    horse_id,record_scope,COALESCE(stat_year,-1),record_ordinal,observed_at,id
  );
