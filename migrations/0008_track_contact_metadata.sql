ALTER TABLE tracks ADD COLUMN street_address TEXT;
ALTER TABLE tracks ADD COLUMN postal_code TEXT;
ALTER TABLE tracks ADD COLUMN website_url TEXT;

-- STL class and race type are deterministic calculated classifications, not raw race facts.
-- Keep them in separate derived tables so raw race_name/main_class/class_flags_json stay untouched.
CREATE TABLE race_stl_classifications (
  race_id TEXT PRIMARY KEY REFERENCES races(id) ON DELETE CASCADE,
  stl_class TEXT NOT NULL CHECK (stl_class IN (
    'class_iii','class_ii','class_i','bronze','silver','gold',
    'mares_division','diamond_mares','coldblood_division'
  )),
  classification_version TEXT NOT NULL,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE race_type_classifications (
  race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  race_type TEXT NOT NULL CHECK (race_type IN (
    'mares','coldblood','lane_ladder','apprentice','amateur','monte','young_horse',
    'age_group','stayer','fast_class','advantage','p21','grassroots','double_class'
  )),
  classification_version TEXT NOT NULL,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (race_id, race_type)
);

CREATE INDEX idx_race_stl_classifications_class
  ON race_stl_classifications(stl_class, race_id);
CREATE INDEX idx_race_type_classifications_type
  ON race_type_classifications(race_type, race_id);

-- Recalculate from the verified normalized race text whenever those factual inputs change.
-- The trigger intentionally uses only stored race facts; missing/unknown inputs create no classification.
CREATE TRIGGER trg_race_classification_after_insert
AFTER INSERT ON races
BEGIN
  DELETE FROM race_stl_classifications WHERE race_id = NEW.id;
  INSERT INTO race_stl_classifications (race_id, stl_class, classification_version)
  SELECT NEW.id,
    CASE
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass III%'
        OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 3%' THEN 'class_iii'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass II%'
        OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 2%' THEN 'class_ii'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass I%'
        OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 1%' THEN 'class_i'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Bronsdivision%' THEN 'bronze'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Silverdivision%' THEN 'silver'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Gulddivision%' THEN 'gold'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stodivision%' THEN 'mares_division'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Diamantsto%' THEN 'diamond_mares'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodsdivision%' THEN 'coldblood_division'
      ELSE NULL
    END,
    'race-classification-v1'
  WHERE CASE
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass III%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 3%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass II%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 2%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass I%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 1%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Bronsdivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Silverdivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Gulddivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stodivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Diamantsto%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodsdivision%' THEN 1
      ELSE 0
    END = 1;

  DELETE FROM race_type_classifications WHERE race_id = NEW.id;
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'mares', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stolopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'coldblood', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodslopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'lane_ladder', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Spårtrappa%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'apprentice', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Lärlingslopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'amateur', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Amatörlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'monte', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Montélopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Montelopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'young_horse', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Unghästlopp%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Unghästserie%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'age_group', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Årgångslopp%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%årgångslopp%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%2-åring%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%3-åring%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%4-åring%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%5-åring%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'stayer', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stayer%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Långlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'fast_class', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Snabblopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'advantage', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Fördelslopp%'
       OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Fördel ston%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'p21', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%P21%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'grassroots', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Breddlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version)
    SELECT NEW.id, 'double_class', 'race-classification-v1'
    WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Dubbelklass%';
END;

CREATE TRIGGER trg_race_classification_after_update
AFTER UPDATE OF race_name, main_class, class_flags_json ON races
BEGIN
  DELETE FROM race_stl_classifications WHERE race_id = NEW.id;
  INSERT INTO race_stl_classifications (race_id, stl_class, classification_version)
  SELECT NEW.id,
    CASE
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass III%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 3%' THEN 'class_iii'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass II%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 2%' THEN 'class_ii'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass I%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 1%' THEN 'class_i'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Bronsdivision%' THEN 'bronze'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Silverdivision%' THEN 'silver'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Gulddivision%' THEN 'gold'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stodivision%' THEN 'mares_division'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Diamantsto%' THEN 'diamond_mares'
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodsdivision%' THEN 'coldblood_division'
      ELSE NULL
    END,
    'race-classification-v1'
  WHERE CASE
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass III%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 3%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass II%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 2%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass I%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Klass 1%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Bronsdivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Silverdivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Gulddivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stodivision%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Diamantsto%' THEN 1
      WHEN (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodsdivision%' THEN 1
      ELSE 0
    END = 1;

  DELETE FROM race_type_classifications WHERE race_id = NEW.id;
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'mares', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stolopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'coldblood', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Kallblodslopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'lane_ladder', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Spårtrappa%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'apprentice', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Lärlingslopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'amateur', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Amatörlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'monte', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Montélopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Montelopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'young_horse', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Unghästlopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Unghästserie%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'age_group', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Årgångslopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%årgångslopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%2-åring%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%3-åring%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%4-åring%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%5-åring%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'stayer', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Stayer%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Långlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'fast_class', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Snabblopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'advantage', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Fördelslopp%' OR (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Fördel ston%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'p21', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%P21%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'grassroots', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Breddlopp%';
  INSERT INTO race_type_classifications (race_id, race_type, classification_version) SELECT NEW.id, 'double_class', 'race-classification-v1' WHERE (COALESCE(NEW.race_name,'') || ' | ' || COALESCE(NEW.main_class,'') || ' | ' || COALESCE(NEW.class_flags_json,'')) LIKE '%Dubbelklass%';
END;

-- One-time deterministic backfill for races normalized before this migration.
UPDATE races SET race_name = race_name;
