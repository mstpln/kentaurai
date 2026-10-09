PRAGMA foreign_keys = ON;

CREATE TABLE official_live_normalization_state (
  source_record_id TEXT PRIMARY KEY REFERENCES source_records(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  next_cursor INTEGER NOT NULL DEFAULT 0 CHECK(next_cursor >= 0),
  total_entries INTEGER CHECK(total_entries IS NULL OR total_entries >= 0),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','source_gap','failed')),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  last_error TEXT,
  reused_from_source_record_id TEXT REFERENCES source_records(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_official_live_normalization_state_status
  ON official_live_normalization_state(status, updated_at DESC, source_record_id);

CREATE INDEX idx_import_runs_live_normalize_success_cursor
  ON import_runs(
    json_extract(metadata_json,'$.sourceRecordId'),
    CAST(json_extract(metadata_json,'$.cursor') AS INTEGER)
  )
  WHERE source_type='official_provider_normalize'
    AND status='success'
    AND json_extract(metadata_json,'$.stage')='entry';

CREATE INDEX idx_import_runs_scheduled_orchestrator_started
  ON import_runs(started_at DESC, id DESC)
  WHERE source_type='scheduled_orchestrator';

CREATE INDEX idx_source_records_recent_normalized_official
  ON source_records(fetched_at DESC, id DESC)
  WHERE source_type='official_provider'
    AND quality_status='normalized_verified_subset'
    AND raw_object_key IS NOT NULL;

CREATE INDEX idx_source_records_external_content_normalized
  ON source_records(source_type, external_id, content_hash, fetched_at DESC, id DESC)
  WHERE quality_status='normalized_verified_subset'
    AND content_hash IS NOT NULL;
