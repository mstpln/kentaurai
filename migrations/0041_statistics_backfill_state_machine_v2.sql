PRAGMA foreign_keys = ON;

-- Make statistics backfill retries bounded and resumable while allowing stale
-- pending sub-metrics to reconcile after upstream settlement facts arrive.
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN last_error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0);

ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN next_check_at TEXT;

ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN form_failure_fingerprint TEXT;

ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN final_market_failure_fingerprint TEXT;

-- Existing non-terminal or stale mixed-state rows should receive one
-- reconciliation pass after deploy. Fully terminal rows stay idle.
UPDATE statistics_data_backfill_rounds
SET next_check_at=CURRENT_TIMESTAMP
WHERE status='pending'
   OR result_status='pending'
   OR final_market_status='pending'
   OR payout_status='pending'
   OR form_status='pending';

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_due
  ON statistics_data_backfill_rounds(next_check_at, status, last_checked_at, game_round_id);
