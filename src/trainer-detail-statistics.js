import {
  addCanonicalRaceScopeCondition,
  canonicalStartMethodSql,
  coreMetricSelectSql,
  mapCoreMetricRow,
  monteRaceCondition,
  normalizeTrackId,
  normalizeTrendBreed,
  normalizeTrendRaceScope,
  normalizeTrendRaceType,
  normalizeTrendStartMethod,
  swedenDateKey
} from './statistics/core.js';
import { DRIVER_LONGSHOT_PERCENT_MAX, DRIVER_MARKET_DEFINITION_VERSION } from './statistics/driver-features.js';

const DISTANCES = new Set(['all', '640', '1640', '2140', '2640', '3140', '3640', '4140', 'other-long']);
const DISTANCE_STANDARDS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const DISTANCE_TOLERANCE_M = 100;
const VOLT_LANES = new Set(['all', 'good', 'other']);
const SEX_VALUES = new Set(['all', 'mare', 'stallion', 'gelding']);
const REST_DAYS = 60;

function normalizeYear(value, asOfDate) {
  const fallback = Number(String(asOfDate).slice(0, 4));
  if (value == null || value === '') return fallback;
  const text = String(value).trim();
  if (!/^\d{4}$/.test(text)) throw new Error('year must be a four-digit year');
  const year = Number(text);
  if (year < 1900 || year > 2200) throw new Error('year is outside the supported range');
  return year;
}

function normalizeDistance(value) {
  const distance = String(value || 'all').trim().toLowerCase();
  if (!DISTANCES.has(distance)) throw new Error('distance_group is unsupported');
  return distance;
}

function normalizeSex(value) {
  const sex = String(value || 'all').trim().toLowerCase();
  if (!SEX_VALUES.has(sex)) throw new Error('sex must be all, mare, stallion or gelding');
  return sex;
}

function normalizeAge(value) {
  if (value == null || value === '' || value === 'all') return null;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 2 || age > 30) throw new Error('age must be all or an integer between 2 and 30');
  return age;
}

function normalizeVoltLane(value) {
  const lane = String(value || 'all').trim().toLowerCase();
  if (!VOLT_LANES.has(lane)) throw new Error('volt_lane must be all, good or other');
  return lane;
}

function normalizeHandicap(value) {
  if (value == null || value === '' || value === 'all') return null;
  const meters = Number(value);
  if (!Number.isInteger(meters) || meters < 0 || meters > 500 || meters % 20 !== 0) {
    throw new Error('handicap_m must be all or a non-negative 20-metre bucket');
  }
  return meters;
}

function normalizeFilters(options = {}) {
  const asOfDate = options.asOfDate || swedenDateKey();
  return {
    asOfDate,
    year: normalizeYear(options.year, asOfDate),
    raceScope: normalizeTrendRaceScope(options.raceScope),
    trackId: normalizeTrackId(options.trackId),
    raceType: normalizeTrendRaceType(options.raceType),
    breedType: normalizeTrendBreed(options.breedType),
    sex: normalizeSex(options.sex),
    age: normalizeAge(options.age),
    startMethod: normalizeTrendStartMethod(options.startMethod),
    distanceGroup: normalizeDistance(options.distanceGroup),
    voltLane: normalizeVoltLane(options.voltLane),
    handicapM: normalizeHandicap(options.handicapM)
  };
}

function addYearCondition(conditions, bindings, filters, raceAlias = 'r') {
  const currentYear = Number(filters.asOfDate.slice(0, 4));
  const start = `${filters.year}-01-01`;
  if (filters.year === currentYear) {
    conditions.push(`${raceAlias}.race_date >= ?`, `${raceAlias}.race_date <= ?`);
    bindings.push(start, filters.asOfDate);
    return;
  }
  conditions.push(`${raceAlias}.race_date >= ?`, `${raceAlias}.race_date < ?`);
  bindings.push(start, `${filters.year + 1}-01-01`);
}

function addDistanceCondition(conditions, bindings, distance, raceAlias = 'r') {
  if (distance === 'all') return;
  if (distance === 'other-long') {
    const standards = DISTANCE_STANDARDS.filter((value) => value >= 2640);
    conditions.push(`${raceAlias}.distance_m > 2640 AND ${standards.map(() => `NOT (${raceAlias}.distance_m BETWEEN ? AND ?)`).join(' AND ')}`);
    for (const standard of standards) bindings.push(standard - DISTANCE_TOLERANCE_M, standard + DISTANCE_TOLERANCE_M);
    return;
  }
  const meters = Number(distance);
  conditions.push(`${raceAlias}.distance_m BETWEEN ? AND ?`);
  bindings.push(meters - DISTANCE_TOLERANCE_M, meters + DISTANCE_TOLERANCE_M);
}

