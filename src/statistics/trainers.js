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
import { DRIVER_LONGSHOT_PERCENT_MAX, DRIVER_MARKET_DEFINITION_VERSION } from './driver-features.js';

const PERIODS = new Set(['all', '2w', '4w', '3m', '6m', '1y']);
const DISTANCES = new Set(['all', '640', '1640', '2140', '2640', '3140', '3640', '4140', 'other-long']);
const DISTANCE_STANDARDS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const DISTANCE_TOLERANCE_M = 100;
const VOLT_LANES = new Set(['all', 'good', 'other']);
const SEX_VALUES = new Set(['all', 'mare', 'stallion', 'gelding']);
const DISTANCE_PROFILE_VERSION = 'canonical-distance-profile-v1';
const REST_DAYS = 60;

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

function addTrainerFilters(conditions, bindings, filters, { includePeriod = true, raceAlias = 'r', entryAlias = 're', horseAlias = 'h' } = {}) {
  if (includePeriod && filters.period !== 'all') {
    const window = trendDateWindow(filters.period, filters.asOfDate);
    conditions.push(`${raceAlias}.race_date >= ?`, `${raceAlias}.race_date <= ?`);
    bindings.push(window.startDate, window.endDate);
  } else if (includePeriod) {
    conditions.push(`${raceAlias}.race_date <= ?`);
    bindings.push(filters.asOfDate);
  }
  if (filters.trackId) { conditions.push(`${raceAlias}.track_id = ?`); bindings.push(filters.trackId); }
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
    conditions.push(filters.voltLane === 'good' ? `${entryAlias}.actual_lane IN (1,6,7)` : `${entryAlias}.actual_lane IS NOT NULL AND ${entryAlias}.actual_lane NOT IN (1,6,7)`);
  }
  if (filters.handicapM != null) {
    conditions.push(`${canonicalStartMethodSql(raceAlias)} = 'volt'`, `${entryAlias}.handicap_m = ?`, `${entryAlias}.actual_start_distance_m IS NOT NULL`, `${raceAlias}.distance_m IS NOT NULL`, `${entryAlias}.actual_start_distance_m - ${raceAlias}.distance_m = ${entryAlias}.handicap_m`);
    bindings.push(filters.handicapM);
  }
}

