CREATE TABLE storage_cleanup_batches (
  id TEXT PRIMARY KEY,
  cleanup_kind TEXT NOT NULL CHECK (cleanup_kind IN ('snapshot','raw_object')),
  target TEXT NOT NULL,
  plan_token TEXT NOT NULL,
  expected_changes INTEGER NOT NULL CHECK (expected_changes >= 0),
  actual_changes INTEGER CHECK (actual_changes IS NULL OR actual_changes = expected_changes),
  status TEXT NOT NULL CHECK (status IN ('started','references_rewritten','complete')),
  legacy_key TEXT,
  canonical_key TEXT,
  legacy_etag TEXT,
  canonical_etag TEXT,
  object_verified INTEGER NOT NULL DEFAULT 0 CHECK (object_verified IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX idx_storage_cleanup_batches_status
  ON storage_cleanup_batches(cleanup_kind, status, created_at);

CREATE INDEX idx_storage_cleanup_batches_legacy
  ON storage_cleanup_batches(cleanup_kind, legacy_key, created_at DESC);
