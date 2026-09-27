CREATE INDEX idx_source_records_live_game_pending
  ON source_records(
    quality_status,
    substr(external_id,10,10),
    fetched_at DESC,
    id DESC
  )
  WHERE source_type='official_provider'
    AND quality_status IN ('captured_unmapped','captured_source_gap')
    AND substr(external_id,1,9) IN ('game:V85_','game:V86_');

CREATE INDEX idx_import_runs_live_normalize_failures
  ON import_runs(
    json_extract(metadata_json,'$.sourceRecordId'),
    started_at DESC
  )
  WHERE source_type='official_live_normalize_auto'
    AND status='failed';