export function normalizeTrainerStatsFilters(options = {}) {
  return {
    period: normalizePeriod(options.period), asOfDate: options.asOfDate || stockholmDateKey(),
    raceScope: normalizeTrendRaceScope(options.raceScope), trackId: normalizeTrackId(options.trackId),
    raceType: normalizeTrendRaceType(options.raceType), breedType: normalizeTrendBreed(options.breedType),
    startMethod: normalizeTrendStartMethod(options.startMethod), distanceGroup: normalizeDistance(options.distanceGroup),
    sex: normalizeSex(options.sex), age: normalizeAge(options.age), minStarts: normalizeTrendMinStarts(options.minStarts),
    voltLane: normalizeVoltLane(options.voltLane), handicapM: normalizeHandicap(options.handicapM)
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
  throw new Error('unsupported trainer ranking metric');
}

function buildCoreRanking(filters, metric, extraConditions = [], { includePeriod = true, applyMinimumStarts = null } = {}) {
  const conditions = ['re.scratched = 0', 're.trainer_id IS NOT NULL', ...extraConditions];
  const bindings = [];
  addTrainerFilters(conditions, bindings, filters, { includePeriod });
  if (!includePeriod) {
    const year = Number(filters.asOfDate.slice(0, 4));
    conditions.push('r.race_date >= ?', 'r.race_date <= ?');
    bindings.push(`${year}-01-01`, filters.asOfDate);
  }
  const useMinimum = applyMinimumStarts == null ? (metric === 'winRate' || metric === 'top3Rate') : applyMinimumStarts;
  const minimum = useMinimum && filters.minStarts != null ? 'starts >= ?' : 'starts > 0';
  if (useMinimum && filters.minStarts != null) bindings.push(filters.minStarts);
  let denominator = '';
  if (metric === 'top3Rate') denominator = ' AND result_starts > 0';
  if (metric === 'earningsPerVerifiedStart' || metric === 'earnings') denominator = ' AND prize_verified_starts > 0';
  return {
    sql: `WITH trainer_stats AS (
      SELECT t.id AS entity_id,t.canonical_name AS name,${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id=r.id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN horses h ON h.id=re.horse_id
      JOIN trainers t ON t.id=re.trainer_id
      WHERE ${conditions.join(' AND ')} GROUP BY t.id,t.canonical_name
    ) SELECT * FROM trainer_stats WHERE ${minimum}${denominator} ORDER BY ${orderFor(metric)} LIMIT 10`, bindings
  };
}

function buildFormQuery(filters, trainerId = null, limit = true) {
  const conditions = ['re.scratched=0','re.trainer_id IS NOT NULL','rr.placing IS NOT NULL','rr.placing > 0'];
  const bindings = [];
  if (trainerId) { conditions.push('t.id=?'); bindings.push(trainerId); }
  addTrainerFilters(conditions, bindings, filters);
  return { sql:`WITH ranked AS (
    SELECT t.id AS entity_id,t.canonical_name AS name,rr.placing,
      ROW_NUMBER() OVER(PARTITION BY t.id ORDER BY r.race_date DESC,COALESCE(r.race_number,0) DESC,re.id DESC) AS rn
    FROM races r INDEXED BY idx_races_date JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id JOIN trainers t ON t.id=re.trainer_id WHERE ${conditions.join(' AND ')}
  ), form AS (SELECT entity_id,name,COUNT(*) AS used_starts,AVG(placing*1.0) AS avg_placing FROM ranked WHERE rn<=30 GROUP BY entity_id,name)
  SELECT * FROM form ORDER BY avg_placing ASC,used_starts DESC,entity_id ASC${limit?' LIMIT 10':''}`, bindings };
}

function marketAtStopCte() {
  return `market_candidates AS (
    SELECT bs.race_entry_id,bs.bet_percent,bs.market_rank,bs.captured_at,bs.id,
      ROW_NUMBER() OVER(PARTITION BY bs.race_entry_id ORDER BY julianday(bs.captured_at) DESC,bs.id DESC) AS rn
    FROM betting_snapshots bs JOIN game_rounds gr ON gr.id=bs.game_round_id
    JOIN game_legs gl ON gl.game_round_id=gr.id AND gl.leg_number=bs.leg_number
    JOIN race_entries mre ON mre.id=bs.race_entry_id AND mre.race_id=gl.race_id
    WHERE gr.bet_stop_at IS NOT NULL AND bs.source_record_id IS NOT NULL AND julianday(bs.captured_at)<=julianday(gr.bet_stop_at)
  ), market_at_stop AS (SELECT race_entry_id,bet_percent,market_rank,captured_at FROM market_candidates WHERE rn=1)`;
}
function buildMarketRanking(filters, kind, trainerId = null, limit = true) {
  const conditions=['re.scratched=0','re.trainer_id IS NOT NULL']; const bindings=[];
  if (trainerId) { conditions.push('t.id=?'); bindings.push(trainerId); }
  addTrainerFilters(conditions,bindings,filters);
  if (kind==='favorite') conditions.push('m.market_rank=1');
  else { conditions.push('m.bet_percent IS NOT NULL','m.bet_percent >= 0','m.bet_percent <= ?'); bindings.push(DRIVER_LONGSHOT_PERCENT_MAX); }
  const min = filters.minStarts == null || trainerId ? 'starts > 0' : 'starts >= ?';
  if (filters.minStarts != null && !trainerId) bindings.push(filters.minStarts);
  return { sql:`WITH ${marketAtStopCte()}, stats AS (
    SELECT t.id AS entity_id,t.canonical_name AS name,${coreMetricSelectSql('rr')}
    FROM races r INDEXED BY idx_races_date JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id JOIN trainers t ON t.id=re.trainer_id JOIN market_at_stop m ON m.race_entry_id=re.id
    WHERE ${conditions.join(' AND ')} GROUP BY t.id,t.canonical_name
  ) SELECT * FROM stats WHERE ${min} ORDER BY (wins*1.0/starts) DESC,wins DESC,starts DESC,entity_id ASC${limit?' LIMIT 10':''}`, bindings };
}

function verifiedHomeTrackCte() {
  return `latest_trainer_observation AS (
    SELECT o.entity_id AS trainer_id,o.fields_json,
      ROW_NUMBER() OVER(PARTITION BY o.entity_id ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC) AS rn
    FROM normalized_observations o JOIN source_records sr ON sr.id=o.source_record_id
    WHERE o.entity_type='trainer' AND sr.source_type='official_provider'
  ), trainer_home AS (
    SELECT lto.trainer_id,tei.track_id AS home_track_id
    FROM latest_trainer_observation lto
    JOIN track_external_ids tei
      ON tei.source_type='official'
      AND tei.external_id=CAST(json_extract(lto.fields_json,'$.homeTrackExternalId') AS TEXT)
    WHERE lto.rn=1
      AND json_valid(lto.fields_json)
      AND json_extract(lto.fields_json,'$.homeTrackExternalId') IS NOT NULL
  )`;
}
function buildHomeRanking(filters, home) {
  const condition = home
    ? 'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id=r.track_id)'
    : 'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id<>r.track_id)';
  const query = buildCoreRanking(filters,'winRate',[condition],{applyMinimumStarts:true});
  query.sql=query.sql.replace(/^WITH /,`WITH ${verifiedHomeTrackCte()}, `);
  return query;
}

function restSequenceCte() {
  return `actual AS (
    SELECT h.id AS horse_id,h.sex,h.birth_year,h.breed,t.id AS entity_id,t.canonical_name AS name,
      r.id,r.track_id,r.race_date,r.race_number,r.distance_m,r.start_method,r.first_prize_sek,r.race_name,r.main_class,r.class_flags_json,
      re.id AS race_entry_id,re.actual_lane,re.handicap_m,re.actual_start_distance_m,rr.placing,rr.prize_sek,rr.gallop,rr.disqualified,
      CAST(julianday(r.race_date)-julianday(LAG(r.race_date) OVER(PARTITION BY h.id ORDER BY r.race_date,r.race_number,re.id)) AS INTEGER) AS days_since_previous
    FROM races r JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id JOIN trainers t ON t.id=re.trainer_id WHERE re.scratched=0
  ), staged AS (
    SELECT *,LAG(days_since_previous) OVER(PARTITION BY horse_id ORDER BY race_date,race_number,race_entry_id) AS previous_gap FROM actual
  )`;
}
function addStagedFilters(conditions,bindings,filters) {
  if (filters.period !== 'all') { const w=trendDateWindow(filters.period,filters.asOfDate); conditions.push('s.race_date>=?','s.race_date<=?'); bindings.push(w.startDate,w.endDate); }
  else { conditions.push('s.race_date<=?'); bindings.push(filters.asOfDate); }
  if (filters.trackId) { conditions.push('s.track_id=?'); bindings.push(filters.trackId); }
  if (filters.startMethod!=='all') conditions.push(`${canonicalStartMethodSql('s')}='${filters.startMethod}'`);
  if (filters.raceType==='monte') conditions.push(monteRaceCondition('s'));
  if (filters.raceType==='sulky') conditions.push(`NOT ${monteRaceCondition('s')}`);
  if (filters.breedType==='warmblood') conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%warmblood%')");
  if (filters.breedType==='coldblood') conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%coldblood%')");
  if (filters.sex==='mare') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('sto','mare','female','f')");
  if (filters.sex==='stallion') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('hingst','stallion','male','m')");
  if (filters.sex==='gelding') conditions.push("LOWER(COALESCE(s.sex,'')) IN ('valack','gelding')");
  if (filters.age!=null) { conditions.push('CAST(substr(?,1,4) AS INTEGER)-s.birth_year=?'); bindings.push(filters.asOfDate,filters.age); }
  addDistanceCondition(conditions,bindings,filters.distanceGroup,'s');
  addCanonicalRaceScopeCondition(conditions,filters.raceScope,'s');
  if (filters.voltLane!=='all') {
    conditions.push(`${canonicalStartMethodSql('s')}='volt'`);
    conditions.push(filters.voltLane==='good'?'s.actual_lane IN (1,6,7)':'s.actual_lane IS NOT NULL AND s.actual_lane NOT IN (1,6,7)');
  }
  if (filters.handicapM!=null) {
    conditions.push(`${canonicalStartMethodSql('s')}='volt'`,'s.handicap_m=?','s.actual_start_distance_m IS NOT NULL','s.distance_m IS NOT NULL','s.actual_start_distance_m-s.distance_m=s.handicap_m');
    bindings.push(filters.handicapM);
  }
}
function buildRestRanking(filters,kind,trainerId=null,limit=true) {
  const conditions=[];const bindings=[];
  if (trainerId){conditions.push('s.entity_id=?');bindings.push(trainerId);}
  addStagedFilters(conditions,bindings,filters);
  conditions.push(kind==='first'?`s.days_since_previous>=${REST_DAYS}`:`s.previous_gap>=${REST_DAYS} AND s.days_since_previous<${REST_DAYS}`);
  const minimum=!trainerId&&filters.minStarts!=null?'HAVING COUNT(*)>=?':''; if(!trainerId&&filters.minStarts!=null)bindings.push(filters.minStarts);
  return {sql:`WITH ${restSequenceCte()}, stats AS (
    SELECT s.entity_id,s.name,COUNT(*) AS starts,SUM(CASE WHEN s.placing=1 THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN s.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
    FROM staged s WHERE ${conditions.join(' AND ')} GROUP BY s.entity_id,s.name ${minimum}
  ) SELECT *,wins*1.0/starts AS win_rate,top3*1.0/starts AS top3_rate FROM stats ORDER BY win_rate DESC,wins DESC,starts DESC,entity_id ASC${limit?' LIMIT 10':''}`,bindings};
}

function profileCondition(kind) {
  if (kind==='short') return '(r.distance_m BETWEEN 540 AND 740 OR r.distance_m BETWEEN 1540 AND 1740)';
  if (kind==='medium') return 'r.distance_m BETWEEN 2040 AND 2240';
  return '(r.distance_m >= 2540)';
}
function buildDistanceProfileRanking(filters,kind){return buildCoreRanking({...filters,distanceGroup:'all'},'winRate',[profileCondition(kind)],{applyMinimumStarts:true});}
function buildHandicapRanking(filters){return buildCoreRanking(filters,'winRate',[`${canonicalStartMethodSql('r')}='volt'`,'re.handicap_m>0','re.actual_start_distance_m IS NOT NULL','r.distance_m IS NOT NULL','re.actual_start_distance_m-r.distance_m=re.handicap_m'],{applyMinimumStarts:true});}

async function run(env,q){const {results}=await env.DB.prepare(q.sql).bind(...q.bindings).all();return results||[];}
function mapCoreRanking(rows,metric){return rows.map((row,index)=>{const core=mapCoreMetricRow(row);return{rank:index+1,id:row.entity_id,name:row.name,...core,earningsPerVerifiedStart:core.prizeVerifiedStarts?core.prizeSek/core.prizeVerifiedStarts:null,rankingMetric:metric};});}
function mapRest(rows){return rows.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,starts:Number(row.starts),wins:Number(row.wins),top3:Number(row.top3),winRate:Number(row.win_rate),top3Rate:Number(row.top3_rate)}));}
function mapForm(rows){return rows.map((row,index)=>({rank:index+1,id:row.entity_id,name:row.name,usedStarts:Number(row.used_starts),averagePlacing:Number(row.avg_placing)}));}

