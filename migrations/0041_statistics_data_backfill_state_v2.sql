PRAGMA foreign_keys = ON;

-- Lifecycle/state-machine metadata for statistics_data_backfill.
-- Canonical racing/analysis facts remain in their existing source-of-truth tables.
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN work_state TEXT NOT NULL DEFAULT 'waiting'
  CHECK(work_state IN ('waiting','retryable','manual_review','complete','complete_with_gaps'));
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN next_check_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN last_audit_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN last_attempt_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN lease_token TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN lease_until TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN primary_system_id TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN winner_leg_count INTEGER NOT NULL DEFAULT 0 CHECK(winner_leg_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN ambiguous_winner_leg_count INTEGER NOT NULL DEFAULT 0 CHECK(ambiguous_winner_leg_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_game_source_record_id TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN audit_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(audit_retry_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN last_error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_last_attempt_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_terminal_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_terminal_reason TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(form_retry_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_next_retry_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_last_attempt_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_terminal_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_terminal_reason TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(final_market_retry_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_next_retry_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_error_class TEXT;

-- Every pre-v2 row is audited once after deployment so stale terminal rows can
-- refresh newer verified factual metrics without weakening historical AI guards.
UPDATE statistics_data_backfill_rounds
SET next_check_at=CURRENT_TIMESTAMP,
    work_state=CASE
      WHEN status='manual_review' THEN 'manual_review'
      WHEN status='complete' THEN 'complete'
      WHEN status='complete_with_gaps' THEN 'complete_with_gaps'
      WHEN lower(COALESCE(last_error,'')) LIKE '%form_replay:%' THEN 'retryable'
      ELSE 'waiting'
    END,
    form_retry_count=0,
    form_error_class=CASE
      WHEN form_status='pending' AND lower(COALESCE(last_error,'')) LIKE '%form_replay:%'
        THEN 'legacy_form_replay_error'
      ELSE NULL
    END,
    last_error_class=CASE
      WHEN lower(COALESCE(last_error,'')) LIKE '%step1_replay_fingerprint_mismatch%' THEN 'step1_replay_fingerprint_mismatch'
      WHEN lower(COALESCE(last_error,'')) LIKE '%closing_market_manual_review%' THEN 'closing_market_manual_review'
      WHEN lower(COALESCE(last_error,'')) LIKE '%closing_market_repair%' THEN 'closing_market_repair'
      WHEN lower(COALESCE(last_error,'')) LIKE '%form_replay%' THEN 'form_replay'
      ELSE NULL
    END;

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_due_v2
  ON statistics_data_backfill_rounds(next_check_at, lease_until, last_checked_at, game_round_id);

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_work_state_v2
  ON statistics_data_backfill_rounds(work_state, next_check_at, game_round_id);
