PRAGMA foreign_keys = ON;

-- Materialize the expensive append-oriented evidence families used by the
-- canonical high-prize race scope. Mutable race-local facts (first prize and
-- race/class text) remain evaluated directly from races so corrections are
-- reflected immediately.
CREATE TABLE IF NOT EXISTS race_scope_evidence (
  race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (race_id, evidence_kind)
);

CREATE INDEX IF NOT EXISTS idx_race_scope_evidence_race
  ON race_scope_evidence(race_id);

INSERT OR IGNORE INTO race_scope_evidence(race_id, evidence_kind)
SELECT race_id, 'stl_classification'
FROM race_stl_classifications;

INSERT OR IGNORE INTO race_scope_evidence(race_id, evidence_kind)
SELECT DISTINCT gl.race_id, 'game'
FROM game_legs gl
JOIN game_rounds gr ON gr.id = gl.game_round_id
WHERE UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86');

INSERT OR IGNORE INTO race_scope_evidence(race_id, evidence_kind)
SELECT DISTINCT no.entity_id, 'official_observation'
FROM normalized_observations no
JOIN source_records sr ON sr.id = no.source_record_id
WHERE no.entity_type = 'race'
  AND sr.source_type = 'official_provider'
  AND (
    (INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(no.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' STL ') > 0 OR INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(no.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' SVENSKA TRAVLIGAN ') > 0 OR INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(no.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' SVENSKA TRAVLIGANS ') > 0)
    OR (
      json_valid(no.fields_json)
      AND json_type(no.fields_json, '$.gameTypes') = 'array'
      AND EXISTS (
        SELECT 1 FROM json_each(no.fields_json, '$.gameTypes') gt
        WHERE UPPER(TRIM(CAST(gt.value AS TEXT))) IN ('V75', 'V85', 'V86')
      )
    )
  );

CREATE TRIGGER IF NOT EXISTS trg_race_scope_stl_insert
AFTER INSERT ON race_stl_classifications
BEGIN
  INSERT INTO race_scope_evidence(race_id, evidence_kind)
  SELECT NEW.race_id, 'stl_classification'
  WHERE NOT EXISTS (
    SELECT 1 FROM race_scope_evidence
    WHERE race_id = NEW.race_id AND evidence_kind = 'stl_classification'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_stl_delete
AFTER DELETE ON race_stl_classifications
BEGIN
  DELETE FROM race_scope_evidence
  WHERE race_id = OLD.race_id
    AND evidence_kind = 'stl_classification'
    AND NOT EXISTS (
      SELECT 1 FROM race_stl_classifications rsc WHERE rsc.race_id = OLD.race_id
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_game_leg_insert
AFTER INSERT ON game_legs
WHEN EXISTS (
  SELECT 1 FROM game_rounds gr
  WHERE gr.id = NEW.game_round_id
    AND UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86')
)
BEGIN
  INSERT INTO race_scope_evidence(race_id, evidence_kind)
  SELECT NEW.race_id, 'game'
  WHERE NOT EXISTS (
    SELECT 1 FROM race_scope_evidence
    WHERE race_id = NEW.race_id AND evidence_kind = 'game'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_game_leg_delete
AFTER DELETE ON game_legs
BEGIN
  DELETE FROM race_scope_evidence
  WHERE race_id = OLD.race_id
    AND evidence_kind = 'game'
    AND NOT EXISTS (
      SELECT 1
      FROM game_legs gl
      JOIN game_rounds gr ON gr.id = gl.game_round_id
      WHERE gl.race_id = OLD.race_id
        AND UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86')
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_game_leg_update
AFTER UPDATE OF race_id, game_round_id ON game_legs
BEGIN
  DELETE FROM race_scope_evidence
  WHERE race_id = OLD.race_id
    AND evidence_kind = 'game'
    AND NOT EXISTS (
      SELECT 1
      FROM game_legs gl
      JOIN game_rounds gr ON gr.id = gl.game_round_id
      WHERE gl.race_id = OLD.race_id
        AND UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86')
    );

  INSERT INTO race_scope_evidence(race_id, evidence_kind)
  SELECT NEW.race_id, 'game'
  WHERE EXISTS (
    SELECT 1 FROM game_rounds gr
    WHERE gr.id = NEW.game_round_id
      AND UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86')
  )
  AND NOT EXISTS (
    SELECT 1 FROM race_scope_evidence
    WHERE race_id = NEW.race_id AND evidence_kind = 'game'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_game_round_update
AFTER UPDATE OF game_type ON game_rounds
BEGIN
  DELETE FROM race_scope_evidence
  WHERE evidence_kind = 'game'
    AND race_id IN (SELECT race_id FROM game_legs WHERE game_round_id = NEW.id)
    AND NOT EXISTS (
      SELECT 1
      FROM game_legs gl
      JOIN game_rounds gr ON gr.id = gl.game_round_id
      WHERE gl.race_id = race_scope_evidence.race_id
        AND UPPER(TRIM(gr.game_type)) IN ('V75', 'V85', 'V86')
    );
  INSERT INTO race_scope_evidence(race_id, evidence_kind)
  SELECT DISTINCT gl_new.race_id, 'game'
  FROM game_legs gl_new
  WHERE gl_new.game_round_id = NEW.id
    AND UPPER(TRIM(NEW.game_type)) IN ('V75', 'V85', 'V86')
    AND NOT EXISTS (
      SELECT 1 FROM race_scope_evidence rse_new
      WHERE rse_new.race_id = gl_new.race_id AND rse_new.evidence_kind = 'game'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_race_scope_observation_insert
AFTER INSERT ON normalized_observations
WHEN NEW.entity_type = 'race'
  AND EXISTS (
    SELECT 1 FROM source_records sr
    WHERE sr.id = NEW.source_record_id AND sr.source_type = 'official_provider'
  )
BEGIN
  INSERT INTO race_scope_evidence(race_id, evidence_kind)
  SELECT NEW.entity_id, 'official_observation'
  WHERE NOT EXISTS (
    SELECT 1 FROM race_scope_evidence
    WHERE race_id = NEW.entity_id AND evidence_kind = 'official_observation'
  )
  AND (
    (INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(NEW.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' STL ') > 0 OR INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(NEW.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' SVENSKA TRAVLIGAN ') > 0 OR INSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(' ' || COALESCE(NEW.fields_json, '') || ' '), '-', ' '), '/', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '"', ' '), ',', ' '), '.', ' '), ':', ' '), ';', ' '), '|', ' '), '_', ' '), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), ' SVENSKA TRAVLIGANS ') > 0)
    OR (
      json_valid(NEW.fields_json)
      AND json_type(NEW.fields_json, '$.gameTypes') = 'array'
      AND EXISTS (
        SELECT 1 FROM json_each(NEW.fields_json, '$.gameTypes') gt
        WHERE UPPER(TRIM(CAST(gt.value AS TEXT))) IN ('V75', 'V85', 'V86')
      )
    )
  );
END;