export async function getTrainerRankings(env,options={}){
  if(!env.DB)throw new Error('DB is not configured');const f=normalizeTrainerStatsFilters(options);await validateTrack(env,f.trackId);
  const [win,top3,wins,form,annual,perStart,auto,volt,goodVolt,otherVolt,handicap,home,away,short,medium,long,favorite,longshot,firstRest,secondRest]=await Promise.all([
    run(env,buildCoreRanking(f,'winRate')),run(env,buildCoreRanking(f,'top3Rate')),run(env,buildCoreRanking(f,'wins')),run(env,buildFormQuery(f)),
    run(env,buildCoreRanking(f,'earnings',[],{includePeriod:false})),run(env,buildCoreRanking(f,'earningsPerVerifiedStart')),
    run(env,buildCoreRanking(f,'winRate',[`${canonicalStartMethodSql('r')}='auto'`],{applyMinimumStarts:true})),
    run(env,buildCoreRanking(f,'winRate',[`${canonicalStartMethodSql('r')}='volt'`],{applyMinimumStarts:true})),
    run(env,buildCoreRanking(f,'winRate',[`${canonicalStartMethodSql('r')}='volt'`,'re.actual_lane IN (1,6,7)'],{applyMinimumStarts:true})),
    run(env,buildCoreRanking(f,'winRate',[`${canonicalStartMethodSql('r')}='volt'`,'re.actual_lane IS NOT NULL','re.actual_lane NOT IN (1,6,7)'],{applyMinimumStarts:true})),
    run(env,buildHandicapRanking(f)),run(env,buildHomeRanking(f,true)),run(env,buildHomeRanking(f,false)),
    run(env,buildDistanceProfileRanking(f,'short')),run(env,buildDistanceProfileRanking(f,'medium')),run(env,buildDistanceProfileRanking(f,'long')),
    run(env,buildMarketRanking(f,'favorite')),run(env,buildMarketRanking(f,'longshot')),run(env,buildRestRanking(f,'first')),run(env,buildRestRanking(f,'second'))
  ]);
  return {filters:f,definitions:{longshotPercentMax:DRIVER_LONGSHOT_PERCENT_MAX,market:DRIVER_MARKET_DEFINITION_VERSION,voltLaneGood:[1,6,7],restDays:REST_DAYS,distanceProfile:DISTANCE_PROFILE_VERSION},rankings:{
    highestWinRate:mapCoreRanking(win,'winRate'),highestTop3Rate:mapCoreRanking(top3,'top3Rate'),mostWins:mapCoreRanking(wins,'wins'),bestFormLast30:mapForm(form),
    mostEarningsThisYear:mapCoreRanking(annual,'earnings'),highestEarningsPerStart:mapCoreRanking(perStart,'earningsPerVerifiedStart'),bestAuto:mapCoreRanking(auto,'winRate'),bestVolt:mapCoreRanking(volt,'winRate'),
    bestGoodVoltLane:mapCoreRanking(goodVolt,'winRate'),bestOtherVoltLane:mapCoreRanking(otherVolt,'winRate'),bestWithHandicap:mapCoreRanking(handicap,'winRate'),
    bestHomeTrack:mapCoreRanking(home,'winRate'),bestOtherTracks:mapCoreRanking(away,'winRate'),bestShortDistance:mapCoreRanking(short,'winRate'),bestMediumDistance:mapCoreRanking(medium,'winRate'),bestLongDistance:mapCoreRanking(long,'winRate'),
    favoriteResults:mapCoreRanking(favorite,'winRate'),longshotResults:mapCoreRanking(longshot,'winRate'),firstAfterRest:mapRest(firstRest),secondAfterRest:mapRest(secondRest)
  }};
}

