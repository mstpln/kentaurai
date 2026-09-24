PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_entry_judgment_snapshots (
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  leg_number INTEGER NOT NULL CHECK (leg_number BETWEEN 1 AND 8),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id) ON DELETE CASCADE,
  raw_rank INTEGER CHECK (raw_rank IS NULL OR raw_rank >= 1),
  abcd_group TEXT CHECK (abcd_group IS NULL OR abcd_group IN ('A','B','C','D')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('ai_prediction','sealed_step1')),
  source_id TEXT NOT NULL,
  as_of TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(system_id, race_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_system_judgment_round
  ON system_entry_judgment_snapshots(game_round_id, system_id, leg_number, raw_rank);

CREATE TABLE IF NOT EXISTS game_statistics_backfill_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  cursor_round_date TEXT,
  cursor_round_id TEXT,
  total_rounds INTEGER NOT NULL DEFAULT 0 CHECK(total_rounds >= 0),
  processed_rounds INTEGER NOT NULL DEFAULT 0 CHECK(processed_rounds >= 0),
  form_backfilled_rounds INTEGER NOT NULL DEFAULT 0 CHECK(form_backfilled_rounds >= 0),
  form_rows_inserted INTEGER NOT NULL DEFAULT 0 CHECK(form_rows_inserted >= 0),
  judgment_rows_inserted INTEGER NOT NULL DEFAULT 0 CHECK(judgment_rows_inserted >= 0),
  complete_rounds INTEGER NOT NULL DEFAULT 0 CHECK(complete_rounds >= 0),
  unresolved_rounds INTEGER NOT NULL DEFAULT 0 CHECK(unresolved_rounds >= 0),
  consecutive_errors INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_errors >= 0),
  last_error TEXT,
  lease_token TEXT,
  lease_until TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_statistics_backfill_jobs_status
  ON game_statistics_backfill_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS game_statistics_backfill_rounds (
  job_id TEXT NOT NULL REFERENCES game_statistics_backfill_jobs(id) ON DELETE CASCADE,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  primary_system_id TEXT REFERENCES systems(id) ON DELETE SET NULL,
  lineage_type TEXT,
  lineage_source_id TEXT,
  expected_pack_id TEXT,
  expected_pack_as_of TEXT,
  expected_facts_fingerprint TEXT,
  actual_pack_id TEXT,
  actual_facts_fingerprint TEXT,
  results_status TEXT NOT NULL,
  final_result_status TEXT NOT NULL,
  closing_market_status TEXT NOT NULL,
  payout_status TEXT NOT NULL,
  system_status TEXT NOT NULL,
  form_status TEXT NOT NULL,
  judgment_status TEXT NOT NULL,
  active_entries INTEGER NOT NULL DEFAULT 0 CHECK(active_entries >= 0),
  closing_market_entries INTEGER NOT NULL DEFAULT 0 CHECK(closing_market_entries >= 0),
  form_snapshot_entries INTEGER NOT NULL DEFAULT 0 CHECK(form_snapshot_entries >= 0),
  form_score_entries INTEGER NOT NULL DEFAULT 0 CHECK(form_score_entries >= 0),
  judgment_entries INTEGER NOT NULL DEFAULT 0 CHECK(judgment_entries >= 0),
  inserted_form_rows INTEGER NOT NULL DEFAULT 0 CHECK(inserted_form_rows >= 0),
  inserted_judgment_rows INTEGER NOT NULL DEFAULT 0 CHECK(inserted_judgment_rows >= 0),
  missing_metrics_json TEXT NOT NULL CHECK(json_valid(missing_metrics_json)),
  error_message TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY(job_id, game_round_id)
);

CREATE INDEX IF NOT EXISTS idx_game_statistics_backfill_rounds_round
  ON game_statistics_backfill_rounds(game_round_id, checked_at DESC);
