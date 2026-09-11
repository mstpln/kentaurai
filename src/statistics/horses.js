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

const PERIODS = new Set(['all', '2w', '4w', '3m', '6m', '1y']);
const DISTANCES = new Set(['all', '640', '1640', '2140', '2640', '3140', '3640', '4140', 'other-long']);
const DISTANCE_STANDARDS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const DISTANCE_TOLERANCE_M = 100;
const SEX_VALUES = new Set(['all', 'mare', 'stallion', 'gelding']);

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

function addHorseFilters(conditions, bindings, filters, { raceAlias = 'r', horseAlias = 'h' } = {}) {
  if (filters.period !== 'all') {
    const window = trendDateWindow(filters.period, filters.asOfDate);
    conditions.push(`${raceAlias}.race_date >= ?`, `${raceAlias}.race_date <= ?`);
    bindings.push(window.startDate, window.endDate);
  }
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
}

export function normalizeHorseStatsFilters(options = {}) {
  const asOfDate = options.asOfDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return {
    period: normalizePeriod(options.period),
    asOfDate,
    raceScope: normalizeTrendRaceScope(options.raceScope),
    trackId: normalizeTrackId(options.trackId),
    raceType: normalizeTrendRaceType(options.raceType),
    breedType: normalizeTrendBreed(options.breedType),
    startMethod: normalizeTrendStartMethod(options.startMethod),
    distanceGroup: normalizeDistance(options.distanceGroup),
    sex: normalizeSex(options.sex),
    age: normalizeAge(options.age),
    minStarts: normalizeTrendMinStarts(options.minStarts)
  };
}

async function validateTrack(env, id) {
  if (!id) return;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(id).first();
  if (!row?.ok) throw new Error('track_id does not identify a stored track');
}

function metricOrder(metric) {
  if (metric === 'winRate') return '(wins * 1.0 / starts) DESC, wins DESC, starts DESC, entity_id ASC';
  if (metric === 'top3Rate') return '(top3 * 1.0 / result_starts) DESC, top3 DESC, result_starts DESC, entity_id ASC';
  if (metric === 'earningsPerVerifiedStart') return '(prize_sek * 1.0 / prize_verified_starts) DESC, prize_sek DESC, prize_verified_starts DESC, entity_id ASC';
  throw new Error('unsupported core ranking metric');
}

function buildCoreRanking(filters, metric) {
  const conditions = ['re.scratched = 0'];
  const bindings = [];
  addHorseFilters(conditions, bindings, filters);
  const minimumCondition = filters.minStarts == null ? 'starts > 0' : 'starts >= ?';
  if (filters.minStarts != null) bindings.push(filters.minStarts);
  const sql = `
    WITH horse_stats AS (
      SELECT h.id AS entity_id, h.canonical_name AS name, ${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY h.id, h.canonical_name
    )
    SELECT * FROM horse_stats
    WHERE ${minimumCondition}${metric === 'top3Rate' ? ' AND result_starts > 0' : ''}${metric === 'earningsPerVerifiedStart' ? ' AND prize_verified_starts > 0' : ''}
    ORDER BY ${metricOrder(metric)} LIMIT 10`;
  return { sql, bindings };
}

function xlabsSecondsSql(column) {
  return `(CAST(substr(${column},1,instr(${column},'.')-1) AS REAL)*60 + CAST(substr(${column},instr(${column},'.')+1,2) AS REAL) + CAST(substr(${column},instr(${column},',')+1,1) AS REAL)/10.0)`;
}

function buildXlabsRanking(filters, column) {
  const conditions = ['re.scratched = 0', `x.${column} IS NOT NULL`];
  const bindings = [];
  addHorseFilters(conditions, bindings, filters);
  const minimum = filters.minStarts == null ? 'measurements > 0' : 'measurements >= ?';
  if (filters.minStarts != null) bindings.push(filters.minStarts);
  return {
    sql: `WITH latest_x AS (
      SELECT x.*, ROW_NUMBER() OVER(PARTITION BY x.race_entry_id ORDER BY sr.fetched_at DESC, x.id DESC) AS observation_rank
      FROM xlabs_data x
      JOIN source_records sr ON sr.id = x.source_record_id
      WHERE x.quality_status = 'xlabs-telemetry-v1'
    ), measured AS (
      SELECT h.id AS entity_id,h.canonical_name AS name,COUNT(*) AS measurements,AVG(${xlabsSecondsSql(`x.${column}`)}) AS avg_seconds
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      JOIN latest_x x ON x.race_entry_id = re.id AND x.observation_rank = 1
      WHERE ${conditions.join(' AND ')}
      GROUP BY h.id,h.canonical_name
    ) SELECT * FROM measured WHERE ${minimum} ORDER BY avg_seconds ASC,measurements DESC,entity_id ASC LIMIT 10`,
    bindings
  };
}

