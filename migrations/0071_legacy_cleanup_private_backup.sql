-- Private D1 export backup receipts for legacy cleanup. Never delete racing data here.
-- No SQL dump, original source IDs or editorial content are stored in this table.
CREATE TABLE IF NOT EXISTS legacy_cleanup_backups (
  id TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL CHECK(length(source_sha)=40),
  bookmark TEXT NOT NULL,
  object_key TEXT,
  object_etag TEXT,
  object_size INTEGER CHECK(object_size IS NULL OR object_size>=1024),
  status TEXT NOT NULL CHECK(status IN ('exporting','complete')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

-- Prevent overlapping, potentially expensive exports; preserve finished receipts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_cleanup_one_export
  ON legacy_cleanup_backups((1)) WHERE status='exporting';
