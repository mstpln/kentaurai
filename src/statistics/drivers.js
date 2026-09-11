import {
  addCanonicalRaceScopeCondition,
  canonicalStartMethodSql,
  coreMetricSelectSql,
  mapCoreMetricRow,
  monteRaceCondition,
  normalizeTrackId,
  normalizeTrendBreed,
  normalizeTrendMinStarts,
  normalizeTrendRaceScope,
  normalizeTrendRaceType,
  normalizeTrendStartMethod,
  trendDateWindow
} from './core.js';
import { DRIVER_LONGSHOT_PERCENT_MAX, DRIVER_MARKET_DEFINITION_VERSION, DRIVER_POSITION_DEFINITION_VERSION } from './driver-features.js';

const PERIODS = new Set(['all', '2w', '4w', '3m', '6m', '1y']);
const DISTANCES = new Set(['all', '640', '1640', '2140', '2640', '3140', '3640', '4140', 'other-long']);
const DISTANCE_STANDARDS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const DISTANCE_TOLERANCE_M = 100;
const VOLT_LANES = new Set(['all', 'good', 'other']);

function stockholmDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
}

function normalizePeriod(value) {
  const period = String(value || '1y').trim().toLowerCase();
  if (!PERIODS.has(period)) throw new Error('period must be all, 2w, 4w, 3m, 6m or 1y');
  return period;
}

function normalizeDistance(value) {
  const distance = String(value || 'all').trim().toLowerCase();
  if (!DISTANCES.has(distance)) throw new Error('distance_group is unsupported');
  return distance;
}

function normalizeVoltLane(value) {
  const lane = String(value || 'all').trim().toLowerCase();
  if (!VOLT_LANES.has(lane)) throw new Error('volt_lane must be all, good or other');
  return lane;
}

