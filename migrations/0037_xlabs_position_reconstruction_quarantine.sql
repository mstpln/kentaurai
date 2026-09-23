ALTER TABLE xlabs_position_reconstruction_jobs
  ADD COLUMN quarantined_sources INTEGER NOT NULL DEFAULT 0 CHECK(quarantined_sources >= 0);

CREATE TABLE IF NOT EXISTS xlabs_position_reconstruction_quarantine (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES xlabs_position_reconstruction_jobs(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  failure_code TEXT NOT NULL,
  reconstruction_version TEXT NOT NULL,
  quarantined_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, source_record_id, reconstruction_version)
);

CREATE INDEX IF NOT EXISTS idx_xlabs_position_quarantine_job
  ON xlabs_position_reconstruction_quarantine(job_id, quarantined_at);

CREATE INDEX IF NOT EXISTS idx_xlabs_position_quarantine_source
  ON xlabs_position_reconstruction_quarantine(source_record_id, reconstruction_version);
