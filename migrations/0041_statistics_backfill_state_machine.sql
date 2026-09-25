PRAGMA foreign_keys = ON;

-- Durable state-machine metadata for statistics_data_backfill.
-- Canonical racing/analysis facts remain in their existing tables.
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN action_state TEXT NOT NULL DEFAULT 'waiting'
  CHECK(action_state IN ('waiting','retryable','manual_review','complete','complete_with_gaps'));
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 0 CHECK(input_revision >= 0);
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN audited_revision INTEGER NOT NULL DEFAULT -1 CHECK(audited_revision >= -1);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN last_audit_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN last_attempt_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN next_retry_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_attempt_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_terminal_reason TEXT;
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN form_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(form_retry_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_next_retry_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN form_error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_input_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_attempt_fingerprint TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_terminal_reason TEXT;
ALTER TABLE statistics_data_backfill_rounds
  ADD COLUMN final_market_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(final_market_retry_count >= 0);
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_next_retry_at TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN final_market_error_class TEXT;

ALTER TABLE statistics_data_backfill_rounds ADD COLUMN lease_token TEXT;
ALTER TABLE statistics_data_backfill_rounds ADD COLUMN lease_until TEXT;

CREATE INDEX IF NOT EXISTS idx_statistics_backfill_action
  ON statistics_data_backfill_rounds(action_state, next_retry_at, last_audit_at, game_round_id);
CREATE INDEX IF NOT EXISTS idx_statistics_backfill_revision
  ON statistics_data_backfill_rounds(input_revision, audited_revision, game_round_id);
CREATE INDEX IF NOT EXISTS idx_statistics_backfill_lease
  ON statistics_data_backfill_rounds(lease_until, game_round_id);

-- Existing rows are deliberately made actionable once. The first v2 audit
-- reconciles old cached statuses with current canonical facts without resetting history.
UPDATE statistics_data_backfill_rounds
SET audited_revision = -1,
    action_state = CASE
      WHEN status='complete' THEN 'complete'
      WHEN status='complete_with_gaps' THEN 'complete_with_gaps'
      WHEN status='manual_review' THEN 'manual_review'
      ELSE 'waiting'
    END;

-- Input revisions are raised by canonical upstream writes. This makes terminal
-- rows re-auditable when facts change while leaving unchanged rows idle.
CREATE TRIGGER IF NOT EXISTS trg_stats_rev_final_result_insert
AFTER INSERT ON game_round_final_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_final_result_update
AFTER UPDATE ON game_round_final_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_final_result_delete
AFTER DELETE ON game_round_final_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=OLD.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_betting_insert
AFTER INSERT ON betting_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_betting_update
AFTER UPDATE ON betting_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_betting_delete
AFTER DELETE ON betting_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=OLD.game_round_id;
END;

-- Result changes affect both the round containing the race and any queued round
-- containing the same horse because historical Form is horse-history based.
CREATE TRIGGER IF NOT EXISTS trg_stats_rev_result_insert
AFTER INSERT ON race_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries changed
    JOIN race_entries target ON target.horse_id=changed.horse_id
    JOIN game_legs gl ON gl.race_id=target.race_id
    WHERE changed.id=NEW.race_entry_id AND changed.horse_id IS NOT NULL
    UNION
    SELECT gl.game_round_id
    FROM race_entries changed
    JOIN game_legs gl ON gl.race_id=changed.race_id
    WHERE changed.id=NEW.race_entry_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_result_update
AFTER UPDATE ON race_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries changed
    JOIN race_entries target ON target.horse_id=changed.horse_id
    JOIN game_legs gl ON gl.race_id=target.race_id
    WHERE changed.id IN (OLD.race_entry_id,NEW.race_entry_id) AND changed.horse_id IS NOT NULL
    UNION
    SELECT gl.game_round_id
    FROM race_entries changed
    JOIN game_legs gl ON gl.race_id=changed.race_id
    WHERE changed.id IN (OLD.race_entry_id,NEW.race_entry_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_result_delete
AFTER DELETE ON race_results
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries changed
    JOIN race_entries target ON target.horse_id=changed.horse_id
    JOIN game_legs gl ON gl.race_id=target.race_id
    WHERE changed.id=OLD.race_entry_id AND changed.horse_id IS NOT NULL
    UNION
    SELECT gl.game_round_id
    FROM race_entries changed
    JOIN game_legs gl ON gl.race_id=changed.race_id
    WHERE changed.id=OLD.race_entry_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_game_leg_insert
AFTER INSERT ON game_legs
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_game_leg_update
AFTER UPDATE ON game_legs
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_game_leg_delete
AFTER DELETE ON game_legs
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=OLD.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_entry_insert
AFTER INSERT ON race_entries
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (SELECT game_round_id FROM game_legs WHERE race_id=NEW.race_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_entry_update
AFTER UPDATE ON race_entries
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT game_round_id FROM game_legs WHERE race_id IN (OLD.race_id,NEW.race_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_entry_delete
AFTER DELETE ON race_entries
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (SELECT game_round_id FROM game_legs WHERE race_id=OLD.race_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_system_insert
AFTER INSERT ON systems
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_system_update
AFTER UPDATE ON systems
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_selection_insert
AFTER INSERT ON system_selections
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=(SELECT game_round_id FROM systems WHERE id=NEW.system_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_selection_update
AFTER UPDATE ON system_selections
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT game_round_id FROM systems WHERE id IN (OLD.system_id,NEW.system_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_selection_delete
AFTER DELETE ON system_selections
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=(SELECT game_round_id FROM systems WHERE id=OLD.system_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_external_run_insert
AFTER INSERT ON analysis_external_runs
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_external_run_update
AFTER UPDATE ON analysis_external_runs
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_external_export_insert
AFTER INSERT ON analysis_external_exports
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_external_export_update
AFTER UPDATE ON analysis_external_exports
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_ai_analysis_insert
AFTER INSERT ON ai_race_analyses
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (SELECT game_round_id FROM game_legs WHERE race_id=NEW.race_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_ai_analysis_update
AFTER UPDATE ON ai_race_analyses
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT game_round_id FROM game_legs WHERE race_id IN (OLD.race_id,NEW.race_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_ai_prediction_insert
AFTER INSERT ON ai_horse_predictions
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT gl.game_round_id
    FROM ai_race_analyses ara
    JOIN game_legs gl ON gl.race_id=ara.race_id
    WHERE ara.id=NEW.ai_race_analysis_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_ai_prediction_update
AFTER UPDATE ON ai_horse_predictions
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT gl.game_round_id
    FROM ai_race_analyses ara
    JOIN game_legs gl ON gl.race_id=ara.race_id
    WHERE ara.id IN (OLD.ai_race_analysis_id,NEW.ai_race_analysis_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_form_snapshot_insert
AFTER INSERT ON analysis_entry_form_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=NEW.game_round_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_form_snapshot_update
AFTER UPDATE ON analysis_entry_form_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (OLD.game_round_id,NEW.game_round_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_form_snapshot_delete
AFTER DELETE ON analysis_entry_form_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id=OLD.game_round_id;
END;

-- X-Labs and historical opponent facts can change a safe legacy Form replay.
CREATE TRIGGER IF NOT EXISTS trg_stats_rev_xlabs_insert
AFTER INSERT ON xlabs_data
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries changed
    JOIN race_entries target ON target.horse_id=changed.horse_id
    JOIN game_legs gl ON gl.race_id=target.race_id
    WHERE changed.id=NEW.race_entry_id AND changed.horse_id IS NOT NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_xlabs_update
AFTER UPDATE ON xlabs_data
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries changed
    JOIN race_entries target ON target.horse_id=changed.horse_id
    JOIN game_legs gl ON gl.race_id=target.race_id
    WHERE changed.id IN (OLD.race_entry_id,NEW.race_entry_id) AND changed.horse_id IS NOT NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_horse_snapshot_insert
AFTER INSERT ON horse_stat_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries re
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE re.horse_id=NEW.horse_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_horse_snapshot_update
AFTER UPDATE ON horse_stat_snapshots
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM race_entries re
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE re.horse_id IN (OLD.horse_id,NEW.horse_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_snapshot_sync_insert
AFTER INSERT ON official_snapshot_source_sync
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM horse_stat_snapshots hss
    JOIN race_entries re ON re.horse_id=hss.horse_id
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE hss.source_record_id=NEW.source_record_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_snapshot_sync_update
AFTER UPDATE ON official_snapshot_source_sync
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT DISTINCT gl.game_round_id
    FROM horse_stat_snapshots hss
    JOIN race_entries re ON re.horse_id=hss.horse_id
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE hss.source_record_id IN (OLD.source_record_id,NEW.source_record_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_stats_rev_source_update
AFTER UPDATE OF raw_object_key,quality_status,fetched_at ON source_records
BEGIN
  UPDATE statistics_data_backfill_rounds
  SET input_revision=input_revision+1
  WHERE game_round_id IN (
    SELECT game_round_id FROM game_round_final_results
    WHERE source_record_id IN (OLD.id,NEW.id)
  );
END;
