-- Preserve datetime(started_at) semantics for historical mixed timestamp formats.
-- Scan newest-first rather than sorting the entire import_runs table for
-- Settings fallback source-family queries. Do not add a (source_type, datetime)
-- index: it displaces the dedicated sourceRecordId index in automatic retry
-- lookups and causes a serious performance regression.
CREATE INDEX IF NOT EXISTS idx_import_runs_settings_family_datetime
  ON import_runs(datetime(started_at) DESC, id DESC);
