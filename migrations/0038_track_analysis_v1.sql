PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_position_checkpoints_track_analysis
  ON race_position_checkpoints(reconstruction_version, checkpoint_key, race_entry_id, source_record_id);
