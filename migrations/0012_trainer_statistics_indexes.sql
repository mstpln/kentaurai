CREATE INDEX IF NOT EXISTS idx_entries_trainer
  ON race_entries(trainer_id, race_id)
  WHERE trainer_id IS NOT NULL;
