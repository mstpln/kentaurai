CREATE INDEX IF NOT EXISTS idx_cleanup_horse_profile_order
  ON horse_profile_snapshots(horse_id,observed_at,id);