async function trainerSummary(env,f,id){const c=['re.scratched=0','t.id=?'],b=[id];addTrainerFilters(c,b,f);const row=await env.DB.prepare(`SELECT ${coreMetricSelectSql('rr')} FROM races r INDEXED BY idx_races_date JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id JOIN horses h ON h.id=re.horse_id JOIN trainers t ON t.id=re.trainer_id WHERE ${c.join(' AND ')}`).bind(...b).first();return mapCoreMetricRow(row||{});}
function marketSummary(rows){if(!rows.length)return{starts:0,resultStarts:0,wins:0,losses:0,top3:0,prizeVerifiedStarts:0,prizeSek:null,winRate:null,top3Rate:null};const c=mapCoreMetricRow(rows[0]);return{...c,earningsPerVerifiedStart:c.prizeVerifiedStarts?c.prizeSek/c.prizeVerifiedStarts:null};}
function restSummary(rows){if(!rows.length)return{starts:0,wins:0,top3:0,winRate:null,top3Rate:null};const r=rows[0];return{starts:Number(r.starts),wins:Number(r.wins),top3:Number(r.top3),winRate:Number(r.win_rate),top3Rate:Number(r.top3_rate)};}
async function homeSummary(env,f,id,home){const c=home?'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id=r.track_id)':'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id<>r.track_id)';const conditions=['re.scratched=0','t.id=?',c],bindings=[id];addTrainerFilters(conditions,bindings,f);const row=await env.DB.prepare(`WITH ${verifiedHomeTrackCte()} SELECT ${coreMetricSelectSql('rr')} FROM races r INDEXED BY idx_races_date JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id JOIN horses h ON h.id=re.horse_id JOIN trainers t ON t.id=re.trainer_id WHERE ${conditions.join(' AND ')}`).bind(...bindings).first();return mapCoreMetricRow(row||{});}

