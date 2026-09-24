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
import { getHorseCurrentStartPoint } from './statistics/horse-start-points.js';
import { XLABS_TRIP_CLASSIFICATION_VERSION } from './xlabs-trip-classification-v1.js';
import {
  calculateHorseFormIndex,
  fieldPercentileScore,
  parsePaceSeconds,
  prizeDifficultyScore,
  relativeChallengeScore,
  resultPerformanceScore,
  weightedAvailable
} from './statistics/horse-form-index.js';
import {
  PERSON_FORM_MAX_STARTS,
  calculateDriverFormIndex,
  calculateTrainerFormIndex,
  marketExpectationPerformanceScore,
  trainerDevelopmentScore
} from './statistics/person-form-index.js';

const DISTANCES = new Set(['all','640','1640','2140','2640','3140','3640','4140','other-long']);
const DISTANCE_STANDARDS = [640,1640,2140,2640,3140,3640,4140];
const VOLT_LANES = new Set(['all','good','other']);
const SEX_VALUES = new Set(['all','mare','stallion','gelding']);
const DISTANCE_TOLERANCE_M = 100;
const REST_DAYS = 60;

const ENTITY_CONFIG = Object.freeze({
  trainers:{table:'trainers',entryColumn:'trainer_id',entryIndex:'idx_entries_trainer',resultKey:'trainer',formLimit:30,market:true,rest:true,volt:true},
  drivers:{table:'drivers',entryColumn:'driver_id',entryIndex:'idx_entries_driver',resultKey:'driver',formLimit:30,market:true,rest:false,volt:true},
  horses:{table:'horses',entryColumn:'horse_id',entryIndex:'idx_entries_horse_race',resultKey:'horse',formLimit:5,market:false,rest:true,volt:false}
});

function configFor(entityType){
  const config=ENTITY_CONFIG[entityType];
  if(!config) throw new Error('unsupported detail entity type');
  return config;
}

function normalizeYear(value,asOfDate){
  const fallback=Number(String(asOfDate).slice(0,4));
  if(value==null||value==='') return fallback;
  const text=String(value).trim();
  if(!/^\d{4}$/.test(text)) throw new Error('year must be a four-digit year');
  const year=Number(text);
  if(year<1900||year>2200) throw new Error('year is outside the supported range');
  return year;
}
function normalizeDistance(value){const v=String(value||'all').trim().toLowerCase();if(!DISTANCES.has(v)) throw new Error('distance_group is unsupported');return v;}
function normalizeSex(value){const v=String(value||'all').trim().toLowerCase();if(!SEX_VALUES.has(v)) throw new Error('sex is unsupported');return v;}
function normalizeAge(value){if(value==null||value===''||value==='all')return null;const n=Number(value);if(!Number.isInteger(n)||n<2||n>30)throw new Error('age is unsupported');return n;}
function normalizeVoltLane(value){const v=String(value||'all').trim().toLowerCase();if(!VOLT_LANES.has(v))throw new Error('volt_lane is unsupported');return v;}
function normalizeHandicap(value){if(value==null||value===''||value==='all')return null;const n=Number(value);if(!Number.isInteger(n)||n<0||n>500||n%20!==0)throw new Error('handicap_m is unsupported');return n;}

function normalizeFilters(options={}){
  const asOfDate=options.asOfDate||swedenDateKey();
  const asOfInstant=options.asOfInstant==null||options.asOfInstant===''?null:new Date(options.asOfInstant).toISOString();
  return{
    asOfDate,asOfInstant,year:normalizeYear(options.year,asOfDate),raceScope:normalizeTrendRaceScope(options.raceScope),trackId:normalizeTrackId(options.trackId),
    raceType:normalizeTrendRaceType(options.raceType),breedType:normalizeTrendBreed(options.breedType),sex:normalizeSex(options.sex),age:normalizeAge(options.age),
    startMethod:normalizeTrendStartMethod(options.startMethod),distanceGroup:normalizeDistance(options.distanceGroup),voltLane:normalizeVoltLane(options.voltLane),handicapM:normalizeHandicap(options.handicapM)
  };
}

