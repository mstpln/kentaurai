CREATE TABLE storage_cleanup_session_audits (
  session_id TEXT PRIMARY KEY REFERENCES storage_cleanup_sessions(id) ON DELETE CASCADE,
  source_sha TEXT NOT NULL CHECK (length(source_sha) = 40),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_storage_cleanup_session_audits_source
  ON storage_cleanup_session_audits(source_sha, verified_at DESC);
