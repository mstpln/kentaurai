PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS xlabs_interval_source_state (
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  mapper_version TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  interval_rows INTEGER,
  valid_intervals INTEGER,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(status IN ('pending','success','failed')),
  CHECK(attempts >= 0),
  CHECK(interval_rows IS NULL OR interval_rows >= 0),
  CHECK(valid_intervals IS NULL OR valid_intervals >= 0),
  PRIMARY KEY(source_record_id, mapper_version)
);

CREATE INDEX IF NOT EXISTS idx_xlabs_interval_source_state_status
  ON xlabs_interval_source_state(mapper_version, status, attempts, updated_at);

CREATE INDEX IF NOT EXISTS idx_xlabs_data_source_record
  ON xlabs_data(source_record_id);
