PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS post_race_settlement_jobs (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL UNIQUE REFERENCES game_rounds(id),
  status TEXT NOT NULL CHECK(status IN ('pending','waiting','completed','manual_review')),
  settled_legs INTEGER NOT NULL DEFAULT 0 CHECK(settled_legs BETWEEN 0 AND 8),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_check_at TEXT,
  last_error TEXT,
  lease_token TEXT,
  lease_until TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_race_settlement_due
  ON post_race_settlement_jobs(status, next_check_at, lease_until, created_at);
