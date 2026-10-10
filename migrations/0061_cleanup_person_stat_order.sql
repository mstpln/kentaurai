CREATE INDEX IF NOT EXISTS idx_cleanup_person_stat_order
  ON person_stat_snapshots(person_type,person_id,stat_year,observed_at,id);
