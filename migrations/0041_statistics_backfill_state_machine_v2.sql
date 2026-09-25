PRAGMA foreign_keys = ON;

-- Durable scheduler/retry state is kept separate from the metric coverage table.
-- This keeps the existing statistics_data_backfill_rounds contract stable while
-- allowing bounded retries and reconciliation after upstream facts arrive.
CREATE TABLE IF NOT EXISTS statistics_data_backfill_retry_state (
  game_round_id TEXT PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
  last_error_class TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  next_check_at TEXT,
  form_failure_fingerprint TEXT,
  final_market_failure_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO statistics_data_backfill_retry_state
  (game_round_id,next_check_at)
SELECT game_round_id,CURRENT_TIMESTAMP
FROM statistics_data_backfill_rounds
WHERE status IN ('pending','manual_review')
   OR result_status='pending'
   OR final_market_status='pending'
   OR payout_status='pending'
   OR form_status='pending';

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_retry_due
  ON statistics_data_backfill_retry_state(next_check_at, game_round_id);
