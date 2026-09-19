PRAGMA foreign_keys = ON;

ALTER TABLE editorial_items ADD COLUMN trainer_id TEXT REFERENCES trainers(id);

CREATE INDEX IF NOT EXISTS idx_editorial_items_horse_published
  ON editorial_items(horse_id, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_editorial_items_trainer_published
  ON editorial_items(trainer_id, published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS external_horse_stat_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  game_round_id TEXT REFERENCES game_rounds(id),
  context_type TEXT NOT NULL CHECK(context_type IN (
    'all_starts','current_track','season','v85','v86','lead','balance','wagon'
  )),
  context_key TEXT,
  context_label TEXT NOT NULL,
  starts INTEGER CHECK(starts IS NULL OR starts >= 0),
  wins INTEGER CHECK(wins IS NULL OR wins >= 0),
  seconds INTEGER CHECK(seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK(thirds IS NULL OR thirds >= 0),
  win_rate_percent REAL CHECK(win_rate_percent IS NULL OR (win_rate_percent >= 0 AND win_rate_percent <= 100)),
  roi_percent REAL,
  observed_at TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_record_id, horse_id, race_entry_id, context_type, context_key)
);

CREATE INDEX IF NOT EXISTS idx_external_horse_stats_horse_context_time
  ON external_horse_stat_snapshots(horse_id, context_type, context_key, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_external_horse_stats_round
  ON external_horse_stat_snapshots(game_round_id, horse_id, observed_at DESC);
