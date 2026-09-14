CREATE TABLE IF NOT EXISTS race_proposition_facts (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  source_observation_id TEXT NOT NULL REFERENCES normalized_observations(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  observed_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  raw_terms_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  matched_patterns_json TEXT NOT NULL,
  unparsed_fragments_json TEXT NOT NULL,
  ambiguous_fragments_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_observation_id, parser_version)
);

CREATE INDEX IF NOT EXISTS idx_race_proposition_facts_asof
  ON race_proposition_facts(race_id, parser_version, observed_at DESC, id DESC);
