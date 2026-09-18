PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_races_track_date
  ON races(track_id, race_date);

CREATE INDEX IF NOT EXISTS idx_entries_trainer
  ON race_entries(trainer_id);

CREATE INDEX IF NOT EXISTS idx_entries_driver
  ON race_entries(driver_id);

CREATE INDEX IF NOT EXISTS idx_entries_horse_race
  ON race_entries(horse_id, race_id);

CREATE INDEX IF NOT EXISTS idx_entries_trainer_race
  ON race_entries(trainer_id, race_id);

CREATE INDEX IF NOT EXISTS idx_entries_driver_race
  ON race_entries(driver_id, race_id);

CREATE INDEX IF NOT EXISTS idx_game_legs_race
  ON game_legs(race_id);

CREATE INDEX IF NOT EXISTS idx_betting_entry_time
  ON betting_snapshots(race_entry_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_odds_entry_time
  ON odds_snapshots(race_entry_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_equipment_entry
  ON equipment(race_entry_id);

CREATE INDEX IF NOT EXISTS idx_xlabs_entry
  ON xlabs_data(race_entry_id);

CREATE INDEX IF NOT EXISTS idx_editorial_items_entry
  ON editorial_items(race_entry_id);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_entry
  ON ai_horse_predictions(race_entry_id);
