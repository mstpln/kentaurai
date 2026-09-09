CREATE TABLE IF NOT EXISTS xlabs_backfill_jobs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'historical_all' CHECK(scope IN ('historical_all', 'daily_v85_v86')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  next_date TEXT NOT NULL,
  next_race_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
  processed_dates INTEGER NOT NULL DEFAULT 0,
  processed_races INTEGER NOT NULL DEFAULT 0,
  reused_races INTEGER NOT NULL DEFAULT 0,
  unavailable_dates INTEGER NOT NULL DEFAULT 0,
  unavailable_races INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_run_at TEXT,
  retry_after TEXT,
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_xlabs_backfill_status
  ON xlabs_backfill_jobs(status, scope, retry_after, created_at);
