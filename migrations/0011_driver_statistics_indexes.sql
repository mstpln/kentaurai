CREATE INDEX IF NOT EXISTS idx_entries_driver
  ON race_entries(driver_id, race_id)
  WHERE driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_betting_snapshots_entry_time
  ON betting_snapshots(race_entry_id, captured_at);
