export const HIGHER_PRIZE_THRESHOLD_SEK = 100000;

export const RACE_SCOPE_OPTIONS = Object.freeze([
  ['all', 'All data'],
  ['high_prize', 'Högre prissumma'],
  ['weekday', 'Vardagstrav']
]);

export function normalizeRaceScope(value) {
  const scope = String(value || 'all').trim().toLowerCase();
  if (RACE_SCOPE_OPTIONS.some(([key]) => key === scope)) return scope;
  // Temporary compatibility for links/API calls created before the Loppnivå definition changed.
  if (scope === 'stl') return 'stl';
  throw new Error('race scope must be all, high_prize or weekday');
}

function normalizedTextSql(expression) {
  let sql = `UPPER(' ' || COALESCE(${expression}, '') || ' ')`;
  for (const separator of ['-', '/', '(', ')', '[', ']', '"', ',', '.', ':', ';', '|', '_']) {
    sql = `REPLACE(${sql}, '${separator}', ' ')`;
  }
  for (const code of [9, 10, 13]) sql = `REPLACE(${sql}, CHAR(${code}), ' ')`;
  return sql;
}

function explicitStlTextCondition(text) {
  return `(
    INSTR(${text}, ' STL ') > 0
    OR INSTR(${text}, ' SVENSKA TRAVLIGAN ') > 0
    OR INSTR(${text}, ' SVENSKA TRAVLIGANS ') > 0
  )`;
}

export function stlRaceEvidenceCondition(raceAlias = 'r') {
  const classified = `EXISTS (SELECT 1 FROM race_stl_classifications rsc_scope WHERE rsc_scope.race_id = ${raceAlias}.id)`;
  const persistedRaceText = normalizedTextSql(`COALESCE(${raceAlias}.race_name, '') || ' ' || COALESCE(${raceAlias}.main_class, '') || ' ' || COALESCE(${raceAlias}.class_flags_json, '')`);
  const persistedEvidence = explicitStlTextCondition(persistedRaceText);
  const observationText = normalizedTextSql('no_scope.fields_json');
  const officialObservationEvidence = `EXISTS (
    SELECT 1
    FROM normalized_observations no_scope
    JOIN source_records sr_scope ON sr_scope.id = no_scope.source_record_id
    WHERE no_scope.entity_type = 'race'
      AND no_scope.entity_id = ${raceAlias}.id
      AND sr_scope.source_type = 'official_provider'
      AND ${explicitStlTextCondition(observationText)}
  )`;
  return `(${classified} OR ${persistedEvidence} OR ${officialObservationEvidence})`;
}

function higherPrizeRaceIdSetSql() {
  const storedRaceText = normalizedTextSql(`COALESCE(r_scope_set.race_name, '') || ' ' || COALESCE(r_scope_set.main_class, '') || ' ' || COALESCE(r_scope_set.class_flags_json, '')`);
  const observationText = normalizedTextSql('no_scope_set.fields_json');
  return `
    SELECT r_scope_set.id AS race_id
    FROM races r_scope_set
    WHERE r_scope_set.first_prize_sek >= ${HIGHER_PRIZE_THRESHOLD_SEK}
       OR ${explicitStlTextCondition(storedRaceText)}
    UNION ALL
    SELECT rsc_scope_set.race_id
    FROM race_stl_classifications rsc_scope_set
    UNION ALL
    SELECT gl_scope_set.race_id
    FROM game_legs gl_scope_set
    JOIN game_rounds gr_scope_set ON gr_scope_set.id = gl_scope_set.game_round_id
    WHERE UPPER(TRIM(gr_scope_set.game_type)) IN ('V75', 'V85', 'V86')
    UNION ALL
    SELECT no_scope_set.entity_id AS race_id
    FROM normalized_observations no_scope_set
    JOIN source_records sr_scope_set ON sr_scope_set.id = no_scope_set.source_record_id
    WHERE no_scope_set.entity_type = 'race'
      AND sr_scope_set.source_type = 'official_provider'
      AND ${explicitStlTextCondition(observationText)}
    UNION ALL
    SELECT no_game_scope_set.entity_id AS race_id
    FROM normalized_observations no_game_scope_set
    JOIN source_records sr_game_scope_set ON sr_game_scope_set.id = no_game_scope_set.source_record_id
    JOIN json_each(no_game_scope_set.fields_json, '$.gameTypes') game_type_scope_set
    WHERE no_game_scope_set.entity_type = 'race'
      AND sr_game_scope_set.source_type = 'official_provider'
      AND json_valid(no_game_scope_set.fields_json)
      AND json_type(no_game_scope_set.fields_json, '$.gameTypes') = 'array'
      AND UPPER(TRIM(CAST(game_type_scope_set.value AS TEXT))) IN ('V75', 'V85', 'V86')
  `;
}

export function higherPrizeRaceEvidenceCondition(raceAlias = 'r') {
  return `${raceAlias}.id IN (${higherPrizeRaceIdSetSql()})`;
}

export function raceScopeCondition(scope, raceAlias = 'r') {
  const normalized = normalizeRaceScope(scope);
  if (normalized === 'all') return null;
  if (normalized === 'stl') return stlRaceEvidenceCondition(raceAlias);
  const higherPrizeEvidence = higherPrizeRaceEvidenceCondition(raceAlias);
  return normalized === 'high_prize' ? higherPrizeEvidence : `COALESCE(${higherPrizeEvidence}, 0) = 0`;
}