function addFilters(conditions, bindings, filters, { raceAlias = 'r', entryAlias = 're', horseAlias = 'h', includeYear = true } = {}) {
  if (includeYear) addYearCondition(conditions, bindings, filters, raceAlias);
  if (filters.trackId) {
    conditions.push(`${raceAlias}.track_id = ?`);
    bindings.push(filters.trackId);
  }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql(raceAlias)} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition(raceAlias));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition(raceAlias)}`);
  if (filters.breedType === 'warmblood') conditions.push(`(LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%warmblood%')`);
  if (filters.breedType === 'coldblood') conditions.push(`(LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%coldblood%')`);
  if (filters.sex === 'mare') conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('sto','mare','female','f')`);
  if (filters.sex === 'stallion') conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('hingst','stallion','male','m')`);
  if (filters.sex === 'gelding') conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('valack','gelding')`);
  if (filters.age != null) {
    conditions.push(`CAST(substr(?,1,4) AS INTEGER) - ${horseAlias}.birth_year = ?`);
    bindings.push(filters.asOfDate, filters.age);
  }
  addDistanceCondition(conditions, bindings, filters.distanceGroup, raceAlias);
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, raceAlias);
  if (filters.voltLane !== 'all') {
    conditions.push(`${canonicalStartMethodSql(raceAlias)} = 'volt'`);
    conditions.push(filters.voltLane === 'good'
      ? `${entryAlias}.actual_lane IN (1,6,7)`
      : `${entryAlias}.actual_lane IS NOT NULL AND ${entryAlias}.actual_lane NOT IN (1,6,7)`);
  }
  if (filters.handicapM != null) {
    conditions.push(
      `${canonicalStartMethodSql(raceAlias)} = 'volt'`,
      `${entryAlias}.handicap_m = ?`,
      `${entryAlias}.actual_start_distance_m IS NOT NULL`,
      `${raceAlias}.distance_m IS NOT NULL`,
      `${entryAlias}.actual_start_distance_m - ${raceAlias}.distance_m = ${entryAlias}.handicap_m`
    );
    bindings.push(filters.handicapM);
  }
}

async function validateTrack(env, trackId) {
  if (!trackId) return;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
  if (!row?.ok) throw new Error('track_id does not reference a known track');
}

function mapGroupedRows(rows, section) {
  return rows.filter((row) => row.section === section).map((row) => ({ label: row.label, ...mapCoreMetricRow(row) }));
}

function sortMethods(rows) {
  return rows.sort((a, b) => b.starts - a.starts || String(a.label).localeCompare(String(b.label)));
}

function sortDistances(rows) {
  return rows.sort((a, b) => {
    const left = Number(a.label);
    const right = Number(b.label);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    if (Number.isFinite(left)) return -1;
    if (Number.isFinite(right)) return 1;
    return String(a.label).localeCompare(String(b.label));
  });
}

function sortTracks(rows) {
  return rows.sort((a, b) => b.starts - a.starts || String(a.label).localeCompare(String(b.label), 'sv', { sensitivity: 'base' }));
}

async function loadSummaryAndBreakdowns(env, trainerId, filters) {
  const conditions = ['re.scratched = 0', 're.trainer_id = ?'];
  const bindings = [trainerId];
  addFilters(conditions, bindings, filters);
  const methodSql = canonicalStartMethodSql('r');
  const metrics = coreMetricSelectSql('f');
  const { results } = await env.DB.prepare(`
    WITH filtered AS MATERIALIZED (
      SELECT
        rr.race_entry_id,
        rr.placing,
        rr.gallop,
        rr.disqualified,
        rr.prize_sek,
        r.distance_m,
        ${methodSql} AS start_method_group,
        COALESCE(tr.canonical_name, 'Okänd bana') AS track_label
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      LEFT JOIN tracks tr ON tr.id = r.track_id
      WHERE ${conditions.join(' AND ')}
    )
    SELECT 'summary' AS section, 'all' AS label, ${metrics} FROM filtered f
    UNION ALL
    SELECT 'method' AS section, f.start_method_group AS label, ${metrics} FROM filtered f GROUP BY f.start_method_group
    UNION ALL
    SELECT 'distance' AS section, COALESCE(CAST(f.distance_m AS TEXT), 'unknown') AS label, ${metrics} FROM filtered f GROUP BY f.distance_m
    UNION ALL
    SELECT 'track' AS section, f.track_label AS label, ${metrics} FROM filtered f GROUP BY f.track_label
  `).bind(...bindings).all();
  const rows = results || [];
  const summaryRow = rows.find((row) => row.section === 'summary');
  return {
    summary: mapCoreMetricRow(summaryRow || {}),
    startMethods: sortMethods(mapGroupedRows(rows, 'method')),
    distances: sortDistances(mapGroupedRows(rows, 'distance')),
    tracks: sortTracks(mapGroupedRows(rows, 'track'))
  };
}

async function loadFormLast30(env, trainerId, filters) {
  const conditions = ['re.scratched = 0', 're.trainer_id = ?', 'rr.placing IS NOT NULL', 'rr.placing > 0'];
  const bindings = [trainerId];
  addFilters(conditions, bindings, filters);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS used_starts, AVG(placing) AS avg_placing
    FROM (
      SELECT rr.placing
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.race_date DESC, r.race_number DESC, re.id DESC
      LIMIT 30
    )
  `).bind(...bindings).first();
  const usedStarts = Number(row?.used_starts || 0);
  return usedStarts ? { usedStarts, averagePlacing: Number(row.avg_placing) } : null;
}

