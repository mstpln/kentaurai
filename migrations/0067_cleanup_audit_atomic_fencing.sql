-- Audit pages are prepared read-only, applied atomically, and accepted only
-- after their complete D1 cost has been measured.  A pending page is never
-- authorization evidence.
ALTER TABLE storage_cleanup_audit_progress ADD COLUMN page_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storage_cleanup_audit_progress ADD COLUMN pending_page_id TEXT;

ALTER TABLE storage_cleanup_audit_runs ADD COLUMN failure_reason TEXT;
ALTER TABLE storage_cleanup_audit_runs ADD COLUMN continuation_rows_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storage_cleanup_audit_runs ADD COLUMN continuation_rows_written INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storage_cleanup_audit_runs ADD COLUMN continuation_duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storage_cleanup_audit_runs ADD COLUMN continuation_budget_exhausted INTEGER NOT NULL DEFAULT 0;

CREATE TABLE storage_cleanup_audit_pages (
  id TEXT PRIMARY KEY,
  audit_run_id TEXT NOT NULL REFERENCES storage_cleanup_audit_runs(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  page_version INTEGER NOT NULL CHECK (page_version >= 0),
  previous_cursor TEXT NOT NULL DEFAULT '',
  next_cursor TEXT,
  accept_before TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  rows_read INTEGER,
  rows_written INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TEXT,
  UNIQUE (audit_run_id,target,page_version)
);

CREATE INDEX idx_storage_cleanup_audit_pages_pending
  ON storage_cleanup_audit_pages(audit_run_id,status,created_at);

CREATE TRIGGER storage_cleanup_audit_page_insert_guard
BEFORE INSERT ON storage_cleanup_audit_pages
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM storage_cleanup_audit_runs r
    JOIN storage_cleanup_audit_progress p
      ON p.audit_run_id=r.id AND p.target=NEW.target
    JOIN storage_cleanup_dataset_revision d ON d.singleton=1
    WHERE r.id=NEW.audit_run_id
      AND r.status='running'
      AND r.dataset_revision=d.revision
      AND p.is_complete=0
      AND p.pending_page_id IS NULL
      AND p.page_version=NEW.page_version
      AND COALESCE(p.cursor,'')=NEW.previous_cursor
  ) THEN RAISE(ABORT,'cleanup audit page guard failed') END;
END;

CREATE TRIGGER storage_cleanup_audit_page_accept_guard
BEFORE UPDATE OF status ON storage_cleanup_audit_pages
WHEN NEW.status='accepted'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM storage_cleanup_audit_runs r
    JOIN storage_cleanup_audit_progress p
      ON p.audit_run_id=r.id AND p.target=NEW.target
    JOIN storage_cleanup_dataset_revision d ON d.singleton=1
    WHERE r.id=NEW.audit_run_id
      AND r.status='running'
      AND r.dataset_revision=d.revision
      AND p.pending_page_id=NEW.id
      AND OLD.status='pending'
      AND julianday(NEW.accept_before)>=julianday('now')
      AND r.continuation_rows_read+COALESCE(NEW.rows_read,0)<=1000000
      AND r.continuation_rows_written+COALESCE(NEW.rows_written,0)<=100000
  ) THEN RAISE(ABORT,'cleanup audit page acceptance guard failed') END;
END;

-- The executor inserts a short-lived guard as the first statement in its D1
-- batch.  The trigger makes authorization/revision validation part of the
-- same transaction as the destructive mutation.
CREATE INDEX IF NOT EXISTS idx_cleanup_audit_runs_live_revision
  ON storage_cleanup_audit_runs(dataset_revision,status,expires_at);

CREATE TABLE storage_cleanup_revision_guards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  audit_run_id TEXT NOT NULL,
  audit_revision INTEGER NOT NULL,
  expected_current_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER storage_cleanup_revision_guard_insert
BEFORE INSERT ON storage_cleanup_revision_guards
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM storage_cleanup_dataset_revision d
    JOIN storage_cleanup_audit_runs r
      ON r.id=NEW.audit_run_id AND r.status='complete'
    JOIN storage_cleanup_session_audits a
      ON a.session_id=NEW.session_id
      AND a.audit_run_id=NEW.audit_run_id
      AND a.dataset_revision=NEW.audit_revision
    JOIN storage_cleanup_sessions s
      ON s.id=NEW.session_id AND s.status='running'
    WHERE d.singleton=1
      AND d.revision=NEW.expected_current_revision
      AND r.dataset_revision=NEW.audit_revision
      AND r.dataset_revision=d.revision
      AND NEW.expected_current_revision=NEW.audit_revision
      AND r.source_sha=s.source_sha
      AND a.source_sha=s.source_sha
      AND julianday(r.expires_at)>julianday('now')
      AND julianday(s.expires_at)>julianday('now')
  ) THEN RAISE(ABORT,'cleanup authorization revision guard failed') END;
END;

-- Every D1 mutation that can change audit results, provenance, cleanup plans,
-- raw references or operational integrity advances the same monotonic fence.
CREATE TRIGGER storage_cleanup_source_record_revision_insert AFTER INSERT ON source_records
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_source_record_revision_update AFTER UPDATE ON source_records
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_source_record_revision_delete AFTER DELETE ON source_records
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_horse_profile_revision_insert AFTER INSERT ON horse_profile_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_profile_revision_update AFTER UPDATE ON horse_profile_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_profile_revision_delete AFTER DELETE ON horse_profile_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_horse_stat_revision_insert AFTER INSERT ON horse_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_stat_revision_update AFTER UPDATE ON horse_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_stat_revision_delete AFTER DELETE ON horse_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_horse_record_revision_insert AFTER INSERT ON horse_record_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_record_revision_update AFTER UPDATE ON horse_record_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_horse_record_revision_delete AFTER DELETE ON horse_record_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_person_stat_revision_insert AFTER INSERT ON person_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_person_stat_revision_update AFTER UPDATE ON person_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_person_stat_revision_delete AFTER DELETE ON person_stat_snapshots
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_observation_revision_insert AFTER INSERT ON official_snapshot_observations
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_observation_revision_update AFTER UPDATE ON official_snapshot_observations
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_observation_revision_delete AFTER DELETE ON official_snapshot_observations
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;

CREATE TRIGGER storage_cleanup_batch_revision_insert AFTER INSERT ON storage_cleanup_batches
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_batch_revision_update AFTER UPDATE ON storage_cleanup_batches
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
CREATE TRIGGER storage_cleanup_batch_revision_delete AFTER DELETE ON storage_cleanup_batches
WHEN EXISTS (
  SELECT 1 FROM storage_cleanup_audit_runs a
  JOIN storage_cleanup_dataset_revision d
    ON d.singleton=1 AND d.revision=a.dataset_revision
  WHERE a.status IN ('running','complete')
    AND julianday(a.expires_at)>julianday('now')
)
BEGIN
  UPDATE storage_cleanup_dataset_revision SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
END;
