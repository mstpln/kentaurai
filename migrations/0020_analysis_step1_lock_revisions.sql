PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_step1_lock_revision_bases (
  lock_id TEXT PRIMARY KEY REFERENCES analysis_step1_locks(id),
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  basis_version TEXT NOT NULL CHECK(basis_version = 'step1-revision-basis-v1-d3'),
  pack_id TEXT NOT NULL,
  pack_as_of TEXT NOT NULL,
  facts_fingerprint TEXT NOT NULL,
  round_material_hash TEXT NOT NULL,
  leg_material_hashes_json TEXT NOT NULL,
  volatile_facts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_step1_lock_revision_bases_round
  ON analysis_step1_lock_revision_bases(game_round_id, created_at DESC, lock_id DESC);

CREATE TABLE IF NOT EXISTS analysis_step1_lock_revisions (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  parent_lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  child_lock_id TEXT NOT NULL REFERENCES analysis_step1_locks(id),
  parent_lock_hash TEXT NOT NULL,
  child_lock_hash TEXT NOT NULL,
  parent_facts_fingerprint TEXT NOT NULL,
  child_facts_fingerprint TEXT NOT NULL,
  revision_scope TEXT NOT NULL CHECK(revision_scope IN ('affected_legs','full_round')),
  affected_legs_json TEXT NOT NULL,
  revision_pack_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  revision_json TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(parent_lock_id),
  UNIQUE(child_lock_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_step1_lock_revisions_round_created
  ON analysis_step1_lock_revisions(game_round_id, created_at DESC, id DESC);
