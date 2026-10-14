-- Preserve existing datetime(started_at) semantics for historical mixed timestamp formats.
-- Exact source lookups should search the source partition in timestamp order.
CREATE INDEX IF NOT EXISTS idx_import_runs_settings_exact_source_datetime
  ON import_runs(source_type, datetime(started_at) DESC, id DESC);

-- Family filters such as lower(source_type) LIKE '%official%' cannot seek by
-- source type. Traverse newest-first instead of sorting all import_runs rows.
CREATE INDEX IF NOT EXISTS idx_import_runs_settings_family_datetime
  ON import_runs(datetime(started_at) DESC, id DESC);
