ALTER TABLE horses ADD COLUMN career_earnings_sek INTEGER;
ALTER TABLE horses ADD COLUMN record_text TEXT;

ALTER TABLE races ADD COLUMN starters_declared INTEGER;
ALTER TABLE game_rounds ADD COLUMN currency TEXT NOT NULL DEFAULT 'SEK';

ALTER TABLE systems ADD COLUMN metrics_json TEXT;
ALTER TABLE systems ADD COLUMN notes TEXT;

ALTER TABLE editorial_items ADD COLUMN race_id TEXT REFERENCES races(id);
ALTER TABLE editorial_items ADD COLUMN game_round_id TEXT REFERENCES game_rounds(id);

ALTER TABLE ai_race_analyses ADD COLUMN analysis_origin TEXT NOT NULL DEFAULT 'kentaurai';
ALTER TABLE ai_race_analyses ADD COLUMN method_note TEXT;

CREATE TABLE IF NOT EXISTS reference_round_exports (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  export_version TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  race_count INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  source_manifest_json TEXT,
  analysis_snapshot_json TEXT,
  known_gaps_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_round_id, export_version, captured_at)
);

CREATE TABLE IF NOT EXISTS reference_observations (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  current_race_entry_id TEXT REFERENCES race_entries(id),
  observation_type TEXT NOT NULL,
  observed_at TEXT,
  payload_json TEXT NOT NULL,
  source_refs_json TEXT,
  quality_status TEXT NOT NULL DEFAULT 'reference_only',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reference_observations_round
  ON reference_observations(game_round_id, observation_type);
CREATE INDEX IF NOT EXISTS idx_reference_observations_entry
  ON reference_observations(current_race_entry_id, observation_type);
