export const RACE_SCOPE_OPTIONS = Object.freeze([
  ['all', 'All data'],
  ['stl', 'STL-lopp'],
  ['weekday', 'Vardagstrav']
]);

export function normalizeRaceScope(value) {
  const scope = String(value || 'all').trim().toLowerCase();
  if (RACE_SCOPE_OPTIONS.some(([key]) => key === scope)) return scope;
  throw new Error('race scope must be all, stl or weekday');
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

export function raceScopeCondition(scope, raceAlias = 'r') {
  const normalized = normalizeRaceScope(scope);
  if (normalized === 'all') return null;
  const stlEvidence = stlRaceEvidenceCondition(raceAlias);
  return normalized === 'stl' ? stlEvidence : `NOT ${stlEvidence}`;
}
