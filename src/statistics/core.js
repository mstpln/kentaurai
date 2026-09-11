import { normalizeRaceScope, raceScopeCondition } from '../race-scope.js';

export const TREND_PERIOD_OPTIONS = Object.freeze([
  ['2w', '2 veckor'],
  ['4w', '4 veckor'],
  ['3m', '3 mån'],
  ['6m', '6 mån'],
  ['1y', '1 år']
]);

export const TREND_CATEGORY_OPTIONS = Object.freeze([
  ['trainers', 'Tränare'],
  ['horses', 'Hästar'],
  ['drivers', 'Kuskar']
]);

export const TREND_RACE_TYPE_OPTIONS = Object.freeze([
  ['all', 'Alla'],
  ['sulky', 'Sulky'],
  ['monte', 'Monté']
]);

export const TREND_BREED_OPTIONS = Object.freeze([
  ['all', 'Alla'],
  ['warmblood', 'Varmblod'],
  ['coldblood', 'Kallblod']
]);

export const TREND_START_METHOD_OPTIONS = Object.freeze([
  ['all', 'Alla'],
  ['auto', 'Autostart'],
  ['volt', 'Voltstart']
]);

export const TREND_MIN_STARTS_OPTIONS = Object.freeze([
  ['all', 'Alla'],
  ['3', 'Minst 3'],
  ['5', 'Minst 5'],
  ['10', 'Minst 10'],
  ['20', 'Minst 20']
]);

function assertDateKey(value, name = 'date') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must use YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`${name} is invalid`);
  return text;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return dateKey(date);
}

function subtractCalendarMonths(dateText, months) {
  const [year, month, day] = dateText.split('-').map(Number);
  const targetMonthIndex = month - 1 - months;
  const first = new Date(Date.UTC(year, targetMonthIndex, 1));
  const targetYear = first.getUTCFullYear();
  const targetMonth = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateKey(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))));
}

export function swedenDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function trendDateWindow(periodValue, asOfDate = swedenDateKey()) {
  const period = String(periodValue || '2w').trim().toLowerCase();
  if (!TREND_PERIOD_OPTIONS.some(([value]) => value === period)) throw new Error('period must be 2w, 4w, 3m, 6m or 1y');
  const endDate = assertDateKey(asOfDate, 'asOfDate');
  let startDate;
  if (period === '2w') startDate = subtractDays(endDate, 13);
  else if (period === '4w') startDate = subtractDays(endDate, 27);
  else if (period === '3m') startDate = subtractCalendarMonths(endDate, 3);
  else if (period === '6m') startDate = subtractCalendarMonths(endDate, 6);
  else startDate = subtractCalendarMonths(endDate, 12);
  return { period, startDate, endDate };
}

export function normalizeTrendCategory(value) {
  const category = String(value || 'trainers').trim().toLowerCase();
  if (!TREND_CATEGORY_OPTIONS.some(([key]) => key === category)) throw new Error('category must be trainers, horses or drivers');
  return category;
}

export function normalizeTrendRaceScope(value) {
  const raw = String(value || 'all').trim().toLowerCase();
  if (!['all', 'high_prize', 'weekday'].includes(raw)) throw new Error('race_scope must be all, high_prize or weekday');
  return normalizeRaceScope(raw);
}

export function normalizeTrendRaceType(value) {
  const type = String(value || 'all').trim().toLowerCase();
  if (!TREND_RACE_TYPE_OPTIONS.some(([key]) => key === type)) throw new Error('race_type must be all, sulky or monte');
  return type;
}

export function normalizeTrendBreed(value) {
  const breed = String(value || 'all').trim().toLowerCase();
  if (!TREND_BREED_OPTIONS.some(([key]) => key === breed)) throw new Error('breed_type must be all, warmblood or coldblood');
  return breed;
}

export function normalizeTrendStartMethod(value) {
  const method = String(value || 'all').trim().toLowerCase();
  if (!TREND_START_METHOD_OPTIONS.some(([key]) => key === method)) throw new Error('start_method must be all, auto or volt');
  return method;
}

export function normalizeTrendMinStarts(value) {
  const raw = String(value == null || value === '' ? 'all' : value).trim().toLowerCase();
  if (!TREND_MIN_STARTS_OPTIONS.some(([key]) => key === raw)) throw new Error('min_starts must be all, 3, 5, 10 or 20');
  return raw === 'all' ? null : Number(raw);
}

