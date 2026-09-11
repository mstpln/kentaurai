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

export function raceScopeCondition(scope, raceAlias = 'r') {
  const normalized = normalizeRaceScope(scope);
  if (normalized === 'all') return null;
  const existsSql = `EXISTS (SELECT 1 FROM race_stl_classifications rsc_scope WHERE rsc_scope.race_id = ${raceAlias}.id)`;
  return normalized === 'stl' ? existsSql : `NOT ${existsSql}`;
}
