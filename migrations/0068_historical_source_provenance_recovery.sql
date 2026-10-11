-- Private, bounded inventory and restore receipts. Never store raw official
-- payloads, paid material or identifiers in public GitHub artifacts.
CREATE TABLE historical_recovery_epoch (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO historical_recovery_epoch(singleton,revision) VALUES (1,0);

CREATE TABLE historical_recovery_runs (
  id TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL CHECK (length(source_sha)=40),
  phase TEXT NOT NULL DEFAULT 'inventory'
    CHECK (phase IN ('inventory','ready','applying','verify_pending','complete','complete_with_quarantine','paused','failed')),
  family_index INTEGER NOT NULL DEFAULT 0 CHECK (family_index BETWEEN 0 AND 4),
  after_source_id TEXT NOT NULL DEFAULT '',
  expected_epoch INTEGER NOT NULL CHECK (expected_epoch >= 0),
  started_epoch INTEGER NOT NULL CHECK (started_epoch >= 0),
  scan_drift INTEGER NOT NULL DEFAULT 0 CHECK (scan_drift IN (0,1)),
  scanned_sources INTEGER NOT NULL DEFAULT 0 CHECK (scanned_sources >= 0),
  deficient_sources INTEGER NOT NULL DEFAULT 0 CHECK (deficient_sources >= 0),
  missing_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
  ready_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  quarantined_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  restored_count INTEGER NOT NULL DEFAULT 0 CHECK (restored_count >= 0),
  post_remaining_missing INTEGER NOT NULL DEFAULT 0 CHECK(post_remaining_missing >= 0),
  post_excess INTEGER NOT NULL DEFAULT 0 CHECK(post_excess >= 0),
  backup_key TEXT,
  backup_etag TEXT,
  backup_bookmark TEXT,
  backup_size INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE UNIQUE INDEX idx_historical_recovery_one_active
  ON historical_recovery_runs ((1))
  WHERE phase IN ('inventory','ready','applying','verify_pending');
CREATE INDEX idx_historical_recovery_state
  ON historical_recovery_runs(phase,updated_at);

CREATE TABLE historical_recovery_receipts (
  run_id TEXT NOT NULL REFERENCES historical_recovery_runs(id) ON DELETE RESTRICT,
  family TEXT NOT NULL CHECK(family IN ('horse_profile','horse_stat','horse_record','person_stat')),
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('ready','quarantined','applied')),
  missing_count INTEGER NOT NULL DEFAULT 0 CHECK(missing_count >= 0),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
  restored_count INTEGER NOT NULL DEFAULT 0 CHECK(restored_count >= 0),
  source_hash TEXT NOT NULL,
  checked_epoch INTEGER NOT NULL CHECK(checked_epoch >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(run_id,family,source_record_id)
);
CREATE INDEX idx_historical_recovery_receipts_pending
  ON historical_recovery_receipts(run_id,status,family,source_record_id);

-- Each change to a relevant normalized fact/provenance/identity is fenced
-- while a recovery is active. The condition keeps normal daily ingestion
-- free of additional epoch writes when no inventory is running.
CREATE TRIGGER historical_recovery_epoch_source_records_insert AFTER INSERT ON source_records
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_source_records_update AFTER UPDATE ON source_records
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_source_records_delete AFTER DELETE ON source_records
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_source_sync_insert AFTER INSERT ON official_snapshot_source_sync
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_source_sync_update AFTER UPDATE ON official_snapshot_source_sync
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_source_sync_delete AFTER DELETE ON official_snapshot_source_sync
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_observations_insert AFTER INSERT ON official_snapshot_observations
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_observations_update AFTER UPDATE ON official_snapshot_observations
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_official_snapshot_observations_delete AFTER DELETE ON official_snapshot_observations
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_profile_snapshots_insert AFTER INSERT ON horse_profile_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_profile_snapshots_update AFTER UPDATE ON horse_profile_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_profile_snapshots_delete AFTER DELETE ON horse_profile_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_stat_snapshots_insert AFTER INSERT ON horse_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_stat_snapshots_update AFTER UPDATE ON horse_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_stat_snapshots_delete AFTER DELETE ON horse_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_record_snapshots_insert AFTER INSERT ON horse_record_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_record_snapshots_update AFTER UPDATE ON horse_record_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_record_snapshots_delete AFTER DELETE ON horse_record_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_person_stat_snapshots_insert AFTER INSERT ON person_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_person_stat_snapshots_update AFTER UPDATE ON person_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_person_stat_snapshots_delete AFTER DELETE ON person_stat_snapshots
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_external_ids_insert AFTER INSERT ON horse_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_external_ids_update AFTER UPDATE ON horse_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_horse_external_ids_delete AFTER DELETE ON horse_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_driver_external_ids_insert AFTER INSERT ON driver_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_driver_external_ids_update AFTER UPDATE ON driver_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_driver_external_ids_delete AFTER DELETE ON driver_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_trainer_external_ids_insert AFTER INSERT ON trainer_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_trainer_external_ids_update AFTER UPDATE ON trainer_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
CREATE TRIGGER historical_recovery_epoch_trainer_external_ids_delete AFTER DELETE ON trainer_external_ids
WHEN EXISTS(SELECT 1 FROM historical_recovery_runs WHERE phase IN ('inventory','ready','applying','verify_pending'))
BEGIN
  UPDATE historical_recovery_epoch SET revision=revision+1 WHERE singleton=1;
END;