function addYearCondition(conditions,bindings,filters,raceAlias='r'){
  const currentYear=Number(filters.asOfDate.slice(0,4));
  conditions.push(`${raceAlias}.race_date >= ?`);
  bindings.push(`${filters.year}-01-01`);
  if(filters.year===currentYear){conditions.push(`${raceAlias}.race_date <= ?`);bindings.push(filters.asOfDate);}
  else {conditions.push(`${raceAlias}.race_date < ?`);bindings.push(`${filters.year+1}-01-01`);}
}
function distanceGroupSql(raceAlias='r'){
  return `CASE
    WHEN ${raceAlias}.distance_m BETWEEN 540 AND 740 THEN '640'
    WHEN ${raceAlias}.distance_m BETWEEN 1540 AND 1740 THEN '1640'
    WHEN ${raceAlias}.distance_m BETWEEN 2040 AND 2240 THEN '2140'
    WHEN ${raceAlias}.distance_m BETWEEN 2540 AND 2740 THEN '2640'
    WHEN ${raceAlias}.distance_m BETWEEN 3040 AND 3240 THEN '3140'
    WHEN ${raceAlias}.distance_m BETWEEN 3540 AND 3740 THEN '3640'
    WHEN ${raceAlias}.distance_m BETWEEN 4040 AND 4240 THEN '4140'
    WHEN ${raceAlias}.distance_m > 2640 THEN 'other-long'
    ELSE 'unknown'
  END`;
}
function addDistanceCondition(conditions,bindings,distance,raceAlias='r'){
  if(distance==='all')return;
  if(distance==='other-long'){
    const standards=DISTANCE_STANDARDS.filter(v=>v>=2640);
    conditions.push(`${raceAlias}.distance_m > 2640 AND ${standards.map(()=>`NOT (${raceAlias}.distance_m BETWEEN ? AND ?)`).join(' AND ')}`);
    for(const standard of standards)bindings.push(standard-DISTANCE_TOLERANCE_M,standard+DISTANCE_TOLERANCE_M);
    return;
  }
  const meters=Number(distance);conditions.push(`${raceAlias}.distance_m BETWEEN ? AND ?`);bindings.push(meters-DISTANCE_TOLERANCE_M,meters+DISTANCE_TOLERANCE_M);
}
function addCommonFilters(conditions,bindings,filters,{raceAlias='r',entryAlias='re',horseAlias='h',includeVolt=true}={}){
  addYearCondition(conditions,bindings,filters,raceAlias);
  if(filters.trackId){conditions.push(`${raceAlias}.track_id = ?`);bindings.push(filters.trackId);}
  if(filters.startMethod!=='all')conditions.push(`${canonicalStartMethodSql(raceAlias)} = '${filters.startMethod}'`);
  if(filters.raceType==='monte')conditions.push(monteRaceCondition(raceAlias));
  if(filters.raceType==='sulky')conditions.push(`NOT ${monteRaceCondition(raceAlias)}`);
  if(filters.breedType==='warmblood')conditions.push(`(LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%warmblood%')`);
  if(filters.breedType==='coldblood')conditions.push(`(LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(${horseAlias}.breed,'')) LIKE '%coldblood%')`);
  if(filters.sex==='mare')conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('sto','mare','female','f')`);
  if(filters.sex==='stallion')conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('hingst','stallion','male','m')`);
  if(filters.sex==='gelding')conditions.push(`LOWER(COALESCE(${horseAlias}.sex,'')) IN ('valack','gelding')`);
  if(filters.age!=null){conditions.push(`?-${horseAlias}.birth_year=?`);bindings.push(filters.year,filters.age);}
  addDistanceCondition(conditions,bindings,filters.distanceGroup,raceAlias);
  addCanonicalRaceScopeCondition(conditions,filters.raceScope,raceAlias);
  if(includeVolt&&filters.voltLane!=='all'){
    conditions.push(`${canonicalStartMethodSql(raceAlias)}='volt'`);
    conditions.push(filters.voltLane==='good'?`${entryAlias}.actual_lane IN (1,6,7)`:`${entryAlias}.actual_lane IS NOT NULL AND ${entryAlias}.actual_lane NOT IN (1,6,7)`);
  }
  if(includeVolt&&filters.handicapM!=null){
    conditions.push(`${canonicalStartMethodSql(raceAlias)}='volt'`,`${entryAlias}.handicap_m=?`,`${entryAlias}.actual_start_distance_m IS NOT NULL`,`${raceAlias}.distance_m IS NOT NULL`,`${entryAlias}.actual_start_distance_m-${raceAlias}.distance_m=${entryAlias}.handicap_m`);
    bindings.push(filters.handicapM);
  }
}
async function validateTrack(env,id){if(!id)return;const row=await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id=? LIMIT 1').bind(id).first();if(!row?.ok)throw new Error('track_id does not identify a stored track');}
function mapRows(rows,section){return rows.filter(r=>r.section===section).map(r=>({label:r.label,...mapCoreMetricRow(r)}));}
function sortMethods(rows){return rows.sort((a,b)=>b.starts-a.starts||String(a.label).localeCompare(String(b.label)));}
function sortDistances(rows){return rows.sort((a,b)=>{const x=Number(a.label),y=Number(b.label);if(Number.isFinite(x)&&Number.isFinite(y))return x-y;if(Number.isFinite(x))return-1;if(Number.isFinite(y))return 1;return String(a.label).localeCompare(String(b.label));});}
function sortTracks(rows){return rows.sort((a,b)=>b.starts-a.starts||String(a.label).localeCompare(String(b.label),'sv',{sensitivity:'base'}));}

async function loadCore(env,entityId,filters,config){
  const conditions=['re.scratched=0',`re.${config.entryColumn}=?`],bindings=[entityId];
  addCommonFilters(conditions,bindings,filters,{includeVolt:config.volt});
  const methodSql=canonicalStartMethodSql('r'),distanceSql=distanceGroupSql('r'),metrics=coreMetricSelectSql('f');
  const {results}=await env.DB.prepare(`WITH filtered AS MATERIALIZED (
    SELECT rr.race_entry_id,rr.placing,rr.gallop,rr.disqualified,rr.prize_sek,${distanceSql} AS distance_group,${methodSql} AS start_method_group,COALESCE(tr.canonical_name,'Okänd bana') AS track_label
    FROM race_entries re INDEXED BY ${config.entryIndex}
    JOIN races r ON r.id=re.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id
    LEFT JOIN tracks tr ON tr.id=r.track_id
    WHERE ${conditions.join(' AND ')}
  )
  SELECT 'summary' section,'all' label,${metrics} FROM filtered f
  UNION ALL SELECT 'method',f.start_method_group,${metrics} FROM filtered f GROUP BY f.start_method_group
  UNION ALL SELECT 'distance',f.distance_group,${metrics} FROM filtered f GROUP BY f.distance_group
  UNION ALL SELECT 'track',f.track_label,${metrics} FROM filtered f GROUP BY f.track_label`).bind(...bindings).all();
  const rows=results||[],summaryRow=rows.find(r=>r.section==='summary');
  return{summary:mapCoreMetricRow(summaryRow||{}),startMethods:sortMethods(mapRows(rows,'method')),distances:sortDistances(mapRows(rows,'distance')),tracks:sortTracks(mapRows(rows,'track'))};
}

function stlDifficultyScore(value){
  const scores={class_iii:35,class_ii:45,class_i:55,bronze:65,silver:75,gold:90};
  return value&&Object.prototype.hasOwnProperty.call(scores,value)?scores[value]:null;
}

async function loadHorseForm(env,entityId,filters,config){
  const conditions=['re.scratched=0','re.horse_id=?','(rr.placing IS NOT NULL OR rr.disqualified=1)'],bindings=[entityId];
  addCommonFilters(conditions,bindings,filters,{includeVolt:false});
  if(filters.asOfInstant){
    conditions.push("((r.scheduled_start_at IS NOT NULL AND julianday(r.scheduled_start_at)<julianday(?)) OR (r.scheduled_start_at IS NULL AND r.race_date<substr(?,1,10)))");
    bindings.push(filters.asOfInstant,filters.asOfInstant);
  }
  const {results:targetRows}=await env.DB.prepare(`
    SELECT re.id race_entry_id,r.id race_id,r.race_date,r.race_number,r.scheduled_start_at,
      r.first_prize_sek,r.distance_m,re.actual_start_distance_m,rr.placing,rr.disqualified,rsc.stl_class
    FROM races r INDEXED BY idx_races_date
    JOIN race_entries re ON re.race_id=r.id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id
    LEFT JOIN race_stl_classifications rsc ON rsc.race_id=r.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.race_date DESC,r.race_number DESC,re.id DESC
    LIMIT ${config.formLimit}
  `).bind(...bindings).all();
  const targets=targetRows||[];
  if(!targets.length)return null;
  const raceIds=[...new Set(targets.map(row=>row.race_id))],racePlaceholders=raceIds.map(()=>'?').join(',');

  const [{results:fieldRows},{results:opponentRows}]=await Promise.all([
    env.DB.prepare(`
      WITH latest_x AS (
        SELECT x.*,ROW_NUMBER() OVER (
          PARTITION BY x.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC,x.source_record_id DESC
        ) rn
        FROM xlabs_data x
        JOIN source_records sr ON sr.id=x.source_record_id
        WHERE x.quality_status='xlabs-telemetry-v1' AND sr.source_type='xlabs_race_json'
          AND julianday(sr.fetched_at)<=julianday(?)
      )
      SELECT re.race_id,re.id race_entry_id,re.horse_id,re.actual_start_distance_m,r.distance_m,
        rr.placing,rr.disqualified,rr.km_time,
        x.last_400_time,x.extra_distance_m
      FROM race_entries re
      JOIN races r ON r.id=re.race_id
      LEFT JOIN race_results rr ON rr.race_entry_id=re.id
      LEFT JOIN latest_x x ON x.race_entry_id=re.id AND x.rn=1
      WHERE re.scratched=0 AND re.race_id IN (${racePlaceholders})
      ORDER BY re.race_id,re.start_number,re.id
    `).bind(filters.asOfInstant||filters.asOfDate+'T23:59:59.999Z',...raceIds).all(),
    env.DB.prepare(`
      SELECT re.race_id,re.horse_id,
        (
          SELECT hss.start_points FROM horse_stat_snapshots hss
          JOIN official_snapshot_source_sync os ON os.source_record_id=hss.source_record_id AND os.status='complete'
          JOIN source_records sr ON sr.id=hss.source_record_id
          WHERE hss.horse_id=re.horse_id AND hss.snapshot_scope='life'
            AND julianday(hss.observed_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
            AND julianday(sr.fetched_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
          ORDER BY julianday(hss.observed_at) DESC,hss.id DESC LIMIT 1
        ) start_points,
        (
          SELECT hss.earnings_raw FROM horse_stat_snapshots hss
          JOIN official_snapshot_source_sync os ON os.source_record_id=hss.source_record_id AND os.status='complete'
          JOIN source_records sr ON sr.id=hss.source_record_id
          WHERE hss.horse_id=re.horse_id AND hss.snapshot_scope='life'
            AND julianday(hss.observed_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
            AND julianday(sr.fetched_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
          ORDER BY julianday(hss.observed_at) DESC,hss.id DESC LIMIT 1
        ) earnings_raw
      FROM race_entries re JOIN races r ON r.id=re.race_id
      WHERE re.scratched=0 AND re.race_id IN (${racePlaceholders})
    `).bind(...raceIds).all()
  ]);

  const byRace=new Map();
  for(const row of fieldRows||[]){if(!byRace.has(row.race_id))byRace.set(row.race_id,[]);byRace.get(row.race_id).push(row);}
  const contextByRace=new Map();
  for(const row of opponentRows||[]){if(!contextByRace.has(row.race_id))contextByRace.set(row.race_id,[]);contextByRace.get(row.race_id).push(row);}

  const scored=targets.map(target=>{
    const field=byRace.get(target.race_id)||[];
    const targetField=field.find(row=>row.race_entry_id===target.race_entry_id)||null;
    const fieldSize=field.length;
    const resultScore=resultPerformanceScore({placing:target.placing,disqualified:target.disqualified,fieldSize});

    const context=contextByRace.get(target.race_id)||[];
    const self=context.find(row=>row.horse_id===entityId)||null;
    const opponents=context.filter(row=>row.horse_id!==entityId);
    const pointValues=opponents.filter(row=>row.start_points!=null).map(row=>Number(row.start_points)).filter(Number.isFinite).sort((a,b)=>a-b);
    const earningValues=opponents.filter(row=>row.earnings_raw!=null).map(row=>Number(row.earnings_raw)).filter(Number.isFinite).sort((a,b)=>a-b);
    const median=values=>values.length?values[Math.floor((values.length-1)/2)]:null;
    const pointChallenge=relativeChallengeScore(median(pointValues),self?.start_points);
    const earningChallenge=relativeChallengeScore(median(earningValues),self?.earnings_raw);
    const difficultyScore=weightedAvailable([
      {value:prizeDifficultyScore(target.first_prize_sek),weight:0.55},
      {value:stlDifficultyScore(target.stl_class),weight:0.15},
      {value:pointChallenge,weight:0.20},
      {value:earningChallenge,weight:0.10}
    ]);

    const extraValues=field.map(row=>{
      const distance=Number(row.actual_start_distance_m??row.distance_m);
      const extra=Number(row.extra_distance_m);
      return Number.isFinite(extra)&&distance>0?(extra/distance)*100:null;
    }).filter(value=>value!=null);
    const targetDistance=Number(targetField?.actual_start_distance_m??targetField?.distance_m);
    const targetExtra=Number(targetField?.extra_distance_m);
    const targetExtraPct=Number.isFinite(targetExtra)&&targetDistance>0?(targetExtra/targetDistance)*100:null;
    const workScore=fieldPercentileScore(targetExtraPct,extraValues);

    const officialPaces=field.map(row=>parsePaceSeconds(row.km_time)).filter(value=>value!=null);
    const closingPaces=field.map(row=>parsePaceSeconds(row.last_400_time)).filter(value=>value!=null);
    const officialScore=fieldPercentileScore(parsePaceSeconds(targetField?.km_time),officialPaces,{lowerIsBetter:true});
    const closingScore=fieldPercentileScore(parsePaceSeconds(targetField?.last_400_time),closingPaces,{lowerIsBetter:true});
    const speedScore=weightedAvailable([{value:officialScore,weight:0.5},{value:closingScore,weight:0.5}]);

    return {
      raceEntryId:target.race_entry_id,
      raceId:target.race_id,
      raceDate:target.race_date,
      resultScore,difficultyScore,workScore,speedScore
    };
  });
  return calculateHorseFormIndex(scored);
}

async function loadPersonTargetStarts(env,entityId,filters,config){
  const conditions=['re.scratched=0',`re.${config.entryColumn}=?`,'(rr.placing IS NOT NULL OR rr.disqualified=1)'],bindings=[entityId];
  addCommonFilters(conditions,bindings,filters,{includeVolt:config.volt});
  const {results}=await env.DB.prepare(`
    SELECT re.id race_entry_id,re.horse_id,r.id race_id,r.race_date,r.race_number,
      rr.placing,rr.disqualified,
      (SELECT COUNT(*) FROM race_entries field_re WHERE field_re.race_id=r.id AND field_re.scratched=0) field_size
    FROM race_entries re INDEXED BY ${config.entryIndex}
    JOIN races r ON r.id=re.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.race_date DESC,r.race_number DESC,re.id DESC
    LIMIT ${PERSON_FORM_MAX_STARTS}
  `).bind(...bindings).all();
  return results||[];
}

async function loadDriverMarketRanks(env,targets){
  if(!targets.length)return new Map();
  const ids=targets.map(row=>row.race_entry_id),placeholders=ids.map(()=>'?').join(',');
  const {results}=await env.DB.prepare(`
    WITH candidates AS (
      SELECT bs.race_entry_id,bs.market_rank,bs.captured_at,bs.id,
        ROW_NUMBER() OVER(PARTITION BY bs.race_entry_id ORDER BY julianday(bs.captured_at) DESC,bs.id DESC) rn
      FROM betting_snapshots bs INDEXED BY idx_betting_snapshots_entry_time
      JOIN game_rounds gr ON gr.id=bs.game_round_id
      JOIN game_legs gl ON gl.game_round_id=gr.id AND gl.leg_number=bs.leg_number
      JOIN race_entries re ON re.id=bs.race_entry_id AND re.race_id=gl.race_id
      WHERE bs.race_entry_id IN (${placeholders})
        AND gr.bet_stop_at IS NOT NULL
        AND bs.source_record_id IS NOT NULL
        AND julianday(bs.captured_at)<=julianday(gr.bet_stop_at)
    )
    SELECT race_entry_id,market_rank,captured_at FROM candidates WHERE rn=1
  `).bind(...ids).all();
  return new Map((results||[]).map(row=>[row.race_entry_id,row]));
}

async function loadTrainerPriorResults(env,targets){
  if(!targets.length)return new Map();
  const targetJson=JSON.stringify(targets.map(target=>({
    targetEntryId:target.race_entry_id,
    horseId:target.horse_id,
    raceDate:target.race_date,
    raceNumber:target.race_number
  })));
  const {results}=await env.DB.prepare(`
    WITH targets AS (
      SELECT
        json_extract(value,'$.targetEntryId') target_entry_id,
        json_extract(value,'$.horseId') horse_id,
        json_extract(value,'$.raceDate') race_date,
        CAST(json_extract(value,'$.raceNumber') AS INTEGER) race_number
      FROM json_each(?)
    ),
    prior AS (
      SELECT t.target_entry_id,rr.placing,rr.disqualified,
        (SELECT COUNT(*) FROM race_entries field_re WHERE field_re.race_id=r.id AND field_re.scratched=0) field_size,
        ROW_NUMBER() OVER(PARTITION BY t.target_entry_id ORDER BY r.race_date DESC,r.race_number DESC,re.id DESC) rn
      FROM targets t
      JOIN race_entries re INDEXED BY idx_entries_horse_race ON re.horse_id=t.horse_id AND re.scratched=0
      JOIN races r ON r.id=re.race_id
      JOIN race_results rr ON rr.race_entry_id=re.id
      WHERE (r.race_date<t.race_date OR (r.race_date=t.race_date AND r.race_number<t.race_number))
        AND (rr.placing IS NOT NULL OR rr.disqualified=1)
    )
    SELECT target_entry_id,placing,disqualified,field_size FROM prior WHERE rn<=3 ORDER BY target_entry_id,rn
  `).bind(targetJson).all();
  const byTarget=new Map();
  for(const row of results||[]){
    if(!byTarget.has(row.target_entry_id))byTarget.set(row.target_entry_id,[]);
    byTarget.get(row.target_entry_id).push(resultPerformanceScore({placing:row.placing,disqualified:row.disqualified,fieldSize:row.field_size}));
  }
  return byTarget;
}

async function loadDriverForm(env,entityId,filters,config){
  const targets=await loadPersonTargetStarts(env,entityId,filters,config);
  const market=await loadDriverMarketRanks(env,targets);
  return calculateDriverFormIndex(targets.map(row=>{
    const resultScore=resultPerformanceScore({placing:row.placing,disqualified:row.disqualified,fieldSize:row.field_size});
    const marketRow=market.get(row.race_entry_id);
    return{
      raceEntryId:row.race_entry_id,raceId:row.race_id,raceDate:row.race_date,
      resultScore,
      marketRank:marketRow?.market_rank==null?null:Number(marketRow.market_rank),
      marketCapturedAt:marketRow?.captured_at||null,
      marketPerformanceScore:marketExpectationPerformanceScore({
        placing:row.placing,disqualified:row.disqualified,fieldSize:row.field_size,marketRank:marketRow?.market_rank
      })
    };
  }));
}

async function loadTrainerForm(env,entityId,filters,config){
  const targets=await loadPersonTargetStarts(env,entityId,filters,config);
  const prior=await loadTrainerPriorResults(env,targets);
  return calculateTrainerFormIndex(targets.map(row=>{
    const resultScore=resultPerformanceScore({placing:row.placing,disqualified:row.disqualified,fieldSize:row.field_size});
    return{
      raceEntryId:row.race_entry_id,raceId:row.race_id,raceDate:row.race_date,
      resultScore,
      developmentScore:trainerDevelopmentScore({resultScore,priorResultScores:prior.get(row.race_entry_id)||[]})
    };
  }));
}
async function loadMarket(env,entityId,filters,config,kind){
  if(!config.market)return null;
  const targetConditions=['re.scratched=0',`re.${config.entryColumn}=?`],targetBindings=[entityId];
  addCommonFilters(targetConditions,targetBindings,filters,{includeVolt:config.volt});
  const marketConditions=kind==='favorite'
    ? ['m.market_rank=1']
    : ['m.bet_percent IS NOT NULL','m.bet_percent>=0','m.bet_percent<=?'];
  const marketBindings=kind==='favorite'?[]:[DRIVER_LONGSHOT_PERCENT_MAX];
  const row=await env.DB.prepare(`
    WITH target_entries AS MATERIALIZED (
      SELECT re.id race_entry_id
      FROM race_entries re INDEXED BY ${config.entryIndex}
      JOIN races r ON r.id=re.race_id
      JOIN horses h ON h.id=re.horse_id
      WHERE ${targetConditions.join(' AND ')}
    ),
    market_candidates AS (
      SELECT bs.race_entry_id,bs.bet_percent,bs.market_rank,bs.captured_at,bs.id,
        ROW_NUMBER() OVER(PARTITION BY bs.race_entry_id ORDER BY julianday(bs.captured_at) DESC,bs.id DESC) rn
      FROM target_entries te
      JOIN betting_snapshots bs INDEXED BY idx_betting_snapshots_entry_time ON bs.race_entry_id=te.race_entry_id
      JOIN game_rounds gr ON gr.id=bs.game_round_id
      JOIN game_legs gl ON gl.game_round_id=gr.id AND gl.leg_number=bs.leg_number
      JOIN race_entries mre ON mre.id=bs.race_entry_id AND mre.race_id=gl.race_id
      WHERE gr.bet_stop_at IS NOT NULL
        AND bs.source_record_id IS NOT NULL
        AND julianday(bs.captured_at)<=julianday(gr.bet_stop_at)
    ),
    market_at_stop AS (
      SELECT race_entry_id,bet_percent,market_rank,captured_at FROM market_candidates WHERE rn=1
    )
    SELECT ${coreMetricSelectSql('rr')}
    FROM target_entries te
    JOIN race_results rr ON rr.race_entry_id=te.race_entry_id
    JOIN market_at_stop m ON m.race_entry_id=te.race_entry_id
    WHERE ${marketConditions.join(' AND ')}
  `).bind(...targetBindings,...marketBindings).first();
  return mapCoreMetricRow(row||{});
}
function restCte(config,filters){
  const currentYear=Number(filters.asOfDate.slice(0,4));
  const upper=filters.year===currentYear?'r0.race_date<=?':'r0.race_date<?';
  return`relevant_horses AS (
  SELECT DISTINCT re0.horse_id
  FROM race_entries re0 INDEXED BY ${config.entryIndex}
  JOIN races r0 ON r0.id=re0.race_id
  WHERE re0.${config.entryColumn}=?
    AND re0.scratched=0
    AND r0.race_date>=?
    AND ${upper}
),actual AS (
  SELECT h.id horse_id,h.sex,h.birth_year,h.breed,re.trainer_id,re.driver_id,r.id,r.track_id,r.race_date,r.race_number,r.distance_m,r.start_method,r.first_prize_sek,r.race_name,r.main_class,r.class_flags_json,re.id race_entry_id,re.actual_lane,re.handicap_m,re.actual_start_distance_m,rr.placing,rr.prize_sek,rr.gallop,rr.disqualified,
    CAST(julianday(r.race_date)-julianday(LAG(r.race_date) OVER(PARTITION BY h.id ORDER BY r.race_date,r.race_number,re.id)) AS INTEGER) days_since_previous
  FROM relevant_horses rh
  JOIN race_entries re INDEXED BY idx_entries_horse_race ON re.horse_id=rh.horse_id
  JOIN races r ON r.id=re.race_id
  JOIN race_results rr ON rr.race_entry_id=re.id
  JOIN horses h ON h.id=re.horse_id
  WHERE re.scratched=0
),staged AS (
  SELECT *,LAG(days_since_previous) OVER(PARTITION BY horse_id ORDER BY race_date,race_number,race_entry_id) previous_gap FROM actual
)`;}
function addStagedFilters(conditions,bindings,filters,config){
  addYearCondition(conditions,bindings,filters,'s');if(filters.trackId){conditions.push('s.track_id=?');bindings.push(filters.trackId);}if(filters.startMethod!=='all')conditions.push(`${canonicalStartMethodSql('s')}='${filters.startMethod}'`);if(filters.raceType==='monte')conditions.push(monteRaceCondition('s'));if(filters.raceType==='sulky')conditions.push(`NOT ${monteRaceCondition('s')}`);if(filters.breedType==='warmblood')conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%warmblood%')");if(filters.breedType==='coldblood')conditions.push("(LOWER(COALESCE(s.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(s.breed,'')) LIKE '%coldblood%')");if(filters.sex==='mare')conditions.push("LOWER(COALESCE(s.sex,'')) IN ('sto','mare','female','f')");if(filters.sex==='stallion')conditions.push("LOWER(COALESCE(s.sex,'')) IN ('hingst','stallion','male','m')");if(filters.sex==='gelding')conditions.push("LOWER(COALESCE(s.sex,'')) IN ('valack','gelding')");if(filters.age!=null){conditions.push('? - s.birth_year=?');bindings.push(filters.year,filters.age);}addDistanceCondition(conditions,bindings,filters.distanceGroup,'s');addCanonicalRaceScopeCondition(conditions,filters.raceScope,'s');if(config.volt&&filters.voltLane!=='all'){conditions.push(`${canonicalStartMethodSql('s')}='volt'`);conditions.push(filters.voltLane==='good'?'s.actual_lane IN (1,6,7)':'s.actual_lane IS NOT NULL AND s.actual_lane NOT IN (1,6,7)');}if(config.volt&&filters.handicapM!=null){conditions.push(`${canonicalStartMethodSql('s')}='volt'`,'s.handicap_m=?','s.actual_start_distance_m IS NOT NULL','s.distance_m IS NOT NULL','s.actual_start_distance_m-s.distance_m=s.handicap_m');bindings.push(filters.handicapM);}
}
async function loadRest(env,entityId,filters,config,kind){
  if(!config.rest)return null;
  const currentYear=Number(filters.asOfDate.slice(0,4));
  const upper=filters.year===currentYear?filters.asOfDate:`${filters.year+1}-01-01`;
  const column=config.entryColumn==='horse_id'?'horse_id':config.entryColumn;
  const conditions=[`s.${column}=?`],bindings=[entityId,`${filters.year}-01-01`,upper,entityId];
  addStagedFilters(conditions,bindings,filters,config);conditions.push(kind==='first'?`s.days_since_previous>=${REST_DAYS}`:`s.previous_gap>=${REST_DAYS} AND s.days_since_previous<${REST_DAYS}`);
  const row=await env.DB.prepare(`WITH ${restCte(config,filters)} SELECT COUNT(*) starts,SUM(CASE WHEN s.placing=1 THEN 1 ELSE 0 END) wins,SUM(CASE WHEN s.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) top3 FROM staged s WHERE ${conditions.join(' AND ')}`).bind(...bindings).first();
  const starts=Number(row?.starts||0),wins=Number(row?.wins||0),top3=Number(row?.top3||0);return{starts,wins,top3,winRate:starts?wins/starts:null,top3Rate:starts?top3/starts:null};
}


async function loadHorseTripScenarios(env,entityId,filters){
  const conditions=['re.scratched=0','re.horse_id=?'],bindings=[entityId];
  addCommonFilters(conditions,bindings,filters,{includeVolt:false});
  bindings.push(XLABS_TRIP_CLASSIFICATION_VERSION);
  const {results}=await env.DB.prepare(`
    WITH latest_trip AS (
      SELECT rp.*,
        ROW_NUMBER() OVER (
          PARTITION BY rp.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC,rp.id DESC
        ) rn
      FROM race_positions rp
      JOIN source_records sr ON sr.id=rp.source_record_id
      WHERE rp.classification_version=?
    ), filtered AS MATERIALIZED (
      SELECT re.id race_entry_id,rr.placing,
        CASE
          WHEN rp.leader=1 THEN 'leader'
          WHEN rp.pocket=1 THEN 'pocket'
          WHEN rp.death_seat=1 THEN 'death_seat'
          WHEN rp.second_over=1 THEN 'second_over'
          WHEN rp.third_over=1 THEN 'third_over'
          WHEN json_extract(rp.event_json,'$.scenario_key')='back' THEN 'back'
          ELSE NULL
        END scenario
      FROM race_entries re INDEXED BY idx_entries_horse_race
      JOIN races r ON r.id=re.race_id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN horses h ON h.id=re.horse_id
      JOIN latest_trip rp ON rp.race_entry_id=re.id AND rp.rn=1
      WHERE ${conditions.join(' AND ')}
    )
    SELECT scenario,COUNT(*) starts,
      SUM(CASE WHEN placing=1 THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) top3
    FROM filtered
    WHERE scenario IS NOT NULL
    GROUP BY scenario
  `).bind(XLABS_TRIP_CLASSIFICATION_VERSION,...bindings.slice(0,-1)).all();
  const labels={leader:'Spets',pocket:'Rygg ledaren',death_seat:'Dödens',second_over:'2:a utvändigt',third_over:'3:e utvändigt',back:'Bakifrån'};
  const order={leader:1,pocket:2,death_seat:3,second_over:4,third_over:5,back:6};
  return (results||[]).map(row=>{
    const starts=Number(row.starts||0),wins=Number(row.wins||0),top3=Number(row.top3||0);
    return{scenario:row.scenario,label:labels[row.scenario]||row.scenario,starts,wins,top3,winRate:starts?wins/starts:null,top3Rate:starts?top3/starts:null};
  }).sort((a,b)=>(order[a.scenario]||99)-(order[b.scenario]||99));
}

function definitions(){return{longshotPercentMax:DRIVER_LONGSHOT_PERCENT_MAX,market:DRIVER_MARKET_DEFINITION_VERSION,voltLaneGood:[1,6,7],restDays:REST_DAYS}}

async function loadSpecialties(env,id,filters,config,{includeTripScenarios=true}={}){
  const [favorite,longshot,firstAfterRest,secondAfterRest,tripScenarioResults]=await Promise.all([
    loadMarket(env,id,filters,config,'favorite'),
    loadMarket(env,id,filters,config,'longshot'),
    loadRest(env,id,filters,config,'first'),
    loadRest(env,id,filters,config,'second'),
    includeTripScenarios&&config.resultKey==='horse'?loadHorseTripScenarios(env,id,filters):Promise.resolve(null)
  ]);
  return{favoriteResults:favorite,longshotResults:longshot,firstAfterRest,secondAfterRest,tripScenarioResults};
}

async function prepareDetail(env,entityType,entityId,options={}){
  if(!env.DB)throw new Error('DB is not configured');
  const config=configFor(entityType),id=String(entityId||'').trim();if(!id)return null;
  const entity=await env.DB.prepare(`SELECT id,canonical_name AS name FROM ${config.table} WHERE id=? LIMIT 1`).bind(id).first();if(!entity)return null;
  const filters=normalizeFilters(options);await validateTrack(env,filters.trackId);
  return{config,id,entity,filters};
}

export async function getCalendarYearDetailStatistics(env,entityType,entityId,options={}){
  if(!env.DB)throw new Error('DB is not configured');
  const config=configFor(entityType),id=String(entityId||'').trim();if(!id)return null;
  const filters=normalizeFilters(options);
  const [entity,,core,currentStartPoints]=await Promise.all([
    env.DB.prepare(`SELECT id,canonical_name AS name FROM ${config.table} WHERE id=? LIMIT 1`).bind(id).first(),
    validateTrack(env,filters.trackId),
    loadCore(env,id,filters,config),
    config.resultKey==='horse'?getHorseCurrentStartPoint(env,id,filters.asOfDate):Promise.resolve(null)
  ]);
  if(!entity)return null;
  const specialties=options.includeSpecials===false
    ? {favoriteResults:null,longshotResults:null,firstAfterRest:null,secondAfterRest:null,tripScenarioResults:null}
    : await loadSpecialties(env,id,filters,config);
  return{entityType,[config.resultKey]:entity,filters,...core,formLast:null,currentStartPoints,...specialties,definitions:definitions()};
}

export async function getCalendarYearDetailSpecialties(env,entityType,entityId,options={}){
  const prepared=await prepareDetail(env,entityType,entityId,options);if(!prepared)return null;
  const {config,id,filters}=prepared;
  return{entityType,filters,...await loadSpecialties(env,id,filters,config,{includeTripScenarios:options.includeTripScenarios!==false}),definitions:definitions()};
}

export async function getHorseCalendarYearTripScenarios(env,entityId,options={}){
  const prepared=await prepareDetail(env,'horses',entityId,options);if(!prepared)return null;
  const {id,filters}=prepared;
  return{entityType:'horses',filters,tripScenarioResults:await loadHorseTripScenarios(env,id,filters)};
}

export async function getCalendarYearDetailForm(env,entityType,entityId,options={}){
  const prepared=await prepareDetail(env,entityType,entityId,options);if(!prepared)return null;
  const {config,id,filters}=prepared;
  let formLast=null;
  if(entityType==='horses')formLast=await loadHorseForm(env,id,filters,config);
  else if(entityType==='drivers')formLast=await loadDriverForm(env,id,filters,config);
  else if(entityType==='trainers')formLast=await loadTrainerForm(env,id,filters,config);
  return{entityType,filters,formLast};
}

export const getHorseCalendarYearForm=(env,id,options)=>getCalendarYearDetailForm(env,'horses',id,options);
export const getDriverCalendarYearForm=(env,id,options)=>getCalendarYearDetailForm(env,'drivers',id,options);
export const getTrainerCalendarYearForm=(env,id,options)=>getCalendarYearDetailForm(env,'trainers',id,options);

export const getTrainerCalendarYearDetailStatistics=(env,id,options)=>getCalendarYearDetailStatistics(env,'trainers',id,options);
export const getDriverCalendarYearDetailStatistics=(env,id,options)=>getCalendarYearDetailStatistics(env,'drivers',id,options);
export const getHorseCalendarYearDetailStatistics=(env,id,options)=>getCalendarYearDetailStatistics(env,'horses',id,options);