export function normalizeTrackId(value) {
  if (value == null || value === '' || value === 'all') return null;
  const id = String(value).trim();
  if (!id || id.length > 160 || /[\u0000-\u001f]/.test(id)) throw new Error('track_id is invalid');
  return id;
}

export function canonicalStartMethodSql(raceAlias = 'r') {
  return `CASE
    WHEN LOWER(COALESCE(${raceAlias}.start_method, '')) IN ('auto','autostart') THEN 'auto'
    WHEN LOWER(COALESCE(${raceAlias}.start_method, '')) IN ('volt','volte','voltstart') THEN 'volt'
    WHEN ${raceAlias}.start_method IS NULL OR TRIM(${raceAlias}.start_method) = '' THEN 'unknown'
    ELSE LOWER(${raceAlias}.start_method)
  END`;
}

export function coreMetricSelectSql(resultAlias = 'rr') {
  return `
      COUNT(*) AS starts,
      SUM(CASE WHEN ${resultAlias}.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN ${resultAlias}.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ${resultAlias}.placing = 2 THEN 1 ELSE 0 END) AS seconds,
      SUM(CASE WHEN ${resultAlias}.placing = 3 THEN 1 ELSE 0 END) AS thirds,
      SUM(CASE WHEN ${resultAlias}.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN ${resultAlias}.gallop = 1 THEN 1 ELSE 0 END) AS gallops,
      SUM(CASE WHEN ${resultAlias}.gallop IS NOT NULL THEN 1 ELSE 0 END) AS gallop_verified_starts,
      SUM(CASE WHEN ${resultAlias}.disqualified = 1 THEN 1 ELSE 0 END) AS disqualifications,
      SUM(CASE WHEN ${resultAlias}.prize_sek IS NOT NULL THEN 1 ELSE 0 END) AS prize_verified_starts,
      SUM(${resultAlias}.prize_sek) AS prize_sek`;
}

export function mapCoreMetricRow(row) {
  const starts = Number(row?.starts ?? 0);
  const resultStarts = Number(row?.result_starts ?? 0);
  const wins = Number(row?.wins ?? 0);
  const seconds = Number(row?.seconds ?? 0);
  const thirds = Number(row?.thirds ?? 0);
  const top3 = Number(row?.top3 ?? 0);
  const gallops = Number(row?.gallops ?? 0);
  const gallopVerifiedStarts = Number(row?.gallop_verified_starts ?? 0);
  const disqualifications = Number(row?.disqualifications ?? 0);
  const prizeVerifiedStarts = Number(row?.prize_verified_starts ?? 0);
  const prizeSek = prizeVerifiedStarts ? Number(row.prize_sek) : null;
  return {
    starts,
    resultStarts,
    wins,
    losses: starts - wins,
    seconds,
    thirds,
    top3,
    gallops,
    gallopVerifiedStarts,
    disqualifications,
    prizeVerifiedStarts,
    prizeSek,
    winRate: starts ? wins / starts : null,
    top3Rate: resultStarts ? top3 / resultStarts : null,
    gallopRate: gallopVerifiedStarts ? gallops / gallopVerifiedStarts : null
  };
}

export function addCanonicalRaceScopeCondition(conditions, scope, raceAlias = 'r') {
  const condition = raceScopeCondition(scope, raceAlias);
  if (condition) conditions.push(condition);
}

export function monteRaceCondition(raceAlias = 'r') {
  return `EXISTS (
    SELECT 1 FROM race_type_classifications rtc_stats
    WHERE rtc_stats.race_id = ${raceAlias}.id AND rtc_stats.race_type = 'monte'
  )`;
}

export function addTrendRaceFilters(conditions, bindings, filters, { raceAlias = 'r', horseAlias = 'h' } = {}) {
  if (filters.trackId) {
    conditions.push(`${raceAlias}.track_id = ?`);
    bindings.push(filters.trackId);
  }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql(raceAlias)} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition(raceAlias));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition(raceAlias)}`);
  if (filters.breedType === 'warmblood') conditions.push(`(LOWER(COALESCE(${horseAlias}.breed, '')) LIKE '%varmblod%' OR LOWER(COALESCE(${horseAlias}.breed, '')) LIKE '%warmblood%')`);
  if (filters.breedType === 'coldblood') conditions.push(`(LOWER(COALESCE(${horseAlias}.breed, '')) LIKE '%kallblod%' OR LOWER(COALESCE(${horseAlias}.breed, '')) LIKE '%coldblood%')`);
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, raceAlias);
}