export async function getTrainerDetailStatistics(env,trainerId,options={}){
  if(!env.DB)throw new Error('DB is not configured');const f=normalizeTrainerStatsFilters(options);await validateTrack(env,f.trackId);
  const trainer=await env.DB.prepare('SELECT id,canonical_name AS name FROM trainers WHERE id=? LIMIT 1').bind(trainerId).first();if(!trainer)return null;
  const [summary,form,favorite,longshot,home,away,firstRest,secondRest]=await Promise.all([
    trainerSummary(env,f,trainerId),run(env,buildFormQuery(f,trainerId,false)),run(env,buildMarketRanking(f,'favorite',trainerId,false)),run(env,buildMarketRanking(f,'longshot',trainerId,false)),
    homeSummary(env,f,trainerId,true),homeSummary(env,f,trainerId,false),run(env,buildRestRanking(f,'first',trainerId,false)),run(env,buildRestRanking(f,'second',trainerId,false))
  ]);
  return {trainer,filters:f,summary,formLast30:form[0]?{usedStarts:Number(form[0].used_starts),averagePlacing:Number(form[0].avg_placing)}:null,
    favoriteResults:marketSummary(favorite),longshotResults:marketSummary(longshot),homeTrackResults:home,otherTrackResults:away,firstAfterRest:restSummary(firstRest),secondAfterRest:restSummary(secondRest),
    definitions:{longshotPercentMax:DRIVER_LONGSHOT_PERCENT_MAX,market:DRIVER_MARKET_DEFINITION_VERSION,voltLaneGood:[1,6,7],restDays:REST_DAYS,distanceProfile:DISTANCE_PROFILE_VERSION}};
}

