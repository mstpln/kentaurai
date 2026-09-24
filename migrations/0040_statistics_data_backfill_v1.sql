PRAGMA foreign_keys = ON;

-- Durable coverage/backfill state for Spel outcome statistics.
-- This table stores only operational status; racing facts remain in their canonical tables.
CREATE TABLE IF NOT EXISTS statistics_data_backfill_rounds (
  game_round_id TEXT PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','complete_with_gaps','manual_review')),
  result_status TEXT NOT NULL CHECK(result_status IN ('pending','complete','unavailable')),
  final_market_status TEXT NOT NULL CHECK(final_market_status IN ('pending','complete','unavailable','manual_review')),
  payout_status TEXT NOT NULL CHECK(payout_status IN ('pending','complete','unavailable')),
  form_status TEXT NOT NULL CHECK(form_status IN ('pending','complete','unavailable','manual_review')),
  kai_rank_status TEXT NOT NULL CHECK(kai_rank_status IN ('complete','unavailable')),
  abcd_status TEXT NOT NULL CHECK(abcd_status IN ('complete','unavailable')),
  spike_status TEXT NOT NULL CHECK(spike_status IN ('complete','unavailable')),
  active_entry_count INTEGER NOT NULL DEFAULT 0 CHECK(active_entry_count >= 0),
  closing_market_count INTEGER NOT NULL DEFAULT 0 CHECK(closing_market_count >= 0),
  form_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK(form_snapshot_count >= 0),
  kai_rank_count INTEGER NOT NULL DEFAULT 0 CHECK(kai_rank_count >= 0),
  abcd_count INTEGER NOT NULL DEFAULT 0 CHECK(abcd_count >= 0),
  spike_count INTEGER NOT NULL DEFAULT 0 CHECK(spike_count >= 0),
  form_lineage_kind TEXT CHECK(form_lineage_kind IS NULL OR form_lineage_kind IN ('step1_pack','legacy_analysis_snapshot')),
  form_snapshot_ref TEXT,
  form_as_of_json TEXT CHECK(form_as_of_json IS NULL OR json_valid(form_as_of_json)),
  step1_pack_id TEXT,
  step1_facts_fingerprint TEXT,
  step1_as_of TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error TEXT,
  last_checked_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_status
  ON statistics_data_backfill_rounds(status, last_checked_at, game_round_id);

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_form
  ON statistics_data_backfill_rounds(form_status, status, game_round_id);