function buildFormQuery(filters, horseId = null, limit = true) {
  const conditions = ['re.scratched = 0', 'rr.placing IS NOT NULL', 'rr.placing > 0'];
  const bindings = [];
  if (horseId) {
    conditions.push('h.id = ?');
    bindings.push(horseId);
  }
  addHorseFilters(conditions, bindings, filters);
  return {
    sql: `WITH ranked AS (
      SELECT h.id AS entity_id,h.canonical_name AS name,rr.placing,
        ROW_NUMBER() OVER(PARTITION BY h.id ORDER BY r.race_date DESC,COALESCE(r.race_number,0) DESC,re.id DESC) AS rn
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      WHERE ${conditions.join(' AND ')}
    ), form AS (
      SELECT entity_id,name,COUNT(*) AS used_starts,AVG(placing*1.0) AS avg_placing FROM ranked WHERE rn <= 10 GROUP BY entity_id,name
    ) SELECT * FROM form ORDER BY avg_placing ASC,used_starts DESC,entity_id ASC${limit ? ' LIMIT 10' : ''}`,
    bindings
  };
}

function restSequenceCte() {
  return `WITH actual AS (
    SELECT h.id AS entity_id,h.canonical_name AS name,h.sex,h.birth_year,h.breed,
      r.id AS id,r.id AS race_id,r.track_id,r.race_date,r.race_number,r.distance_m,r.start_method,r.first_prize_sek,r.race_name,r.main_class,r.class_flags_json,
      re.id AS race_entry_id,rr.placing,rr.prize_sek,rr.gallop,rr.disqualified,
      CAST(julianday(r.race_date)-julianday(LAG(r.race_date) OVER(PARTITION BY h.id ORDER BY r.race_date,r.race_number,re.id)) AS INTEGER) AS days_since_previous
    FROM races r
    JOIN race_entries re ON re.race_id = r.id
    JOIN race_results rr ON rr.race_entry_id = re.id
    JOIN horses h ON h.id = re.horse_id
    WHERE re.scratched = 0
  ), staged AS (
    SELECT *,LAG(days_since_previous) OVER(PARTITION BY entity_id ORDER BY race_date,race_number,race_entry_id) AS previous_gap FROM actual
  )`;
}

function buildRestRanking(filters, kind) {
  const conditions = [];
  const bindings = [];
  addHorseFilters(conditions, bindings, filters, { raceAlias: 's', horseAlias: 's' });
  conditions.push(kind === 'first' ? 's.days_since_previous >= 60' : 's.previous_gap >= 60 AND s.days_since_previous < 60');
  const minimum = filters.minStarts == null ? '' : ' HAVING COUNT(*) >= ?';
  if (filters.minStarts != null) bindings.push(filters.minStarts);
  return {
    sql: `${restSequenceCte()}, rest_stats AS (
      SELECT s.entity_id,s.name,COUNT(*) AS starts,SUM(CASE WHEN s.placing=1 THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN s.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
      FROM staged s WHERE ${conditions.join(' AND ')} GROUP BY s.entity_id,s.name${minimum}
    ) SELECT *,wins*1.0/starts AS win_rate,top3*1.0/starts AS top3_rate FROM rest_stats ORDER BY win_rate DESC,wins DESC,starts DESC,entity_id ASC LIMIT 10`,
    bindings
  };
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

function mapRestRanking(rows) {
  return rows.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,starts:Number(row.starts),wins:Number(row.wins),top3:Number(row.top3),winRate:Number(row.win_rate),top3Rate:Number(row.top3_rate)}));
}