function marketAtStopCte() {
  return `market_candidates AS (
    SELECT bs.race_entry_id,bs.bet_percent,bs.market_rank,bs.captured_at,bs.id,
      ROW_NUMBER() OVER(PARTITION BY bs.race_entry_id ORDER BY julianday(bs.captured_at) DESC,bs.id DESC) AS rn
    FROM betting_snapshots bs
    JOIN game_rounds gr ON gr.id=bs.game_round_id
    JOIN game_legs gl ON gl.game_round_id=gr.id AND gl.leg_number=bs.leg_number
    JOIN race_entries mre ON mre.id=bs.race_entry_id AND mre.race_id=gl.race_id
    WHERE gr.bet_stop_at IS NOT NULL AND bs.source_record_id IS NOT NULL AND julianday(bs.captured_at)<=julianday(gr.bet_stop_at)
  ), market_at_stop AS (
    SELECT race_entry_id,bet_percent,market_rank,captured_at FROM market_candidates WHERE rn=1
  )`;
}

async function loadMarketSummary(env, trainerId, filters, kind) {
  const conditions = ['re.scratched = 0', 're.trainer_id = ?'];
  const bindings = [trainerId];
  addFilters(conditions, bindings, filters);
  if (kind === 'favorite') conditions.push('m.market_rank = 1');
  else {
    conditions.push('m.bet_percent IS NOT NULL', 'm.bet_percent >= 0', 'm.bet_percent <= ?');
    bindings.push(DRIVER_LONGSHOT_PERCENT_MAX);
  }
  const row = await env.DB.prepare(`
    WITH ${marketAtStopCte()}
    SELECT ${coreMetricSelectSql('rr')}
    FROM races r INDEXED BY idx_races_date
    JOIN race_entries re ON re.race_id = r.id
    JOIN race_results rr ON rr.race_entry_id = re.id
    JOIN horses h ON h.id = re.horse_id
    JOIN market_at_stop m ON m.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
  `).bind(...bindings).first();
  return mapCoreMetricRow(row || {});
}

function restSequenceCte() {
  return `actual AS (
    SELECT
      h.id AS horse_id,h.sex,h.birth_year,h.breed,
      t.id AS trainer_id,
      r.id,r.track_id,r.race_date,r.race_number,r.distance_m,r.start_method,r.first_prize_sek,r.race_name,r.main_class,r.class_flags_json,
      re.id AS race_entry_id,re.actual_lane,re.handicap_m,re.actual_start_distance_m,
      rr.placing,rr.prize_sek,rr.gallop,rr.disqualified,
      CAST(julianday(r.race_date)-julianday(LAG(r.race_date) OVER(PARTITION BY h.id ORDER BY r.race_date,r.race_number,re.id)) AS INTEGER) AS days_since_previous
    FROM races r
    JOIN race_entries re ON re.race_id=r.id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id
    JOIN trainers t ON t.id=re.trainer_id
    WHERE re.scratched=0
  ), staged AS (
    SELECT *,LAG(days_since_previous) OVER(PARTITION BY horse_id ORDER BY race_date,race_number,race_entry_id) AS previous_gap
    FROM actual
  )`;
}

