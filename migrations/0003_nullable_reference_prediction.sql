ALTER TABLE ai_horse_predictions RENAME TO ai_horse_predictions_old;

CREATE TABLE ai_horse_predictions (
  id TEXT PRIMARY KEY,
  ai_race_analysis_id TEXT NOT NULL REFERENCES ai_race_analyses(id),
  race_entry_id TEXT NOT NULL REFERENCES race_entries(id),
  win_probability REAL,
  uncertainty_low REAL,
  uncertainty_high REAL,
  raw_rank INTEGER,
  abcd_group TEXT,
  value_ratio REAL,
  scenario_robustness REAL,
  reasoning_json TEXT,
  UNIQUE(ai_race_analysis_id, race_entry_id)
);

INSERT INTO ai_horse_predictions (
  id, ai_race_analysis_id, race_entry_id, win_probability,
  uncertainty_low, uncertainty_high, raw_rank, abcd_group,
  value_ratio, scenario_robustness, reasoning_json
)
SELECT
  id, ai_race_analysis_id, race_entry_id, win_probability,
  uncertainty_low, uncertainty_high, raw_rank, abcd_group,
  value_ratio, scenario_robustness, reasoning_json
FROM ai_horse_predictions_old;

DROP TABLE ai_horse_predictions_old;
