PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_step1_lock_revisions (
  child_lock_id TEXT PRIMARY KEY REFERENCES analysis_step1_locks(id),
  parent_lock_id TEXT NOT NULL UNIQUE REFERENCES analysis_step1_locks(id),
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  contract_version TEXT NOT NULL CHECK(contract_version = 'kentaurai-step1-revision-v1'),
  parent_facts_fingerprint TEXT NOT NULL,
  child_facts_fingerprint TEXT NOT NULL,
  affected_legs_json TEXT NOT NULL,
  revision_json TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(child_lock_id <> parent_lock_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_step1_lock_revisions_parent
  ON analysis_step1_lock_revisions(parent_lock_id);
CREATE INDEX IF NOT EXISTS idx_analysis_step1_lock_revisions_round_created
  ON analysis_step1_lock_revisions(game_round_id, created_at DESC, child_lock_id DESC);