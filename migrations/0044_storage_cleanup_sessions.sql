CREATE TABLE storage_cleanup_sessions (
  id TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('execute')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete')),
  continuation_count INTEGER NOT NULL DEFAULT 0 CHECK (continuation_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE TABLE storage_cleanup_session_targets (
  session_id TEXT NOT NULL REFERENCES storage_cleanup_sessions(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('horse_profile','horse_stat','horse_record','person_stat','raw_object')),
  cursor TEXT,
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id,target)
);

CREATE INDEX idx_storage_cleanup_sessions_status
  ON storage_cleanup_sessions(status, expires_at, updated_at);