export async function getHorseRankings(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const filters = normalizeHorseStatsFilters(options);
  await validateTrack(env, filters.trackId);
  const [win,top3,earnings,form,start,close,firstRest,secondRest] = await Promise.all([
    run(env,buildCoreRanking(filters,'winRate')),
    run(env,buildCoreRanking(filters,'top3Rate')),
    run(env,buildCoreRanking(filters,'earningsPerVerifiedStart')),
    run(env,buildFormQuery(filters)),
    run(env,buildXlabsRanking(filters,'first_200_time')),
    run(env,buildXlabsRanking(filters,'last_400_time')),
    run(env,buildRestRanking(filters,'first')),
    run(env,buildRestRanking(filters,'second'))
  ]);
  return {
    filters,
    rankings:{
      highestWinRate:mapCoreRanking(win,'winRate'),
      highestTop3Rate:mapCoreRanking(top3,'top3Rate'),
      bestFormLast10:form.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,usedStarts:Number(row.used_starts),averagePlacing:Number(row.avg_placing)})),
      highestEarningsPerStart:mapCoreRanking(earnings,'earningsPerVerifiedStart'),
      fastestFirst200:start.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,measurements:Number(row.measurements),averageSeconds:Number(row.avg_seconds)})),
      strongestLast400:close.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,measurements:Number(row.measurements),averageSeconds:Number(row.avg_seconds)})),
      firstAfterRest:mapRestRanking(firstRest),
      secondAfterRest:mapRestRanking(secondRest),
      highestStartPoints:null
    },
    startPointsStatus:'unverified_official_semantics'
  };
}

function aggregateRest(rows) {
  if (!rows.length) return {starts:0,wins:0,top3:0,winRate:null,top3Rate:null,placements:[]};
  const wins = rows.filter((row) => Number(row.placing) === 1).length;
  const top3 = rows.filter((row) => Number(row.placing) >= 1 && Number(row.placing) <= 3).length;
  return {
    starts:rows.length,
    wins,
    top3,
    winRate:wins/rows.length,
    top3Rate:top3/rows.length,
    placements:rows.map((row)=>({raceEntryId:row.race_entry_id,date:row.race_date,placing:row.placing==null?null:Number(row.placing),daysSincePrevious:row.days_since_previous==null?null:Number(row.days_since_previous)}))
  };
}

export async function getHorseDetailStatistics(env, horseId, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(horseId || '').trim();
  if (!id) throw new Error('horse id is required');
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM horses WHERE id = ? LIMIT 1').bind(id).first();
  if (!exists?.ok) return null;
  const filters = normalizeHorseStatsFilters(options);
  await validateTrack(env,filters.trackId);

  const conditions = ['re.scratched = 0','h.id = ?'];
  const bindings = [id];
  addHorseFilters(conditions,bindings,filters);
  const summaryRow = await env.DB.prepare(`SELECT ${coreMetricSelectSql('rr')} FROM races r JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id JOIN horses h ON h.id=re.horse_id WHERE ${conditions.join(' AND ')}`).bind(...bindings).first();

  const restConditions = ['s.entity_id = ?'];
  const restBindings = [id];
  addHorseFilters(restConditions,restBindings,filters,{raceAlias:'s',horseAlias:'s'});
  const {results:restRows} = await env.DB.prepare(`${restSequenceCte()} SELECT * FROM staged s WHERE ${restConditions.join(' AND ')} ORDER BY s.race_date ASC,s.race_number ASC,s.race_entry_id ASC`).bind(...restBindings).all();
  const firstRows = (restRows||[]).filter((row)=>row.days_since_previous!=null&&Number(row.days_since_previous)>=60);
  const secondRows = (restRows||[]).filter((row)=>row.previous_gap!=null&&Number(row.previous_gap)>=60&&row.days_since_previous!=null&&Number(row.days_since_previous)<60);
  const formRows = await run(env,buildFormQuery({...filters,minStarts:null},id,false));
  const ownForm = formRows[0];

  return {
    horseId:id,
    filters,
    summary:mapCoreMetricRow(summaryRow||{}),
    formLast10:ownForm?{usedStarts:Number(ownForm.used_starts),averagePlacing:Number(ownForm.avg_placing)}:null,
    firstAfterRest:aggregateRest(firstRows),
    secondAfterRest:aggregateRest(secondRows),
    currentStartPoints:null,
    startPointHistory:[],
    startPointsStatus:'unverified_official_semantics'
  };
}

export async function getHorseFilterOptions(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const [{results:tracks},{results:years}] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT t.id,t.canonical_name AS name FROM tracks t JOIN races r ON r.track_id=t.id JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.scratched=0 ORDER BY t.canonical_name COLLATE NOCASE,t.id`).all(),
    env.DB.prepare(`SELECT DISTINCT birth_year FROM horses WHERE birth_year IS NOT NULL ORDER BY birth_year DESC`).all()
  ]);
  return {tracks:tracks||[],birthYears:(years||[]).map((row)=>Number(row.birth_year)),distanceGroups:[640,1640,2140,2640,3140,3640,4140,'other-long']};
}
