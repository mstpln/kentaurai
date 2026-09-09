-- Official race payloads expose the advertised prize ladder in a Swedish text field,
-- for example: "Pris: 60.000-30.000-17.000 ...".
-- Keep the raw text in normalized_observations, but deterministically extract only
-- the first advertised amount when the observed format is strict and unambiguous.

CREATE VIEW IF NOT EXISTS official_race_first_prize_candidates AS
WITH prize_observations AS (
  SELECT
    o.id AS observation_id,
    o.entity_id AS race_id,
    o.observed_at,
    json_extract(o.fields_json, '$.prizeText') AS prize_text
  FROM normalized_observations o
  JOIN source_records s ON s.id = o.source_record_id
  WHERE o.entity_type = 'race'
    AND s.source_type = 'official_provider'
    AND (
      s.external_id = 'race:' || o.entity_id
      OR EXISTS (
        SELECT 1
        FROM game_legs gl
        WHERE gl.race_id = o.entity_id
          AND s.external_id = 'game:' || gl.game_round_id
      )
    )
    AND json_valid(o.fields_json)
    AND json_type(o.fields_json, '$.prizeText') = 'text'
),
amounts AS (
  SELECT
    observation_id,
    race_id,
    observed_at,
    TRIM(SUBSTR(prize_text, 7, INSTR(SUBSTR(prize_text, 7), '-') - 1)) AS amount_text
  FROM prize_observations
  WHERE prize_text GLOB 'Pris: *-*'
    AND INSTR(SUBSTR(prize_text, 7), '-') > 1
),
validated AS (
  SELECT
    observation_id,
    race_id,
    observed_at,
    amount_text,
    REPLACE(amount_text, '.', '') AS digits,
    LENGTH(amount_text) - LENGTH(REPLACE(amount_text, '.', '')) AS dot_count
  FROM amounts
  WHERE amount_text <> ''
    AND REPLACE(amount_text, '.', '') <> ''
    AND REPLACE(amount_text, '.', '') NOT GLOB '*[^0-9]*'
)
SELECT
  observation_id,
  race_id,
  observed_at,
  CAST(digits AS INTEGER) AS first_prize_sek
FROM validated
WHERE CAST(digits AS INTEGER) BETWEEN 1 AND 999999999
  AND (
    dot_count = 0
    OR (
      dot_count = 1
      AND LENGTH(amount_text) BETWEEN 5 AND 7
      AND SUBSTR(amount_text, LENGTH(amount_text) - 3, 1) = '.'
    )
    OR (
      dot_count = 2
      AND LENGTH(amount_text) BETWEEN 9 AND 11
      AND SUBSTR(amount_text, LENGTH(amount_text) - 3, 1) = '.'
      AND SUBSTR(amount_text, LENGTH(amount_text) - 7, 1) = '.'
    )
  );

-- Repair already-normalized historical/live races without refetching private raw data.
-- Existing non-null facts are deliberately preserved; conflicting source observations
-- remain available in normalized_observations instead of silently replacing them.
UPDATE races
SET first_prize_sek = (
      SELECT c.first_prize_sek
      FROM official_race_first_prize_candidates c
      WHERE c.race_id = races.id
      ORDER BY c.observed_at DESC, c.observation_id DESC
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE first_prize_sek IS NULL
  AND EXISTS (
    SELECT 1
    FROM official_race_first_prize_candidates c
    WHERE c.race_id = races.id
  );

-- Future official race observations fill a missing canonical race fact. A later
-- conflicting observation never overwrites an already stored first-prize fact.
CREATE TRIGGER IF NOT EXISTS trg_official_race_first_prize
AFTER INSERT ON normalized_observations
WHEN NEW.entity_type = 'race'
BEGIN
  UPDATE races
  SET first_prize_sek = (
        SELECT c.first_prize_sek
        FROM official_race_first_prize_candidates c
        WHERE c.observation_id = NEW.id
        LIMIT 1
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.entity_id
    AND first_prize_sek IS NULL
    AND EXISTS (
      SELECT 1
      FROM official_race_first_prize_candidates c
      WHERE c.observation_id = NEW.id
    );
END;