function addStagedFilters(conditions, bindings, filters) {
  addYearCondition(conditions, bindings, filters, 's');
  if (filters.trackId) { conditions.push('s.track_id = ?'); bindings.push(filters.trackId); }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql('s')} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition('s'));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition('s')}`);
  if (filters.breedType === 'warmblood') conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%warmblood%')");
  if (filters.breedType === 'coldblood') conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%coldblood%')");
  if (filters.sex === 'mare') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('sto','mare','female','f')");
  if (filters.sex === 'stallion') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('hingst','stallion','male','m')");
  if (filters.sex === 'gelding') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('valack','gelding')");
  if (filters.age != null) {
    conditions.push('CAST(substr(?,1,4) AS INTEGER)-s.birth_year=?');
    bindings.push(filters.asOfDate, filters.age);
  }
  addDistanceCondition(conditions, bindings, filters.distanceGroup, 's');
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, 's');
  if (filters.voltLane !== 'all') {
    conditions.push(`${canonicalStartMethodSql('s')}='volt'`);
    conditions.push(filters.voltLane === 'good' ? 's.actual_lane IN (1,6,7)' : 's.actual_lane IS NOT NULL AND s.actual_lane NOT IN (1,6,7)');
  }
  if (filters.handicapM != null) {
    conditions.push(`${canonicalStartMethodSql('s')}='volt'`, 's.handicap_m=?', 's.actual_start_distance_m IS NOT NULL', 's.distance_m IS NOT NULL', 's.actual_start_distance_m-s.distance_m=s.handicap_m');
    bindings.push(filters.handicapM);
  }
}

async function loadRestSummary(env, trainerId, filters, kind) {
  const conditions = ['s.trainer_id = ?'];
  const bindings = [trainerId];
  addStagedFilters(conditions, bindings, filters);
  conditions.push(kind === 'first' ? `s.days_since_previous >= ${REST_DAYS}` : `s.previous_gap >= ${REST_DAYS} AND s.days_since_previous < ${REST_DAYS}`);
  const row = await env.DB.prepare(`
    WITH ${restSequenceCte()}
    SELECT
      COUNT(*) AS starts,
      SUM(CASE WHEN s.placing=1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN s.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
    FROM staged s
    WHERE ${conditions.join(' AND ')}
  `).bind(...bindings).first();
  const starts = Number(row?.starts || 0);
  const wins = Number(row?.wins || 0);
  const top3 = Number(row?.top3 || 0);
  return { starts, wins, top3, winRate: starts ? wins / starts : null, top3Rate: starts ? top3 / starts : null };
}

export async function getTrainerCalendarYearDetailStatistics(env, trainerId, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(trainerId || '').trim();
  if (!id) return null;
  const trainer = await env.DB.prepare('SELECT id,canonical_name AS name FROM trainers WHERE id=? LIMIT 1').bind(id).first();
  if (!trainer) return null;
  const filters = normalizeFilters(options);
  await validateTrack(env, filters.trackId);
  const [core, formLast30, favoriteResults, longshotResults, firstAfterRest, secondAfterRest] = await Promise.all([
    loadSummaryAndBreakdowns(env, id, filters),
    loadFormLast30(env, id, filters),
    loadMarketSummary(env, id, filters, 'favorite'),
    loadMarketSummary(env, id, filters, 'longshot'),
    loadRestSummary(env, id, filters, 'first'),
    loadRestSummary(env, id, filters, 'second')
  ]);
  return {
    trainer,
    filters,
    ...core,
    formLast30,
    favoriteResults,
    longshotResults,
    firstAfterRest,
    secondAfterRest,
    definitions: {
      longshotPercentMax: DRIVER_LONGSHOT_PERCENT_MAX,
      market: DRIVER_MARKET_DEFINITION_VERSION,
      voltLaneGood: [1, 6, 7],
      restDays: REST_DAYS
    }
  };
}
