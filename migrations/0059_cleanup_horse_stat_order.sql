CREATE INDEX IF NOT EXISTS idx_cleanup_horse_stat_order
  ON horse_stat_snapshots(horse_id,snapshot_scope,observed_at,id);
