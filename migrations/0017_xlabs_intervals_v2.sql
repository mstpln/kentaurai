PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS xlabs_intervals (
  id TEXT PRIMARY KEY,
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  interval_start_m INTEGER NOT NULL,
  interval_end_m INTEGER NOT NULL,
  elapsed_ms REAL,
  km_pace_ms REAL,
  measured_distance_m REAL,
  local_target_frame_count INTEGER NOT NULL,
  local_window_frame_count INTEGER NOT NULL,
  local_frame_coverage REAL NOT NULL,
  start_endpoint_error_m REAL,
  end_endpoint_error_m REAL,
  eligibility_status TEXT NOT NULL,
  mapper_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(interval_start_m >= 0),
  CHECK(interval_end_m > interval_start_m),
  CHECK(local_target_frame_count >= 0),
  CHECK(local_window_frame_count >= 0),
  CHECK(local_target_frame_count <= local_window_frame_count),
  CHECK(local_frame_coverage >= 0 AND local_frame_coverage <= 1),
  CHECK(eligibility_status IN (
    'valid',
    'missing_endpoint',
    'invalid_progression',
    'endpoint_too_far',
    'distance_mismatch',
    'insufficient_local_coverage'
  )),
  CHECK(
    eligibility_status <> 'valid'
    OR (elapsed_ms IS NOT NULL AND elapsed_ms > 0 AND km_pace_ms IS NOT NULL AND km_pace_ms > 0 AND measured_distance_m IS NOT NULL AND measured_distance_m > 0)
  ),
  UNIQUE(race_entry_id, source_record_id, interval_start_m, interval_end_m, mapper_version)
);

CREATE INDEX IF NOT EXISTS idx_xlabs_intervals_entry_source
  ON xlabs_intervals(race_entry_id, source_record_id, mapper_version, interval_start_m);

CREATE INDEX IF NOT EXISTS idx_xlabs_intervals_source
  ON xlabs_intervals(source_record_id, mapper_version, eligibility_status);
