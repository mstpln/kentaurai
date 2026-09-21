ALTER TABLE race_positions ADD COLUMN evidence_type TEXT;
ALTER TABLE race_positions ADD COLUMN confidence REAL;
ALTER TABLE race_positions ADD COLUMN classification_version TEXT;

CREATE INDEX IF NOT EXISTS idx_race_positions_classification
  ON race_positions(classification_version, race_entry_id, observed_at_m);

CREATE INDEX IF NOT EXISTS idx_race_positions_source_classification
  ON race_positions(source_record_id, classification_version);
