CREATE TABLE IF NOT EXISTS race_position_checkpoints (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  checkpoint_key TEXT NOT NULL,
  checkpoint_m REAL,
  frame_index INTEGER NOT NULL CHECK(frame_index >= 0),
  observed_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms >= 0),
  leader_progress_m REAL NOT NULL,
  distance_to_finish_m REAL NOT NULL,
  position_rank INTEGER CHECK(position_rank IS NULL OR position_rank >= 1),
  meters_behind_leader REAL NOT NULL CHECK(meters_behind_leader >= 0),
  relative_lateral_offset_m REAL,
  positions_gained_since_previous INTEGER,
  gap_gain_m_since_previous REAL,
  observed_field_count INTEGER NOT NULL CHECK(observed_field_count >= 1),
  active_field_size INTEGER NOT NULL CHECK(active_field_size >= 1),
  field_coverage REAL NOT NULL CHECK(field_coverage >= 0 AND field_coverage <= 1),
  local_target_coverage REAL NOT NULL CHECK(local_target_coverage >= 0 AND local_target_coverage <= 1),
  longitudinal_confidence REAL NOT NULL CHECK(longitudinal_confidence >= 0 AND longitudinal_confidence <= 1),
  lateral_confidence REAL CHECK(lateral_confidence IS NULL OR (lateral_confidence >= 0 AND lateral_confidence <= 1)),
  reconstruction_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_entry_id, source_record_id, checkpoint_key, reconstruction_version)
);

CREATE INDEX IF NOT EXISTS idx_position_checkpoints_entry_source
  ON race_position_checkpoints(race_entry_id, source_record_id, reconstruction_version);
CREATE INDEX IF NOT EXISTS idx_position_checkpoints_source
  ON race_position_checkpoints(source_record_id, reconstruction_version);

CREATE TABLE IF NOT EXISTS race_trajectory_episodes (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  episode_type TEXT NOT NULL CHECK(episode_type IN (
    'lead_change_candidate',
    'forward_movement_candidate',
    'relative_loss_candidate',
    'wide_offset_candidate'
  )),
  start_checkpoint_key TEXT NOT NULL,
  end_checkpoint_key TEXT NOT NULL,
  start_frame_index INTEGER NOT NULL CHECK(start_frame_index >= 0),
  end_frame_index INTEGER NOT NULL CHECK(end_frame_index >= start_frame_index),
  start_observed_at TEXT NOT NULL,
  end_observed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
  progress_span_m REAL NOT NULL CHECK(progress_span_m >= 0),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  details_json TEXT NOT NULL DEFAULT '{}',
  reconstruction_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_id, race_entry_id, source_record_id, episode_type, start_checkpoint_key, end_checkpoint_key, reconstruction_version)
);

CREATE INDEX IF NOT EXISTS idx_trajectory_episodes_entry_source
  ON race_trajectory_episodes(race_entry_id, source_record_id, reconstruction_version);
CREATE INDEX IF NOT EXISTS idx_trajectory_episodes_race_source
  ON race_trajectory_episodes(race_id, source_record_id, reconstruction_version);

CREATE TABLE IF NOT EXISTS race_trajectory_summaries (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  total_frame_count INTEGER NOT NULL CHECK(total_frame_count >= 1),
  observed_frame_count INTEGER NOT NULL CHECK(observed_frame_count >= 0 AND observed_frame_count <= total_frame_count),
  frame_coverage REAL NOT NULL CHECK(frame_coverage >= 0 AND frame_coverage <= 1),
  checkpoint_count INTEGER NOT NULL CHECK(checkpoint_count >= 0),
  ranked_checkpoint_count INTEGER NOT NULL CHECK(ranked_checkpoint_count >= 0 AND ranked_checkpoint_count <= checkpoint_count),
  lateral_checkpoint_count INTEGER NOT NULL CHECK(lateral_checkpoint_count >= 0 AND lateral_checkpoint_count <= checkpoint_count),
  episode_count INTEGER NOT NULL CHECK(episode_count >= 0),
  longitudinal_confidence REAL NOT NULL CHECK(longitudinal_confidence >= 0 AND longitudinal_confidence <= 1),
  lateral_confidence REAL CHECK(lateral_confidence IS NULL OR (lateral_confidence >= 0 AND lateral_confidence <= 1)),
  reconstruction_status TEXT NOT NULL CHECK(reconstruction_status IN ('usable','partial','insufficient')),
  reconstruction_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_entry_id, source_record_id, reconstruction_version)
);

CREATE INDEX IF NOT EXISTS idx_trajectory_summaries_entry_source
  ON race_trajectory_summaries(race_entry_id, source_record_id, reconstruction_version);
CREATE INDEX IF NOT EXISTS idx_trajectory_summaries_source
  ON race_trajectory_summaries(source_record_id, reconstruction_version);

CREATE TABLE IF NOT EXISTS xlabs_position_reconstruction_jobs (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  cursor_external_id TEXT,
  cursor_fetched_at TEXT,
  cursor_source_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  processed_sources INTEGER NOT NULL DEFAULT 0 CHECK(processed_sources >= 0),
  inserted_rows INTEGER NOT NULL DEFAULT 0 CHECK(inserted_rows >= 0),
  skipped_rows INTEGER NOT NULL DEFAULT 0 CHECK(skipped_rows >= 0),
  consecutive_errors INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_errors >= 0),
  last_attempt_source_record_id TEXT,
  last_error TEXT,
  last_run_at TEXT,
  reconstruction_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_xlabs_position_jobs_status
  ON xlabs_position_reconstruction_jobs(status, reconstruction_version, created_at);