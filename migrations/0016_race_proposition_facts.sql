CREATE TABLE IF NOT EXISTS race_proposition_facts (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id),
  source_observation_id TEXT NOT NULL REFERENCES normalized_observations(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  observed_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('no_terms','parsed','partial','unparsed','ambiguous')),
  raw_terms_json TEXT NOT NULL CHECK (json_valid(raw_terms_json)),
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  matched_patterns_json TEXT NOT NULL CHECK (json_valid(matched_patterns_json)),
  unparsed_fragments_json TEXT NOT NULL CHECK (json_valid(unparsed_fragments_json)),
  ambiguous_fragments_json TEXT NOT NULL CHECK (json_valid(ambiguous_fragments_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_observation_id, parser_version)
);

CREATE INDEX IF NOT EXISTS idx_race_proposition_facts_asof
  ON race_proposition_facts(race_id, parser_version, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_race_proposition_facts_source
  ON race_proposition_facts(source_record_id, parser_version);
