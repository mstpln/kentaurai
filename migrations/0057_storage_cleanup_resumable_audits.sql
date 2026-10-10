-- A completed snapshot-source sync is the commit marker for one immutable
-- official snapshot import.  Advancing one revision per source (rather than
-- one trigger write per snapshot) keeps normal ingestion costs bounded while
-- making a multi-request cleanup audit stale as soon as new sports evidence
-- is committed.
CREATE TABLE storage_cleanup_dataset_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO storage_cleanup_dataset_revision(singleton,revision)
VALUES (1,0);

CREATE TRIGGER storage_cleanup_sync_revision_insert
AFTER INSERT ON official_snapshot_source_sync
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision
  SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_sync_revision_update
AFTER UPDATE ON official_snapshot_source_sync
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision
  SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_sync_revision_delete
AFTER DELETE ON official_snapshot_source_sync
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision
  SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE singleton=1;
END;

CREATE TABLE storage_cleanup_audit_runs (
  id TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL CHECK (length(source_sha) = 40),
  dataset_revision INTEGER NOT NULL CHECK (dataset_revision >= 0),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','complete','failed','stale','expired','exhausted')),
  continuation_count INTEGER NOT NULL DEFAULT 1 CHECK (continuation_count >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX idx_storage_cleanup_audit_runs_running
  ON storage_cleanup_audit_runs(source_sha,dataset_revision)
  WHERE status='running';

CREATE INDEX idx_storage_cleanup_audit_runs_status
  ON storage_cleanup_audit_runs(status,expires_at,updated_at);

CREATE TABLE storage_cleanup_audit_progress (
  audit_run_id TEXT NOT NULL REFERENCES storage_cleanup_audit_runs(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  cursor TEXT,
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1)),
  pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  rows_checked INTEGER NOT NULL DEFAULT 0 CHECK (rows_checked >= 0),
  mismatched_sources INTEGER NOT NULL DEFAULT 0 CHECK (mismatched_sources >= 0),
  missing_representations INTEGER NOT NULL DEFAULT 0 CHECK (missing_representations >= 0),
  excess_representations INTEGER NOT NULL DEFAULT 0 CHECK (excess_representations >= 0),
  dangling_observations INTEGER NOT NULL DEFAULT 0 CHECK (dangling_observations >= 0),
  identity_mismatch_observations INTEGER NOT NULL DEFAULT 0 CHECK (identity_mismatch_observations >= 0),
  timestamp_mismatches INTEGER NOT NULL DEFAULT 0 CHECK (timestamp_mismatches >= 0),
  started_batches INTEGER NOT NULL DEFAULT 0 CHECK (started_batches >= 0),
  stranded_raw_batches INTEGER NOT NULL DEFAULT 0 CHECK (stranded_raw_batches >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_run_id,target)
);

CREATE TABLE storage_cleanup_audit_source_counts (
  audit_run_id TEXT NOT NULL REFERENCES storage_cleanup_audit_runs(id) ON DELETE CASCADE,
  family TEXT NOT NULL CHECK (family IN ('horse_profile','horse_stat','horse_record','person_stat')),
  source_record_id TEXT NOT NULL,
  actual_count INTEGER NOT NULL DEFAULT 0 CHECK (actual_count >= 0),
  PRIMARY KEY (audit_run_id,family,source_record_id)
);

ALTER TABLE storage_cleanup_session_audits ADD COLUMN audit_run_id TEXT;
ALTER TABLE storage_cleanup_session_audits ADD COLUMN dataset_revision INTEGER;

CREATE INDEX idx_storage_cleanup_session_audits_run
  ON storage_cleanup_session_audits(audit_run_id,dataset_revision);
