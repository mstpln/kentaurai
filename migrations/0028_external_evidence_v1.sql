PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS external_horse_stat_snapshots (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  game_round_id TEXT REFERENCES game_rounds(id),
  context_type TEXT NOT NULL CHECK(context_type IN (
    'all_starts','current_track','season','v85','v86','lead','current_balance','current_wagon'
  )),
  context_key TEXT NOT NULL DEFAULT '',
  context_label TEXT,
  track_id TEXT REFERENCES tracks(id),
  context_json TEXT,
  starts INTEGER NOT NULL CHECK(starts >= 0),
  wins INTEGER CHECK(wins IS NULL OR wins >= 0),
  seconds INTEGER CHECK(seconds IS NULL OR seconds >= 0),
  thirds INTEGER CHECK(thirds IS NULL OR thirds >= 0),
  win_percent REAL CHECK(win_percent IS NULL OR (win_percent >= 0 AND win_percent <= 100)),
  roi_percent REAL CHECK(roi_percent IS NULL OR roi_percent >= 0),
  observed_at TEXT,
  available_at TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_record_id, horse_id, race_entry_id, context_type, context_key)
);

CREATE INDEX IF NOT EXISTS idx_external_horse_stats_horse_context
  ON external_horse_stat_snapshots(horse_id, context_type, context_key, available_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_external_horse_stats_round
  ON external_horse_stat_snapshots(game_round_id, race_entry_id, available_at DESC);

CREATE TABLE IF NOT EXISTS external_interviews (
  id TEXT PRIMARY KEY,
  horse_id TEXT NOT NULL REFERENCES horses(id),
  trainer_id TEXT REFERENCES trainers(id),
  race_entry_id TEXT REFERENCES race_entries(id),
  game_round_id TEXT REFERENCES game_rounds(id),
  speaker_name TEXT NOT NULL,
  speaker_role TEXT,
  speaker_relation TEXT,
  published_at TEXT,
  available_at TEXT NOT NULL,
  interview_text TEXT NOT NULL,
  summary_text TEXT,
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_record_id, race_entry_id, speaker_name, published_at)
);

CREATE INDEX IF NOT EXISTS idx_external_interviews_horse
  ON external_interviews(horse_id, COALESCE(published_at, available_at) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_external_interviews_trainer
  ON external_interviews(trainer_id, COALESCE(published_at, available_at) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_external_interviews_round
  ON external_interviews(game_round_id, race_entry_id, available_at DESC);

CREATE TABLE IF NOT EXISTS external_interview_signals (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES external_interviews(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  value_text TEXT,
  polarity TEXT,
  signal_class TEXT NOT NULL CHECK(signal_class IN ('fact','intention','soft_signal','opinion','mixed')),
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_external_interview_signals_interview
  ON external_interview_signals(interview_id, id);
