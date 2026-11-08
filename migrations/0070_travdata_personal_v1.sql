PRAGMA foreign_keys = ON;

-- TravData-only personal content; do not reuse legacy AI analysis/system tables.
-- A local browser copy is retained until the server confirms migration.
CREATE TABLE IF NOT EXISTS travdata_horse_notes (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  note_text TEXT NOT NULL CHECK(length(note_text) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_travdata_notes_horse
  ON travdata_horse_notes(horse_id, deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS travdata_manual_systems (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  game_type TEXT NOT NULL CHECK(game_type IN ('V85','V86')),
  system_name TEXT NOT NULL,
  selections_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count > 0),
  stake_sek REAL NOT NULL CHECK(stake_sek >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  settlement_state TEXT NOT NULL DEFAULT 'pending'
    CHECK(settlement_state IN ('pending','settled','manual_review')),
  next_check_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payout_sek REAL,
  net_sek REAL,
  correct_legs INTEGER,
  winner_numbers_json TEXT,
  settled_at TEXT,
  review_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_travdata_manual_systems_round
  ON travdata_manual_systems(game_round_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_travdata_manual_systems_unsettled
  ON travdata_manual_systems(settlement_state, created_at)
  WHERE deleted_at IS NULL AND settlement_state = 'pending';

-- Tombstones prevent an old offline device from resurrecting deletions.
CREATE TABLE IF NOT EXISTS travdata_personal_tombstones (
  kind TEXT NOT NULL CHECK(kind IN ('note','system')),
  id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY(kind,id)
);
