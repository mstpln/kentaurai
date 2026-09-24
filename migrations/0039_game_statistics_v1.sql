-- Game statistics, frozen form snapshots, and final official result provenance.

CREATE TABLE IF NOT EXISTS analysis_entry_form_snapshots (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  step1_pack_id TEXT NOT NULL,
  leg_number INTEGER NOT NULL CHECK (leg_number BETWEEN 1 AND 8),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  form_version TEXT NOT NULL,
  form_score INTEGER CHECK (form_score IS NULL OR form_score BETWEEN 1 AND 100),
  used_starts INTEGER NOT NULL DEFAULT 0 CHECK (used_starts >= 0),
  form_rank INTEGER CHECK (form_rank IS NULL OR form_rank >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(step1_pack_id, race_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_form_snapshot_round
  ON analysis_entry_form_snapshots(game_round_id, step1_pack_id, leg_number, form_rank);

CREATE INDEX IF NOT EXISTS idx_analysis_form_snapshot_entry
  ON analysis_entry_form_snapshots(race_entry_id, step1_pack_id);

CREATE TABLE IF NOT EXISTS game_round_final_results (
  game_round_id TEXT PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('V85','V86')),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL,
  turnover_raw INTEGER,
  turnover_sek REAL,
  system_count INTEGER,
  payouts_json TEXT NOT NULL CHECK (json_valid(payouts_json)),
  highest_payout_level INTEGER,
  highest_payout_raw INTEGER,
  highest_payout_sek REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_round_final_results_source
  ON game_round_final_results(source_record_id);

CREATE INDEX IF NOT EXISTS idx_game_round_final_results_payout
  ON game_round_final_results(highest_payout_sek, game_type);
