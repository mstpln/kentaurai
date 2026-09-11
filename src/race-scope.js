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

export function higherPrizeRaceEvidenceCondition(raceAlias = 'r') {
  const stlEvidence = stlRaceEvidenceCondition(raceAlias);
  const gameEvidence = `EXISTS (
    SELECT 1
    FROM game_legs gl_scope
    JOIN game_rounds gr_scope ON gr_scope.id = gl_scope.game_round_id
    WHERE gl_scope.race_id = ${raceAlias}.id
      AND UPPER(TRIM(gr_scope.game_type)) IN ('V75', 'V85', 'V86')
  )`;
  const prizeEvidence = `${raceAlias}.first_prize_sek >= ${HIGHER_PRIZE_THRESHOLD_SEK}`;
  return `(${stlEvidence} OR ${gameEvidence} OR ${prizeEvidence})`;
}

export function raceScopeCondition(scope, raceAlias = 'r') {
  const normalized = normalizeRaceScope(scope);
  if (normalized === 'all') return null;
  if (normalized === 'stl') return stlRaceEvidenceCondition(raceAlias);
  const higherPrizeEvidence = higherPrizeRaceEvidenceCondition(raceAlias);
  return normalized === 'high_prize' ? higherPrizeEvidence : `COALESCE(${higherPrizeEvidence}, 0) = 0`;
}
