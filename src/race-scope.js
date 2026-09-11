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

function normalizedOfficialRaceTextSql(raceAlias) {
  let sql = `UPPER(' ' || COALESCE(${raceAlias}.race_name, '') || ' ' || COALESCE(${raceAlias}.main_class, '') || ' ' || COALESCE(${raceAlias}.class_flags_json, '') || ' ')`;
  for (const separator of ['-', '/', '(', ')', '[', ']', '"', ',', '.', ':', ';', '|', '_']) {
    sql = `REPLACE(${sql}, '${separator}', ' ')`;
  }
  for (const code of [9, 10, 13]) sql = `REPLACE(${sql}, CHAR(${code}), ' ')`;
  return sql;
}

export function stlRaceEvidenceCondition(raceAlias = 'r') {
  const classified = `EXISTS (SELECT 1 FROM race_stl_classifications rsc_scope WHERE rsc_scope.race_id = ${raceAlias}.id)`;
  const text = normalizedOfficialRaceTextSql(raceAlias);
  const explicitOfficialText = `(
    INSTR(${text}, ' STL ') > 0
    OR INSTR(${text}, ' SVENSKA TRAVLIGAN ') > 0
    OR INSTR(${text}, ' SVENSKA TRAVLIGANS ') > 0
  )`;
  return `(${classified} OR ${explicitOfficialText})`;
}

export function raceScopeCondition(scope, raceAlias = 'r') {
  const normalized = normalizeRaceScope(scope);
  if (normalized === 'all') return null;
  const stlEvidence = stlRaceEvidenceCondition(raceAlias);
  return normalized === 'stl' ? stlEvidence : `NOT ${stlEvidence}`;
}
