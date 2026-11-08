-- Private, append-only completed D1 export receipts for legacy cleanup.
-- An in-progress Cloudflare D1 export blocks D1 queries, so live progress
-- and the private export bookmark must be held in private R2 instead.
-- No SQL dump, racing identifiers or paid content are exposed in public logs.
CREATE TABLE IF NOT EXISTS legacy_cleanup_backups (
  id TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL CHECK(length(source_sha)=40),
  bookmark TEXT NOT NULL,
  object_key TEXT NOT NULL,
  object_etag TEXT NOT NULL,
  object_size INTEGER NOT NULL CHECK(object_size>=1024),
  status TEXT NOT NULL CHECK(status='complete'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legacy_cleanup_completed_at
  ON legacy_cleanup_backups(completed_at);