export async function getTrainerFilterOptions(env){if(!env.DB)throw new Error('DB is not configured');const[{results:tracks},{results:handicaps}]=await Promise.all([
  env.DB.prepare(`SELECT DISTINCT t.id,t.canonical_name AS name FROM tracks t JOIN races r ON r.track_id=t.id JOIN race_entries re ON re.race_id=r.id JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.scratched=0 AND re.trainer_id IS NOT NULL ORDER BY t.canonical_name COLLATE NOCASE,t.id`).all(),
  env.DB.prepare(`SELECT DISTINCT re.handicap_m AS meters FROM race_entries re JOIN races r ON r.id=re.race_id JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.scratched=0 AND re.trainer_id IS NOT NULL AND ${canonicalStartMethodSql('r')}='volt' AND re.actual_start_distance_m IS NOT NULL AND r.distance_m IS NOT NULL AND re.actual_start_distance_m-r.distance_m=re.handicap_m AND re.handicap_m>=0 AND re.handicap_m%20=0 ORDER BY re.handicap_m`).all()
]);return{tracks:tracks||[],distanceGroups:[640,1640,2140,2640,3140,3640,4140,'other-long'],ageOptions:Array.from({length:29},(_,i)=>i+2),handicapBuckets:(handicaps||[]).map(r=>Number(r.meters))};}
