PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_step1_locks (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-step1-lock-v1'),
  pack_id TEXT NOT NULL,
  pack_as_of TEXT NOT NULL,
  facts_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  lock_json TEXT NOT NULL,
  lock_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_step1_locks_round_created
  ON analysis_step1_locks(game_round_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_step1_locks_pack
  ON analysis_step1_locks(pack_id, facts_fingerprint);