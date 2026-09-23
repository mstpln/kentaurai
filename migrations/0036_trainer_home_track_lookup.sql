PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_normalized_trainer_home_track_external
  ON normalized_observations(
    CAST(json_extract(fields_json, '$.homeTrackExternalId') AS TEXT),
    entity_id,
    observed_at DESC
  )
  WHERE entity_type = 'trainer' AND json_valid(fields_json);