function normalizeHandicap(value) {
  if (value == null || value === '' || value === 'all') return null;
  const meters = Number(value);
  if (!Number.isInteger(meters) || meters < 0 || meters > 500 || meters % 20 !== 0) throw new Error('handicap_m must be all or a non-negative 20-metre bucket');
  return meters;
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

function addDriverFilters(conditions, bindings, filters, { includePeriod = true } = {}) {
  if (includePeriod && filters.period !== 'all') {
    const window = trendDateWindow(filters.period, filters.asOfDate);
    conditions.push('r.race_date >= ?', 'r.race_date <= ?');
    bindings.push(window.startDate, window.endDate);
  } else if (includePeriod) {
    conditions.push('r.race_date <= ?');
    bindings.push(filters.asOfDate);
  }
  if (filters.trackId) {
    conditions.push('r.track_id = ?');
    bindings.push(filters.trackId);
  }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql('r')} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition('r'));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition('r')}`);
  if (filters.breedType === 'warmblood') conditions.push("(LOWER(COALESCE(h.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%warmblood%')");
  if (filters.breedType === 'coldblood') conditions.push("(LOWER(COALESCE(h.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%coldblood%')");
  addDistanceCondition(conditions, bindings, filters.distanceGroup, 'r');
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, 'r');
  if (filters.voltLane !== 'all') {
    conditions.push(`${canonicalStartMethodSql('r')} = 'volt'`);
    conditions.push(filters.voltLane === 'good' ? 're.actual_lane IN (1,6,7)' : 're.actual_lane IS NOT NULL AND re.actual_lane NOT IN (1,6,7)');
  }
  if (filters.handicapM != null) {
    conditions.push(`${canonicalStartMethodSql('r')} = 'volt'`, 're.handicap_m = ?', 're.actual_start_distance_m IS NOT NULL', 'r.distance_m IS NOT NULL', 're.actual_start_distance_m - r.distance_m = re.handicap_m');
    bindings.push(filters.handicapM);
  }
}

export function normalizeDriverStatsFilters(options = {}) {
  return {
    period: normalizePeriod(options.period),
    asOfDate: options.asOfDate || stockholmDateKey(),
    raceScope: normalizeTrendRaceScope(options.raceScope),
    trackId: normalizeTrackId(options.trackId),
    raceType: normalizeTrendRaceType(options.raceType),
    breedType: normalizeTrendBreed(options.breedType),
    startMethod: normalizeTrendStartMethod(options.startMethod),
    distanceGroup: normalizeDistance(options.distanceGroup),
    minStarts: normalizeTrendMinStarts(options.minStarts),
    voltLane: normalizeVoltLane(options.voltLane),
    handicapM: normalizeHandicap(options.handicapM)
  };
}

async function validateTrack(env, id) {
  if (!id) return;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(id).first();
  if (!row?.ok) throw new Error('track_id does not identify a stored track');
}

function orderFor(metric) {
  if (metric === 'winRate') return '(wins * 1.0 / starts) DESC, wins DESC, starts DESC, entity_id ASC';
  if (metric === 'top3Rate') return '(top3 * 1.0 / result_starts) DESC, top3 DESC, result_starts DESC, entity_id ASC';
  if (metric === 'wins') return 'wins DESC, (wins * 1.0 / starts) DESC, starts DESC, entity_id ASC';
  if (metric === 'earnings') return 'prize_sek DESC, wins DESC, starts DESC, entity_id ASC';
  if (metric === 'earningsPerVerifiedStart') return '(prize_sek * 1.0 / prize_verified_starts) DESC, prize_sek DESC, prize_verified_starts DESC, entity_id ASC';
  throw new Error('unsupported driver ranking metric');
}

function buildCoreRanking(filters, metric, extraConditions = [], { includePeriod = true } = {}) {
  const conditions = ['re.scratched = 0', 're.driver_id IS NOT NULL', ...extraConditions];
  const bindings = [];
  addDriverFilters(conditions, bindings, filters, { includePeriod });
  if (!includePeriod) {
    const year = Number(filters.asOfDate.slice(0, 4));
    conditions.push('r.race_date >= ?', 'r.race_date <= ?');
    bindings.push(`${year}-01-01`, filters.asOfDate);
  }
  const minimumCondition = filters.minStarts == null ? 'starts > 0' : 'starts >= ?';
  if (filters.minStarts != null) bindings.push(filters.minStarts);
  let denominatorCondition = '';
  if (metric === 'top3Rate') denominatorCondition = ' AND result_starts > 0';
  if (metric === 'earningsPerVerifiedStart' || metric === 'earnings') denominatorCondition = ' AND prize_verified_starts > 0';
  return {
    sql: `WITH driver_stats AS (
      SELECT d.id AS entity_id,d.canonical_name AS name,${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id=r.id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN horses h ON h.id=re.horse_id
      JOIN drivers d ON d.id=re.driver_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY d.id,d.canonical_name
    ) SELECT * FROM driver_stats WHERE ${minimumCondition}${denominatorCondition} ORDER BY ${orderFor(metric)} LIMIT 10`,
    bindings
  };
}

function buildFormQuery(filters, driverId = null, limit = true) {
  const conditions = ['re.scratched = 0', 're.driver_id IS NOT NULL', 'rr.placing IS NOT NULL', 'rr.placing > 0'];
  const bindings = [];
  if (driverId) { conditions.push('d.id = ?'); bindings.push(driverId); }
  addDriverFilters(conditions, bindings, filters);
  return {
    sql: `WITH ranked AS (
      SELECT d.id AS entity_id,d.canonical_name AS name,rr.placing,
        ROW_NUMBER() OVER(PARTITION BY d.id ORDER BY r.race_date DESC,COALESCE(r.race_number,0) DESC,re.id DESC) AS rn
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id=r.id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN horses h ON h.id=re.horse_id
      JOIN drivers d ON d.id=re.driver_id
      WHERE ${conditions.join(' AND ')}
    ), form AS (
      SELECT entity_id,name,COUNT(*) AS used_starts,AVG(placing*1.0) AS avg_placing FROM ranked WHERE rn<=30 GROUP BY entity_id,name
    ) SELECT * FROM form ORDER BY avg_placing ASC,used_starts DESC,entity_id ASC${limit ? ' LIMIT 10' : ''}`,
    bindings
  };
}

function marketAtStopCte() {
  return `market_candidates AS (
    SELECT bs.race_entry_id,bs.bet_percent,bs.market_rank,bs.captured_at,bs.id,
      ROW_NUMBER() OVER(PARTITION BY bs.race_entry_id ORDER BY julianday(bs.captured_at) DESC,bs.id DESC) AS rn
    FROM betting_snapshots bs
    JOIN game_rounds gr ON gr.id=bs.game_round_id
    JOIN game_legs gl ON gl.game_round_id=gr.id AND gl.leg_number=bs.leg_number
    JOIN race_entries market_re ON market_re.id=bs.race_entry_id AND market_re.race_id=gl.race_id
    WHERE gr.bet_stop_at IS NOT NULL
      AND julianday(bs.captured_at) <= julianday(gr.bet_stop_at)
  ), market_at_stop AS (
    SELECT race_entry_id,bet_percent,market_rank,captured_at FROM market_candidates WHERE rn=1
  )`;
}

function buildMarketRanking(filters, kind, driverId = null, limit = true) {
  const conditions = ['re.scratched=0', 're.driver_id IS NOT NULL'];
  const bindings = [];
  if (driverId) { conditions.push('d.id=?'); bindings.push(driverId); }
  addDriverFilters(conditions, bindings, filters);
  if (kind === 'favorite') conditions.push('m.market_rank=1');
  else { conditions.push('m.bet_percent IS NOT NULL', 'm.bet_percent <= ?'); bindings.push(DRIVER_LONGSHOT_PERCENT_MAX); }
  const min = filters.minStarts == null || driverId ? 'starts > 0' : 'starts >= ?';
  if (filters.minStarts != null && !driverId) bindings.push(filters.minStarts);
  return {
    sql: `WITH ${marketAtStopCte()}, stats AS (
      SELECT d.id AS entity_id,d.canonical_name AS name,${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id=r.id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN horses h ON h.id=re.horse_id
      JOIN drivers d ON d.id=re.driver_id
      JOIN market_at_stop m ON m.race_entry_id=re.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY d.id,d.canonical_name
    ) SELECT * FROM stats WHERE ${min} ORDER BY (wins*1.0/starts) DESC,wins DESC,starts DESC,entity_id ASC${limit ? ' LIMIT 10' : ''}`,
    bindings
  };
}

function buildPositionRanking(filters, kind) {
  const flag = kind === 'leader' ? 'leader' : 'death_seat';
  return buildCoreRanking(filters, 'winRate', [`EXISTS (SELECT 1 FROM race_positions rp WHERE rp.race_entry_id=re.id AND rp.${flag}=1 AND rp.source_record_id IS NOT NULL)`]);
}

async function run(env, query) {
  const { results } = await env.DB.prepare(query.sql).bind(...query.bindings).all();
  return results || [];
}

function mapCoreRanking(rows, metric) {
  return rows.map((row, index) => {
    const core = mapCoreMetricRow(row);
    return { rank:index+1,id:row.entity_id,name:row.name,...core,earningsPerVerifiedStart:core.prizeVerifiedStarts?core.prizeSek/core.prizeVerifiedStarts:null,rankingMetric:metric };
  });
}

function mapForm(rows) {
  return rows.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,usedStarts:Number(row.used_starts),averagePlacing:Number(row.avg_placing)}));
}

export async function getDriverRankings(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const filters = normalizeDriverStatsFilters(options);
  await validateTrack(env, filters.trackId);
  const [win,top3,wins,form,yearEarnings,perStart,leader,death,backRow,auto,volt,favorite,longshot] = await Promise.all([
    run(env,buildCoreRanking(filters,'winRate')),
    run(env,buildCoreRanking(filters,'top3Rate')),
    run(env,buildCoreRanking(filters,'wins')),
    run(env,buildFormQuery(filters)),
    run(env,buildCoreRanking(filters,'earnings',[],{includePeriod:false})),
    run(env,buildCoreRanking(filters,'earningsPerVerifiedStart')),
    run(env,buildPositionRanking(filters,'leader')),
    run(env,buildPositionRanking(filters,'death')),
    run(env,buildCoreRanking(filters,'winRate',[`${canonicalStartMethodSql('r')}='auto'`,'re.back_row=1'])),
    run(env,buildCoreRanking(filters,'winRate',[`${canonicalStartMethodSql('r')}='auto'`])),
    run(env,buildCoreRanking(filters,'winRate',[`${canonicalStartMethodSql('r')}='volt'`])),
    run(env,buildMarketRanking(filters,'favorite')),
    run(env,buildMarketRanking(filters,'longshot'))
  ]);
  return {
    filters,
    definitions:{longshotPercentMax:DRIVER_LONGSHOT_PERCENT_MAX,market:DRIVER_MARKET_DEFINITION_VERSION,positions:DRIVER_POSITION_DEFINITION_VERSION,voltLaneGood:[1,6,7]},
    rankings:{
      highestWinRate:mapCoreRanking(win,'winRate'),
      highestTop3Rate:mapCoreRanking(top3,'top3Rate'),
      mostWins:mapCoreRanking(wins,'wins'),
      bestFormLast30:mapForm(form),
      mostEarningsThisYear:mapCoreRanking(yearEarnings,'earnings'),
      highestEarningsPerStart:mapCoreRanking(perStart,'earningsPerVerifiedStart'),
      bestFromLead:mapCoreRanking(leader,'winRate'),
      bestFromDeathSeat:mapCoreRanking(death,'winRate'),
      bestFromBackRow:mapCoreRanking(backRow,'winRate'),
      bestAuto:mapCoreRanking(auto,'winRate'),
      bestVolt:mapCoreRanking(volt,'winRate'),
      favoriteResults:mapCoreRanking(favorite,'winRate'),
      longshotResults:mapCoreRanking(longshot,'winRate')
    }
  };
}

async function driverSummary(env, filters, driverId) {
  const conditions=['re.scratched=0','d.id=?'];
  const bindings=[driverId];
  addDriverFilters(conditions,bindings,filters);
  const row=await env.DB.prepare(`SELECT ${coreMetricSelectSql('rr')} FROM races r INDEXED BY idx_races_date JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id JOIN horses h ON h.id=re.horse_id JOIN drivers d ON d.id=re.driver_id WHERE ${conditions.join(' AND ')}`).bind(...bindings).first();
  return mapCoreMetricRow(row||{});
}

function marketSummary(rows) {
  if (!rows.length) return {starts:0,resultStarts:0,wins:0,losses:0,top3:0,prizeVerifiedStarts:0,prizeSek:null,winRate:null,top3Rate:null};
  const core=mapCoreMetricRow(rows[0]);
  return {...core,earningsPerVerifiedStart:core.prizeVerifiedStarts?core.prizeSek/core.prizeVerifiedStarts:null};
}

export async function getDriverDetailStatistics(env, driverId, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const filters=normalizeDriverStatsFilters(options);
  await validateTrack(env,filters.trackId);
  const driver=await env.DB.prepare('SELECT id,canonical_name AS name FROM drivers WHERE id=? LIMIT 1').bind(driverId).first();
  if (!driver) return null;
  const [summary,form,favorite,longshot]=await Promise.all([
    driverSummary(env,filters,driverId),
    run(env,buildFormQuery(filters,driverId,false)),
    run(env,buildMarketRanking(filters,'favorite',driverId,false)),
    run(env,buildMarketRanking(filters,'longshot',driverId,false))
  ]);
  return {
    driver,
    filters,
    summary,
    formLast30:form[0]?{usedStarts:Number(form[0].used_starts),averagePlacing:Number(form[0].avg_placing)}:null,
    favoriteResults:marketSummary(favorite),
    longshotResults:marketSummary(longshot),
    definitions:{longshotPercentMax:DRIVER_LONGSHOT_PERCENT_MAX,market:DRIVER_MARKET_DEFINITION_VERSION,positions:DRIVER_POSITION_DEFINITION_VERSION,voltLaneGood:[1,6,7]}
  };
}

export async function getDriverFilterOptions(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const [{results:tracks},{results:handicaps}] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT t.id,t.canonical_name AS name FROM tracks t JOIN races r ON r.track_id=t.id JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.scratched=0 AND re.driver_id IS NOT NULL ORDER BY t.canonical_name COLLATE NOCASE,t.id`).all(),
    env.DB.prepare(`SELECT DISTINCT re.handicap_m AS meters FROM race_entries re JOIN races r ON r.id=re.race_id JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.scratched=0 AND re.driver_id IS NOT NULL AND ${canonicalStartMethodSql('r')}='volt' AND re.actual_start_distance_m IS NOT NULL AND r.distance_m IS NOT NULL AND re.actual_start_distance_m-r.distance_m=re.handicap_m AND re.handicap_m>=0 AND re.handicap_m%20=0 ORDER BY re.handicap_m`).all()
  ]);
  return {tracks:tracks||[],distanceGroups:[640,1640,2140,2640,3140,3640,4140,'other-long'],handicapBuckets:(handicaps||[]).map(row=>Number(row.meters))};
}
