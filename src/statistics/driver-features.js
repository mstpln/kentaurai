export const DRIVER_LONGSHOT_PERCENT_MAX = 5;
export const DRIVER_MARKET_DEFINITION_VERSION = 'market-at-stop-v1';
export const DRIVER_POSITION_DEFINITION_VERSION = 'verified-position-flags-v1';

function canonicalMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (['volt', 'volte', 'voltstart'].includes(method)) return 'volt';
  if (['auto', 'autostart'].includes(method)) return 'auto';
  return null;
}

export function voltLaneQuality({ startMethod, actualLane } = {}) {
  if (canonicalMethod(startMethod) !== 'volt') return null;
  const lane = Number(actualLane);
  if (!Number.isInteger(lane) || lane < 1) return null;
  return [1, 6, 7].includes(lane) ? 'good' : 'other';
}

export function verifiedHandicapBucket({ startMethod, handicapM, actualStartDistanceM, raceDistanceM } = {}) {
  if (canonicalMethod(startMethod) !== 'volt') return null;
  const handicap = Number(handicapM);
  const actual = Number(actualStartDistanceM);
  const base = Number(raceDistanceM);
  if (![handicap, actual, base].every(Number.isFinite)) return null;
  if (!Number.isInteger(handicap) || handicap < 0 || handicap % 20 !== 0) return null;
  if (actual - base !== handicap) return null;
  return handicap;
}

export function isDriverLongshotPercent(value) {
  if (value == null || value === '') return false;
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= DRIVER_LONGSHOT_PERCENT_MAX;
}
