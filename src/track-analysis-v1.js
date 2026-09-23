import { XLABS_POSITION_RECONSTRUCTION_VERSION } from './xlabs-position-reconstruction-v1.js';
import { XLABS_TRIP_CLASSIFICATION_VERSION } from './xlabs-trip-classification-v1.js';

export const TRACK_ANALYSIS_CONTRACT = 'kentaurai-track-analysis-v1';
export const TRACK_ANALYSIS_VERSION = 'track-analysis-v1.2';
export const TRACK_ANALYSIS_SAMPLE_POLICY = Object.freeze({
  normalMinRaces: 25,
  limitedMinRaces: 10,
  comparisonMinObservations: 25
});

const POSITION_EXACT_FIELD_COVERAGE_MIN = 0.999;
const POSITION_LONGITUDINAL_CONFIDENCE_MIN = 0.65;
const LEAD_COMPARISON_MIN_DELTA_PP = 3;
const TOP3_COMPARISON_MIN_DELTA_PP = 5;
const SCENARIO_WIN_COMPARISON_MIN_DELTA_PP = 3;

const STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const DISTANCE_TOLERANCE_M = 100;
const CHUNK_SIZE = 48;
const SCENARIO_LABELS = Object.freeze({
  leader: 'Spets',
  pocket: 'Rygg ledaren',
  death_seat: 'Dödens',
  second_over: '2:a utvändigt',
  third_over: '3:e utvändigt',
  back: 'Bakifrån'
});
const SCENARIO_ORDER = ['leader', 'pocket', 'death_seat', 'second_over', 'third_over', 'back'];

function chunks(values, size = CHUNK_SIZE) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentagePointDelta(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return null;
  return round((value - baseline) * 100, 1);
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function trackAnalysisDistanceGroup(value) {
  if (value === null || value === undefined || value === '' || value === 'all') return value === 'all' ? 'all' : null;
  const distance = Number(value);
  if (!Number.isFinite(distance)) return null;
  for (const standard of STANDARD_DISTANCE_GROUPS) {
    if (Math.abs(distance - standard) <= DISTANCE_TOLERANCE_M) return String(standard);
  }
  return null;
}

export function normalizeTrackAnalysisStartMethod(value) {
  const method = String(value ?? 'all').trim().toLowerCase();
  if (!method || method === 'all' || method === 'alla') return 'all';
  if (['auto', 'autostart'].includes(method)) return 'auto';
  if (['volt', 'volte', 'voltstart'].includes(method)) return 'volt';
  throw new Error('start method must be all, auto or volt');
}

export function normalizeTrackAnalysisDistanceGroup(value) {
  if (value === null || value === undefined || value === '' || value === 'all' || value === 'alla') return 'all';
  const group = trackAnalysisDistanceGroup(value);
  if (!group || group === 'all') throw new Error('unsupported distance group');
  return group;
}

function canonicalStartMethodSql(alias = 'r') {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.start_method, '')) IN ('auto','autostart') THEN 'auto'
    WHEN LOWER(COALESCE(${alias}.start_method, '')) IN ('volt','volte','voltstart') THEN 'volt'
    WHEN ${alias}.start_method IS NULL OR TRIM(${alias}.start_method) = '' THEN 'unknown'
    ELSE LOWER(${alias}.start_method)
  END`;
}

function distanceCondition(group, bindings, alias = 'r') {
  if (group === 'all') return '1=1';
  const distance = Number(group);
  bindings.push(distance - DISTANCE_TOLERANCE_M, distance + DISTANCE_TOLERANCE_M);
  return `${alias}.distance_m BETWEEN ? AND ?`;
}

function appendContextConditions(conditions, bindings, { startMethod, distanceGroup, asOf }, alias = 'r') {
  if (startMethod !== 'all') {
    conditions.push(`${canonicalStartMethodSql(alias)} = ?`);
    bindings.push(startMethod);
  } else {
    // "Alla" is the union of the two supported factual start methods, not a
    // license to mix unknown/unsupported source values into denominators.
    conditions.push(`${canonicalStartMethodSql(alias)} IN ('auto','volt')`);
  }
  conditions.push(distanceCondition(distanceGroup, bindings, alias));
  if (asOf) {
    conditions.push(`${alias}.race_date < ?`);
    bindings.push(String(asOf).slice(0, 10));
  }
}

function appendAsOfSourceConditions(conditions, bindings, { asOf, sourceAlias = 'sr', resultSourceAlias = 'rrs' }) {
  if (!asOf) return;
  conditions.push(`julianday(${sourceAlias}.fetched_at) <= julianday(?)`);
  bindings.push(asOf);
  conditions.push(`rr.source_record_id IS NOT NULL`);
  conditions.push(`julianday(${resultSourceAlias}.fetched_at) <= julianday(?)`);
  bindings.push(asOf);
}

async function loadTrack(env, trackId) {
  return env.DB.prepare(`
    SELECT id,canonical_name,country_code
    FROM tracks
    WHERE id=?
    LIMIT 1
  `).bind(trackId).first();
}

async function loadScenarioRows(env, { trackId = null, countryCode = null, excludeTrackId = null, startMethod, distanceGroup, asOf }) {
  const conditions = [
    'rp.classification_version = ?',
    're.scratched = 0',
    "rr.result_status = 'official'"
  ];
  const bindings = [XLABS_TRIP_CLASSIFICATION_VERSION];
  if (trackId) { conditions.push('r.track_id = ?'); bindings.push(trackId); }
  if (countryCode) { conditions.push('t.country_code = ?'); bindings.push(countryCode); }
  if (excludeTrackId) { conditions.push('r.track_id <> ?'); bindings.push(excludeTrackId); }
  appendContextConditions(conditions, bindings, { startMethod, distanceGroup, asOf });
  appendAsOfSourceConditions(conditions, bindings, { asOf });
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT rp.id,rp.race_entry_id,rp.event_json,rp.leader,rp.pocket,rp.death_seat,rp.second_over,rp.third_over,
        rp.confidence,rp.evidence_type,rp.observed_at_m,rp.classification_version,rp.source_record_id,
        r.id AS race_id,r.race_date,${canonicalStartMethodSql()} AS start_method,r.distance_m,
        rr.placing,re.actual_lane,sr.fetched_at AS source_selected_at,
        ROW_NUMBER() OVER (PARTITION BY rp.race_entry_id ORDER BY julianday(sr.fetched_at) DESC,rp.id DESC) AS row_number
      FROM race_positions rp
      JOIN source_records sr ON sr.id=rp.source_record_id
      JOIN race_entries re ON re.id=rp.race_entry_id
      JOIN races r ON r.id=re.race_id
      JOIN tracks t ON t.id=r.track_id
      JOIN race_results rr ON rr.race_entry_id=re.id
      LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
      WHERE ${conditions.join(' AND ')}
    )
    SELECT * FROM ranked WHERE row_number=1 ORDER BY race_date,race_id,race_entry_id
  `).bind(...bindings).all();
  return (results || []).map((row) => ({
    raceEntryId: row.race_entry_id,raceId: row.race_id,raceDate: row.race_date,startMethod: row.start_method,
    distanceM: finiteOrNull(row.distance_m),actualLane: finiteOrNull(row.actual_lane),placing: finiteOrNull(row.placing),
    scenarioKey: scenarioKeyFromRow(row),scenarioLabel: scenarioLabelFromRow(row),confidence: finiteOrNull(row.confidence),
    evidenceType: row.evidence_type || null,observedAtM: finiteOrNull(row.observed_at_m),classificationVersion: row.classification_version,
    sourceRecordId: row.source_record_id,sourceSelectedAt: row.source_selected_at || null
  })).filter((row) => row.scenarioKey);
}

function scenarioKeyFromRow(row) {
  if (Number(row?.leader) === 1) return 'leader';
  if (Number(row?.pocket) === 1) return 'pocket';
  if (Number(row?.death_seat) === 1) return 'death_seat';
  if (Number(row?.second_over) === 1) return 'second_over';
  if (Number(row?.third_over) === 1) return 'third_over';
  try { const key=String((row?.event_json ? JSON.parse(row.event_json) : null)?.scenario_key || ''); return SCENARIO_LABELS[key] ? key : null; }
  catch { return null; }
}

function scenarioLabelFromRow(row) {
  const key=scenarioKeyFromRow(row); if (!key) return null;
  try { return (row?.event_json ? JSON.parse(row.event_json) : null)?.scenario_label || SCENARIO_LABELS[key]; }
  catch { return SCENARIO_LABELS[key]; }
}

async function loadPositionRows(env, { trackId = null, countryCode = null, excludeTrackId = null, startMethod, distanceGroup, asOf }) {
  const conditions = [
    'rpc.reconstruction_version = ?',
    `rpc.checkpoint_key IN ('100m','200m')`,
    'rpc.position_rank IS NOT NULL',
    'rpc.field_coverage >= ?',
    'rpc.longitudinal_confidence >= ?',
    're.scratched = 0',
    're.actual_lane BETWEEN 1 AND 8',
    `(${canonicalStartMethodSql()} <> 'volt' OR re.start_tier = 1)`,
    "rr.result_status = 'official'"
  ];
  const bindings = [XLABS_POSITION_RECONSTRUCTION_VERSION, POSITION_EXACT_FIELD_COVERAGE_MIN, POSITION_LONGITUDINAL_CONFIDENCE_MIN];
  if (trackId) { conditions.push('r.track_id = ?'); bindings.push(trackId); }
  if (countryCode) { conditions.push('t.country_code = ?'); bindings.push(countryCode); }
  if (excludeTrackId) { conditions.push('r.track_id <> ?'); bindings.push(excludeTrackId); }
  appendContextConditions(conditions, bindings, { startMethod, distanceGroup, asOf });
  appendAsOfSourceConditions(conditions, bindings, { asOf });
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT rpc.id,rpc.race_entry_id,rpc.checkpoint_key,rpc.position_rank,rpc.field_coverage,rpc.local_target_coverage,rpc.longitudinal_confidence,
        rpc.source_record_id,rpc.reconstruction_version,rpc.leader_progress_m,r.id AS race_id,r.race_date,${canonicalStartMethodSql()} AS start_method,r.distance_m,
        re.actual_lane,re.start_tier,re.handicap_m,sr.fetched_at AS source_selected_at,
        ROW_NUMBER() OVER (PARTITION BY rpc.race_entry_id,rpc.checkpoint_key ORDER BY julianday(sr.fetched_at) DESC,rpc.id DESC) AS row_number
      FROM race_position_checkpoints rpc
      JOIN source_records sr ON sr.id=rpc.source_record_id
      JOIN race_entries re ON re.id=rpc.race_entry_id
      JOIN races r ON r.id=re.race_id
      JOIN tracks t ON t.id=r.track_id
      JOIN race_results rr ON rr.race_entry_id=re.id
      LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
      WHERE ${conditions.join(' AND ')}
    )
    SELECT * FROM ranked WHERE row_number=1 ORDER BY race_date,race_id,race_entry_id
  `).bind(...bindings).all();
  return (results || []).map((row)=>({raceEntryId:row.race_entry_id,raceId:row.race_id,raceDate:row.race_date,startMethod:row.start_method,
    checkpointKey:row.checkpoint_key,distanceM:finiteOrNull(row.distance_m),actualLane:finiteOrNull(row.actual_lane),startTier:finiteOrNull(row.start_tier),handicapM:finiteOrNull(row.handicap_m),positionRank:finiteOrNull(row.position_rank),
    leaderProgressM:finiteOrNull(row.leader_progress_m),fieldCoverage:finiteOrNull(row.field_coverage),localTargetCoverage:finiteOrNull(row.local_target_coverage),longitudinalConfidence:finiteOrNull(row.longitudinal_confidence),
    sourceRecordId:row.source_record_id,sourceSelectedAt:row.source_selected_at||null}));
}


async function loadEarly500Rows(env, { trackId = null, countryCode = null, excludeTrackId = null, startMethod, distanceGroup, asOf }) {
  // Start from the much smaller race/entry context and probe the 500 m checkpoint
  // by race_entry_id. On production history, starting from checkpoint_key='500m'
  // can force D1 to scan the nationwide checkpoint population before track,
  // distance and start-method filters are applied.
  const entryConditions = [
    're.scratched = 0',
    "rr.result_status = 'official'"
  ];
  const entryBindings = [];
  if (trackId) { entryConditions.push('r.track_id = ?'); entryBindings.push(trackId); }
  if (countryCode) { entryConditions.push('t.country_code = ?'); entryBindings.push(countryCode); }
  if (excludeTrackId) { entryConditions.push('r.track_id <> ?'); entryBindings.push(excludeTrackId); }
  appendContextConditions(entryConditions, entryBindings, { startMethod, distanceGroup, asOf });
  if (asOf) {
    entryConditions.push('rr.source_record_id IS NOT NULL');
    entryConditions.push('julianday(rrs.fetched_at) <= julianday(?)');
    entryBindings.push(asOf);
  }

  const checkpointConditions = [
    'rpc.reconstruction_version = ?',
    "rpc.checkpoint_key = '500m'",
    'rpc.position_rank IS NOT NULL',
    'rpc.field_coverage >= ?',
    'rpc.longitudinal_confidence >= ?'
  ];
  const checkpointBindings = [
    XLABS_POSITION_RECONSTRUCTION_VERSION,
    POSITION_EXACT_FIELD_COVERAGE_MIN,
    POSITION_LONGITUDINAL_CONFIDENCE_MIN
  ];
  if (asOf) {
    checkpointConditions.push('julianday(sr.fetched_at) <= julianday(?)');
    checkpointBindings.push(asOf);
  }

  const { results } = await env.DB.prepare(`
    WITH eligible_entries AS MATERIALIZED (
      SELECT re.id AS race_entry_id,r.id AS race_id,r.race_date,
        ${canonicalStartMethodSql()} AS start_method,r.distance_m,rr.placing
      FROM tracks t
      JOIN races r ON r.track_id=t.id
      JOIN race_entries re INDEXED BY idx_entries_race ON re.race_id=r.id
      JOIN race_results rr ON rr.race_entry_id=re.id
      LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
      WHERE ${entryConditions.join(' AND ')}
    ),
    ranked AS (
      SELECT rpc.id,rpc.race_entry_id,rpc.position_rank,rpc.meters_behind_leader,
        rpc.field_coverage,rpc.longitudinal_confidence,rpc.source_record_id,
        e.race_id,e.race_date,e.start_method,e.distance_m,e.placing,
        sr.fetched_at AS source_selected_at,
        ROW_NUMBER() OVER (
          PARTITION BY rpc.race_entry_id,rpc.checkpoint_key
          ORDER BY julianday(sr.fetched_at) DESC,rpc.id DESC
        ) AS row_number
      FROM eligible_entries e
      JOIN race_position_checkpoints rpc INDEXED BY idx_position_checkpoints_entry_analysis
        ON rpc.race_entry_id=e.race_entry_id
      JOIN source_records sr ON sr.id=rpc.source_record_id
      WHERE ${checkpointConditions.join(' AND ')}
    )
    SELECT * FROM ranked WHERE row_number=1 ORDER BY race_date,race_id,race_entry_id
  `).bind(...entryBindings, ...checkpointBindings).all();
  return (results || []).map((row)=>({
    raceEntryId:row.race_entry_id,raceId:row.race_id,raceDate:row.race_date,startMethod:row.start_method,
    distanceM:finiteOrNull(row.distance_m),placing:finiteOrNull(row.placing),positionRank:finiteOrNull(row.position_rank),
    metersBehindLeader:finiteOrNull(row.meters_behind_leader),fieldCoverage:finiteOrNull(row.field_coverage),
    longitudinalConfidence:finiteOrNull(row.longitudinal_confidence),sourceRecordId:row.source_record_id,
    sourceSelectedAt:row.source_selected_at||null
  }));
}

async function loadLaneOutcomeRows(env, trackId, { startMethod, distanceGroup, asOf }) {
  const conditions=['r.track_id = ?','re.scratched = 0','re.actual_lane BETWEEN 1 AND 8',"rr.result_status = 'official'"];
  const bindings=[trackId];
  appendContextConditions(conditions,bindings,{startMethod,distanceGroup,asOf});
  if(asOf){
    conditions.push('rr.source_record_id IS NOT NULL');
    conditions.push('julianday(rrs.fetched_at) <= julianday(?)');
    bindings.push(asOf);
  }
  const {results}=await env.DB.prepare(`
    SELECT r.id AS race_id,r.race_date,${canonicalStartMethodSql()} AS start_method,
      re.actual_lane,rr.placing
    FROM race_entries re
    JOIN races r ON r.id=re.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.race_date,r.id,re.actual_lane
  `).bind(...bindings).all();
  return (results||[]).map((row)=>({
    raceId:row.race_id,raceDate:row.race_date,startMethod:row.start_method,
    lane:finiteOrNull(row.actual_lane),placing:finiteOrNull(row.placing)
  }));
}

function sampleStatus(races) { return races>=25?'normal':races>=10?'limited':'sparse'; }
function contextLabel(method,distance) { return `${method==='auto'?'Autostart':method==='volt'?'Voltstart':'Alla startmetoder'}, ${distance==='all'?'alla distanser':distance+' m'}`; }

async function loadEligibleCoverageCounts(env, trackId, { startMethod, distanceGroup, asOf }) {
  const conditions=['r.track_id = ?','re.scratched = 0',"rr.result_status = 'official'"];
  const bindings=[trackId];
  appendContextConditions(conditions,bindings,{startMethod,distanceGroup,asOf});
  if(asOf){
    conditions.push('rr.source_record_id IS NOT NULL');
    conditions.push('julianday(rrs.fetched_at) <= julianday(?)');
    bindings.push(asOf);
  }
  const row=await env.DB.prepare(`
    SELECT
      COUNT(*) AS official_starts,
      COUNT(DISTINCT r.id) AS official_races,
      SUM(CASE WHEN re.actual_lane BETWEEN 1 AND 8 AND (
        ${canonicalStartMethodSql()} = 'auto' OR (${canonicalStartMethodSql()} = 'volt' AND re.start_tier = 1)
      ) THEN 1 ELSE 0 END) AS lane_starts,
      COUNT(DISTINCT CASE WHEN rr.placing=1 THEN r.id END) AS winner_races,
      COUNT(DISTINCT CASE WHEN rr.placing=1 THEN re.id END) AS winner_entries
    FROM race_entries re
    JOIN races r ON r.id=re.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
    WHERE ${conditions.join(' AND ')}
  `).bind(...bindings).first();
  return {
    officialStarts:Number(row?.official_starts||0),
    officialRaces:Number(row?.official_races||0),
    laneStarts:Number(row?.lane_starts||0),
    winnerRaces:Number(row?.winner_races||0),
    winnerEntries:Number(row?.winner_entries||0)
  };
}

async function countScenarioRaces(env, trackId, { startMethod, distanceGroup, asOf }) {
  const conditions=['rp.classification_version = ?','r.track_id = ?','re.scratched = 0',"rr.result_status = 'official'"];
  const bindings=[XLABS_TRIP_CLASSIFICATION_VERSION,trackId];
  appendContextConditions(conditions,bindings,{startMethod,distanceGroup,asOf}); appendAsOfSourceConditions(conditions,bindings,{asOf});
  const row=await env.DB.prepare(`WITH ranked AS (
    SELECT r.id AS race_id,rp.race_entry_id,ROW_NUMBER() OVER (PARTITION BY rp.race_entry_id ORDER BY julianday(sr.fetched_at) DESC,rp.id DESC) AS row_number
    FROM race_positions rp JOIN source_records sr ON sr.id=rp.source_record_id JOIN race_entries re ON re.id=rp.race_entry_id
    JOIN races r ON r.id=re.race_id JOIN race_results rr ON rr.race_entry_id=re.id LEFT JOIN source_records rrs ON rrs.id=rr.source_record_id
    WHERE ${conditions.join(' AND ')}) SELECT COUNT(DISTINCT race_id) AS races FROM ranked WHERE row_number=1`).bind(...bindings).first();
  return Number(row?.races||0);
}

async function resolveAnalysisBasis(env,trackId,selected) {
  const selectedRaces=await countScenarioRaces(env,trackId,selected), selectedStatus=sampleStatus(selectedRaces);
  if (selectedRaces>=10) return {selectedRaces,selectedStatus,startMethod:selected.startMethod,distanceGroup:selected.distanceGroup,backoffLevel:'exact'};
  const candidates=[];
  // Start method fundamentally changes lane semantics. Interpretation support may broaden
  // distance, but must never silently cross from auto to volt or vice versa.
  if (selected.startMethod!=='all'&&selected.distanceGroup!=='all') {
    candidates.push({startMethod:selected.startMethod,distanceGroup:'all',backoffLevel:'track_start_method'});
  } else if (selected.startMethod==='all'&&selected.distanceGroup!=='all') {
    candidates.push({startMethod:'all',distanceGroup:'all',backoffLevel:'track_overall'});
  }
  let fallback={startMethod:selected.startMethod,distanceGroup:selected.distanceGroup,backoffLevel:'exact',races:selectedRaces};
  for (const candidate of candidates) {
    const races=await countScenarioRaces(env,trackId,{...candidate,asOf:selected.asOf});
    fallback={...candidate,races};
    if (races>=10) break;
  }
  return {selectedRaces,selectedStatus,startMethod:fallback.startMethod,distanceGroup:fallback.distanceGroup,backoffLevel:fallback.backoffLevel,basisRaces:fallback.races};
}

function aggregateStartPositions(rows,baselineRows,startMethod) {
  const methods=startMethod==='all'?['auto','volt']:[startMethod];
  return methods.map((method)=>{
    const mine=rows.filter(r=>r.startMethod===method), base=baselineRows.filter(r=>r.startMethod===method), out=[];
    for(let lane=1;lane<=8;lane++){
      const a=mine.filter(r=>r.actualLane===lane), b=base.filter(r=>r.actualLane===lane);
      const lead=ratio(a.filter(r=>r.positionRank===1).length,a.length), top3=ratio(a.filter(r=>r.positionRank<=3).length,a.length);
      const blead=ratio(b.filter(r=>r.positionRank===1).length,b.length), btop3=ratio(b.filter(r=>r.positionRank<=3).length,b.length);
      out.push({lane,observations:a.length,races:new Set(a.map(r=>r.raceId)).size,lead_rate:round(lead),top3_rate:round(top3),median_position:round(median(a.map(r=>r.positionRank)),1),
        baseline:{observations:b.length,races:new Set(b.map(r=>r.raceId)).size,lead_rate:round(blead),top3_rate:round(btop3),median_position:round(median(b.map(r=>r.positionRank)),1)},
        lead_delta_pp:percentagePointDelta(lead,blead),top3_delta_pp:percentagePointDelta(top3,btop3)});
    }
    return {start_method:method,label:method==='auto'?'Autostart':'Voltstart · grunddistans',position_scope:method==='volt'?'ground_distance_only':'all_eligible',observations:mine.length,races:new Set(mine.map(r=>r.raceId)).size,rows:out};
  });
}

function scenarioMetrics(rows) {
  const winners=rows.filter(r=>r.placing===1).length, map=new Map(SCENARIO_ORDER.map(k=>[k,[]]));
  for(const row of rows) if(map.has(row.scenarioKey)) map.get(row.scenarioKey).push(row);
  return SCENARIO_ORDER.map(key=>{const a=map.get(key),wins=a.filter(r=>r.placing===1).length,top3=a.filter(r=>r.placing>=1&&r.placing<=3).length;
    return {scenario_key:key,scenario_label:SCENARIO_LABELS[key],starts:a.length,races:new Set(a.map(r=>r.raceId)).size,winner_observations:winners,occurrence_rate:round(ratio(a.length,rows.length)),wins,win_rate:round(ratio(wins,a.length)),top3,top3_rate:round(ratio(top3,a.length)),winner_share:round(ratio(wins,winners))};});
}

function aggregateScenarios(rows,baselineRows) {
  const base=new Map(scenarioMetrics(baselineRows).map(r=>[r.scenario_key,r]));
  return scenarioMetrics(rows).map(row=>{const b=base.get(row.scenario_key); return {...row,measurement_point:'500m_remaining',measurement_label:'500 m kvar',baseline:b?{starts:b.starts,races:b.races,winner_observations:b.winner_observations,occurrence_rate:b.occurrence_rate,win_rate:b.win_rate,top3_rate:b.top3_rate,winner_share:b.winner_share}:null,
    occurrence_delta_pp:percentagePointDelta(row.occurrence_rate,b?.occurrence_rate),win_rate_delta_pp:percentagePointDelta(row.win_rate,b?.win_rate),top3_delta_pp:percentagePointDelta(row.top3_rate,b?.top3_rate),winner_share_delta_pp:percentagePointDelta(row.winner_share,b?.winner_share)};});
}

function earlyLeaderMetric(rows) {
  const leaders=(rows||[]).filter((row)=>row.positionRank===1);
  const winners=(rows||[]).filter((row)=>row.placing===1);
  const wins=leaders.filter((row)=>row.placing===1).length;
  const top3=leaders.filter((row)=>row.placing>=1&&row.placing<=3).length;
  return {
    scenario_key:'leader',scenario_label:SCENARIO_LABELS.leader,
    measurement_point:'500m_after_start',measurement_label:'500 m efter start',
    starts:leaders.length,races:new Set(leaders.map((row)=>row.raceId)).size,winner_observations:winners.length,
    occurrence_rate:round(ratio(leaders.length,rows.length)),wins,win_rate:round(ratio(wins,leaders.length)),
    top3,top3_rate:round(ratio(top3,leaders.length)),winner_share:round(ratio(wins,winners.length))
  };
}

function aggregateMixedScenarios(lateRows,baselineLateRows,earlyRows,baselineEarlyRows) {
  const late=aggregateScenarios(lateRows,baselineLateRows).filter((row)=>row.scenario_key!=='leader');
  const leader=earlyLeaderMetric(earlyRows),baseLeader=earlyLeaderMetric(baselineEarlyRows);
  const leaderWithBaseline={...leader,baseline:{starts:baseLeader.starts,races:baseLeader.races,winner_observations:baseLeader.winner_observations,occurrence_rate:baseLeader.occurrence_rate,win_rate:baseLeader.win_rate,top3_rate:baseLeader.top3_rate,winner_share:baseLeader.winner_share},
    occurrence_delta_pp:percentagePointDelta(leader.occurrence_rate,baseLeader.occurrence_rate),
    win_rate_delta_pp:percentagePointDelta(leader.win_rate,baseLeader.win_rate),
    top3_delta_pp:percentagePointDelta(leader.top3_rate,baseLeader.top3_rate),
    winner_share_delta_pp:percentagePointDelta(leader.winner_share,baseLeader.winner_share)};
  return [leaderWithBaseline,...late];
}

function aggregateLaneOutcomes(rows) {
  const out=[];
  for(let lane=1;lane<=8;lane++){
    const a=(rows||[]).filter((row)=>row.lane===lane);
    const wins=a.filter((row)=>row.placing===1).length;
    out.push({lane,result_starts:a.length,wins,win_rate:round(ratio(wins,a.length))});
  }
  return {result_starts:(rows||[]).length,rows:out};
}

function coverage(pos100,pos200,scen,eligible,early500=[]){const races=new Set(scen.map(r=>r.raceId)),wins=new Set(scen.filter(r=>r.placing===1).map(r=>r.raceEntryId)),earlyRaces=new Set(early500.map(r=>r.raceId)),earlyWinners=new Set(early500.filter(r=>r.placing===1).map(r=>r.raceEntryId));return {eligible:{official_starts:eligible.officialStarts,official_races:eligible.officialRaces,lane_starts:eligible.laneStarts,winner_races:eligible.winnerRaces,winner_entries:eligible.winnerEntries},position_100m:{observations:pos100.length,races:new Set(pos100.map(r=>r.raceId)).size,observation_coverage:round(ratio(pos100.length,eligible.laneStarts))},position_200m:{observations:pos200.length,races:new Set(pos200.map(r=>r.raceId)).size,observation_coverage:round(ratio(pos200.length,eligible.laneStarts))},leader_500m_after_start:{observations:early500.length,races:earlyRaces.size,observation_coverage:round(ratio(early500.length,eligible.officialStarts)),winners_with_observation:earlyWinners.size,winner_coverage:round(ratio(earlyWinners.size,eligible.winnerEntries))},trip_scenario:{observations:scen.length,races_with_any_scenario:races.size,observation_coverage:round(ratio(scen.length,eligible.officialStarts)),winners_with_scenario:wins.size,winner_scenario_coverage:round(ratio(wins.size,eligible.winnerEntries))}};}
function sourcePeriod(a,b){const d=[...a,...b].map(r=>r.raceDate).filter(Boolean).sort();return {first_race_date:d[0]||null,last_race_date:d.at(-1)||null};}
function swedishList(values) {
  const items = values.filter(Boolean).map(String);
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} och ${items[1]}`;
  return `${items.slice(0,-1).join(', ')} och ${items.at(-1)}`;
}

function scenarioPhrase(key) {
  if (key === 'back') return 'längre bak i fältet';
  return SCENARIO_LABELS[key]?.toLowerCase() || key;
}

function wilsonInterval(rate, observations, z = 1.96) {
  if (!Number.isFinite(rate) || !Number.isFinite(observations) || observations <= 0) return null;
  const n = observations;
  const z2 = z * z;
  const denominator = 1 + (z2 / n);
  const center = (rate + (z2 / (2 * n))) / denominator;
  const spread = (z * Math.sqrt((rate * (1 - rate) / n) + (z2 / (4 * n * n)))) / denominator;
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

function comparisonDirection(value, observations, baseline, baselineObservations, minimumDeltaPp) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return null;
  if (observations < TRACK_ANALYSIS_SAMPLE_POLICY.comparisonMinObservations ||
      baselineObservations < TRACK_ANALYSIS_SAMPLE_POLICY.comparisonMinObservations) return null;
  const deltaPp = Math.abs((value - baseline) * 100);
  if (deltaPp < minimumDeltaPp) return null;
  const currentInterval = wilsonInterval(value, observations);
  const baselineInterval = wilsonInterval(baseline, baselineObservations);
  if (!currentInterval || !baselineInterval) return null;
  if (currentInterval[0] > baselineInterval[1]) return 'higher';
  if (currentInterval[1] < baselineInterval[0]) return 'lower';
  return null;
}

function rowsWithNormalLaneSample(section) {
  return (section?.rows || []).filter((row) =>
    row.observations >= TRACK_ANALYSIS_SAMPLE_POLICY.normalMinRaces &&
    row.lead_rate != null
  );
}

function laneLabelList(rows,field) {
  return swedishList(rows.map((row)=>`spår ${row.lane} (${Math.round(Number(row[field]||0)*100)} %)`));
}

function observedLeadSummary(sections) {
  const visible=(sections||[]).filter((section)=>(section.observations||0)>0);
  const multiple=visible.length>1;
  const sentences=[];
  for(const section of visible){
    const rows=(section.rows||[]).filter((row)=>row.observations>0&&row.lead_rate!=null)
      .sort((a,b)=>b.lead_rate-a.lead_rate||b.observations-a.observations||a.lane-b.lane).slice(0,3);
    if(!rows.length)continue;
    const prefix=multiple?`${section.start_method==='auto'?'Autostart':'Voltstart'}: `:'';
    sentences.push(`${prefix}Högst observerad spetsfrekvens efter 200 m har ${laneLabelList(rows,'lead_rate')}.`);
  }
  return sentences.length?sentences.join(' '):null;
}

function comparisonTrackPhrase(countryCode) {
  if (countryCode === 'SE') return 'andra svenska banor';
  if (countryCode === 'NO') return 'andra norska banor';
  if (countryCode === 'DK') return 'andra danska banor';
  return 'andra banor i samma land';
}

function laneComparisonSummary(sections,countryCode) {
  const visible=(sections||[]).filter((section)=>(section.observations||0)>0);
  const multiple=visible.length>1;
  const sentences=[];
  const comparison= comparisonTrackPhrase(countryCode);
  for(const section of visible){
    const rows=rowsWithNormalLaneSample(section);
    const higher=rows.filter((row)=>comparisonDirection(row.lead_rate,row.observations,row.baseline?.lead_rate,row.baseline?.observations,LEAD_COMPARISON_MIN_DELTA_PP)==='higher').map((row)=>row.lane);
    const lower=rows.filter((row)=>comparisonDirection(row.lead_rate,row.observations,row.baseline?.lead_rate,row.baseline?.observations,LEAD_COMPARISON_MIN_DELTA_PP)==='lower').map((row)=>row.lane);
    if(!higher.length&&!lower.length)continue;
    const prefix=multiple?`${section.start_method==='auto'?'Autostart':'Voltstart'}: `:'';
    let text='';
    if(higher.length&&lower.length) text=`Jämfört med ${comparison} når spår ${swedishList(higher)} ledningen tydligt oftare här, medan spår ${swedishList(lower)} gör det tydligt mer sällan.`;
    else if(higher.length) text=`Jämfört med ${comparison} når spår ${swedishList(higher)} ledningen tydligt oftare här.`;
    else text=`Jämfört med ${comparison} når spår ${swedishList(lower)} ledningen tydligt mer sällan här.`;
    sentences.push(prefix+text);
  }
  return sentences.length?sentences.join(' '):null;
}

function laneWinSummary(laneOutcomes) {
  const rows=(laneOutcomes?.rows||[]).filter((row)=>row.result_starts>0&&row.win_rate!=null);
  if(rows.length<2)return null;
  const count=Math.min(3,rows.length);
  if(!count)return null;
  const best=[...rows].sort((a,b)=>b.win_rate-a.win_rate||b.result_starts-a.result_starts||a.lane-b.lane).slice(0,count);
  const worst=[...rows].sort((a,b)=>a.win_rate-b.win_rate||b.result_starts-a.result_starts||a.lane-b.lane).slice(0,count);
  if(!worst.length)return null;
  return `Högst observerad segerprocent har ${laneLabelList(best,'win_rate')}. Lägst har ${laneLabelList(worst,'win_rate')}.`;
}

function scenarioWinSummary(rows,countryCode) {
  const leader=(rows||[]).find((row)=>row.scenario_key==='leader'&&row.starts>0&&row.win_rate!=null);
  const other=(rows||[]).filter((row)=>row.scenario_key!=='leader'&&row.starts>0&&row.win_rate!=null)
    .sort((a,b)=>b.win_rate-a.win_rate||b.starts-a.starts||SCENARIO_ORDER.indexOf(a.scenario_key)-SCENARIO_ORDER.indexOf(b.scenario_key)).slice(0,3);
  const parts=[];
  const comparison=comparisonTrackPhrase(countryCode);
  if(leader){
    let text=`Hästar som satt i ledningen 500 m efter start vann ${Math.round(leader.win_rate*100)} % av loppen.`;
    const direction=comparisonDirection(leader.win_rate,leader.starts,leader.baseline?.win_rate,leader.baseline?.starts,SCENARIO_WIN_COMPARISON_MIN_DELTA_PP);
    if(direction==='higher')text+=` Det är tydligt högre än på ${comparison}.`;
    else if(direction==='lower')text+=` Det är tydligt lägre än på ${comparison}.`;
    parts.push(text);
  }
  if(other.length){
    const labels=swedishList(other.map((row)=>`${scenarioPhrase(row.scenario_key)} (${Math.round(row.win_rate*100)} %)`));
    let text=`Bland övriga positioner 500 m kvar var segerprocenten högst för ${labels}.`;
    const standout=other.find((row)=>comparisonDirection(row.win_rate,row.starts,row.baseline?.win_rate,row.baseline?.starts,SCENARIO_WIN_COMPARISON_MIN_DELTA_PP));
    if(standout){
      const direction=comparisonDirection(standout.win_rate,standout.starts,standout.baseline?.win_rate,standout.baseline?.starts,SCENARIO_WIN_COMPARISON_MIN_DELTA_PP);
      text+=` ${scenarioPhrase(standout.scenario_key).replace(/^./,(ch)=>ch.toUpperCase())} ger en tydligt ${direction==='higher'?'högre':'lägre'} segerprocent här än på ${comparison}.`;
    }
    parts.push(text);
  }
  return parts.length?parts.join(' '):null;
}

function hasNormalLaneSample(sections) {
  return (sections || []).some((section) => rowsWithNormalLaneSample(section).length > 0);
}

function hasNormalWinnerSample(rows) {
  return Number(rows?.find((row)=>row.scenario_key!=='leader')?.winner_observations || 0) >= TRACK_ANALYSIS_SAMPLE_POLICY.normalMinRaces;
}

function buildSummary({laneSections,comparisonLaneSections,laneOutcomes,scenarioRows,countryCode}) {
  const out=[];
  for(const item of [
    observedLeadSummary(laneSections),
    laneComparisonSummary(comparisonLaneSections,countryCode),
    laneWinSummary(laneOutcomes),
    scenarioWinSummary(scenarioRows,countryCode)
  ]) if(item) out.push(item);
  return out.slice(0,5);
}

async function loadTrackContext(env,trackId,{startMethod,distanceGroup,asOf}){
  const cond=["track_id=?","status='active'"],bind=[trackId],date=asOf?String(asOf).slice(0,10):null;
  if(asOf){cond.push('julianday(verified_at) <= julianday(?)');bind.push(asOf);cond.push('(layout_effective_from IS NULL OR layout_effective_from <= ?)');bind.push(date);}
  const {results}=await env.DB.prepare(`SELECT fact_type,numeric_value,evidence_type,source_type,verified_at,layout_effective_from FROM (SELECT fact_type,numeric_value,evidence_type,source_type,verified_at,layout_effective_from,id,ROW_NUMBER() OVER (PARTITION BY fact_type ORDER BY COALESCE(layout_effective_from,SUBSTR(verified_at,1,10)) DESC,CASE evidence_type WHEN 'verified' THEN 0 ELSE 1 END,verified_at DESC,id DESC) row_number FROM track_profile_fact_observations WHERE ${cond.join(' AND ')}) WHERE row_number=1`).bind(...bind).all();
  const facts={};for(const r of results||[])facts[r.fact_type]={value:finiteOrNull(r.numeric_value),evidence_type:r.evidence_type||null,source_type:r.source_type||null,verified_at:r.verified_at||null,layout_effective_from:r.layout_effective_from||null};
  let turn=null;if(startMethod!=='all'&&distanceGroup!=='all'){const c=["track_id=?","status='active'",'start_method=?','race_distance_m=?'],b=[trackId,startMethod,Number(distanceGroup)];if(asOf){c.push('julianday(verified_at) <= julianday(?)');b.push(asOf);c.push('(layout_effective_from IS NULL OR layout_effective_from <= ?)');b.push(date);}turn=await env.DB.prepare(`SELECT race_distance_m,start_method,distance_to_first_turn_m,evidence_type,source_type,verified_at,layout_effective_from FROM track_first_turn_distances WHERE ${c.join(' AND ')} ORDER BY COALESCE(layout_effective_from,SUBSTR(verified_at,1,10)) DESC,CASE evidence_type WHEN 'verified' THEN 0 ELSE 1 END,verified_at DESC,id DESC LIMIT 1`).bind(...b).first();}
  const width=distanceGroup==='1640'?'width_1640_m':distanceGroup==='2140'?'width_2140_m':null;
  return {lap_length_m:facts.lap_length_m||null,home_stretch_m:facts.home_stretch_m||null,open_stretch_lanes:facts.open_stretch_lanes||null,angled_mobile_wing:facts.angled_mobile_wing||null,relevant_width_m:width?facts[width]||null:null,large_curve_radius_m:facts.large_curve_radius_m||null,first_turn_radius_m:facts.first_turn_radius_m||null,second_turn_radius_m:facts.second_turn_radius_m||null,first_turn_banking_percent:facts.first_turn_banking_percent||null,second_turn_banking_percent:facts.second_turn_banking_percent||null,distance_to_first_turn_m:turn?{value:finiteOrNull(turn.distance_to_first_turn_m),evidence_type:turn.evidence_type||null,source_type:turn.source_type||null,verified_at:turn.verified_at||null,layout_effective_from:turn.layout_effective_from||null,race_distance_m:finiteOrNull(turn.race_distance_m),start_method:turn.start_method||null}:null};
}

export async function getTrackAnalysisV1(env,trackIdValue,options={}){
  if(!env?.DB)throw new Error('DB is not configured');const trackId=String(trackIdValue||'').trim();if(!trackId)return null;const track=await loadTrack(env,trackId);if(!track)return null;
  const startMethod=normalizeTrackAnalysisStartMethod(options.startMethod??'all'),distanceGroup=normalizeTrackAnalysisDistanceGroup(options.distanceGroup??'all'),asOf=options.asOf==null?null:new Date(options.asOf).toISOString();
  const resolved=await resolveAnalysisBasis(env,trackId,{startMethod,distanceGroup,asOf});
  const selectedContext={startMethod,distanceGroup,asOf};
  const basisContext={startMethod:resolved.startMethod,distanceGroup:resolved.distanceGroup,asOf};
  const sameBasis=resolved.backoffLevel==='exact';
  const [exactPos,exactBaselinePos,exactScen,exactBaselineScen,exactEarly500,exactBaselineEarly500,exactLaneOutcomeRows,exactEligible,trackContext]=await Promise.all([
    loadPositionRows(env,{trackId,...selectedContext}),
    track.country_code?loadPositionRows(env,{countryCode:track.country_code,excludeTrackId:trackId,...selectedContext}):[],
    loadScenarioRows(env,{trackId,...selectedContext}),
    track.country_code?loadScenarioRows(env,{countryCode:track.country_code,excludeTrackId:trackId,...selectedContext}):[],
    loadEarly500Rows(env,{trackId,...selectedContext}),
    track.country_code?loadEarly500Rows(env,{countryCode:track.country_code,excludeTrackId:trackId,...selectedContext}):[],
    loadLaneOutcomeRows(env,trackId,selectedContext),
    loadEligibleCoverageCounts(env,trackId,selectedContext),
    loadTrackContext(env,trackId,selectedContext)
  ]);
  const [basisPos,basisBaselinePos,basisScen,basisBaselineScen,basisEarly500,basisBaselineEarly500,basisEligible]=sameBasis
    ? [exactPos,exactBaselinePos,exactScen,exactBaselineScen,exactEarly500,exactBaselineEarly500,exactEligible]
    : await Promise.all([
        loadPositionRows(env,{trackId,...basisContext}),
        track.country_code?loadPositionRows(env,{countryCode:track.country_code,excludeTrackId:trackId,...basisContext}):[],
        loadScenarioRows(env,{trackId,...basisContext}),
        track.country_code?loadScenarioRows(env,{countryCode:track.country_code,excludeTrackId:trackId,...basisContext}):[],
        loadEarly500Rows(env,{trackId,...basisContext}),
        track.country_code?loadEarly500Rows(env,{countryCode:track.country_code,excludeTrackId:trackId,...basisContext}):[],
        loadEligibleCoverageCounts(env,trackId,basisContext)
      ]);
  const exactPos100=exactPos.filter(r=>r.checkpointKey==='100m'),exactPos200=exactPos.filter(r=>r.checkpointKey==='200m');
  const exactBaselinePos100=exactBaselinePos.filter(r=>r.checkpointKey==='100m'),exactBaselinePos200=exactBaselinePos.filter(r=>r.checkpointKey==='200m');
  const basisPos100=basisPos.filter(r=>r.checkpointKey==='100m'),basisPos200=basisPos.filter(r=>r.checkpointKey==='200m');
  const basisBaselinePos100=basisBaselinePos.filter(r=>r.checkpointKey==='100m'),basisBaselinePos200=basisBaselinePos.filter(r=>r.checkpointKey==='200m');
  const exactStart100Sections=aggregateStartPositions(exactPos100,exactBaselinePos100,startMethod);
  const exactStart200Sections=aggregateStartPositions(exactPos200,exactBaselinePos200,startMethod);
  const exactScenarios=aggregateMixedScenarios(exactScen,exactBaselineScen,exactEarly500,exactBaselineEarly500);
  const exactLaneOutcomes=aggregateLaneOutcomes(exactLaneOutcomeRows);
  const basisStart100Sections=aggregateStartPositions(basisPos100,basisBaselinePos100,resolved.startMethod);
  const basisStart200Sections=aggregateStartPositions(basisPos200,basisBaselinePos200,resolved.startMethod);
  const basisScenarios=aggregateMixedScenarios(basisScen,basisBaselineScen,basisEarly500,basisBaselineEarly500);
  const basisRaces=new Set(basisScen.map(r=>r.raceId)).size;
  const basis={start_method:resolved.startMethod,distance_group:resolved.distanceGroup,label:contextLabel(resolved.startMethod,resolved.distanceGroup),backoff_level:resolved.backoffLevel,races:basisRaces,sample_status:sampleStatus(basisRaces)};
  const selectedSample={races:resolved.selectedRaces,sample_status:resolved.selectedStatus};
  const exactLaneNormal=hasNormalLaneSample(exactStart200Sections);
  const exactWinnerNormal=hasNormalWinnerSample(exactScenarios);
  const useLaneSupport=!exactLaneNormal&&!sameBasis&&hasNormalLaneSample(basisStart200Sections);
  const useScenarioSupport=!exactWinnerNormal&&!sameBasis&&hasNormalWinnerSample(basisScenarios);
  const comparisonLaneSections=useLaneSupport?basisStart200Sections:exactStart200Sections;
  const result={
    contract_version:TRACK_ANALYSIS_CONTRACT,
    analysis_version:TRACK_ANALYSIS_VERSION,
    generated_at:new Date().toISOString(),
    as_of:asOf,
    track:{id:track.id,name:track.canonical_name,country_code:track.country_code||null},
    selection:{start_method:startMethod,distance_group:distanceGroup},
    selected_sample:selectedSample,
    analysis_basis:basis,
    track_context:trackContext,
    start_position_100m:{checkpoint_m:100,role:'supporting_start_signal',quality_scope:'complete_field_rank_only',sections:exactStart100Sections},
    start_position_200m:{checkpoint_m:200,role:'primary_early_position',quality_scope:'complete_field_rank_only',sections:exactStart200Sections},
    lane_outcomes:{role:'observed_lane_win_rates',result_starts:exactLaneOutcomes.result_starts,rows:exactLaneOutcomes.rows},
    trip_scenario_500m_remaining:{measurement_policy:'leader_500m_after_start_others_500m_remaining',leader_after_start_m:500,other_positions_distance_remaining_m:500,rows:exactScenarios},
    coverage:coverage(exactPos100,exactPos200,exactScen,exactEligible,exactEarly500),
    period:sourcePeriod(exactPos,exactScen),
    analysis_support:sameBasis?null:{
      start_position_100m:{checkpoint_m:100,role:'supporting_start_signal',quality_scope:'complete_field_rank_only',sections:basisStart100Sections},
      start_position_200m:{checkpoint_m:200,role:'primary_early_position',quality_scope:'complete_field_rank_only',sections:basisStart200Sections},
      trip_scenario_500m_remaining:{measurement_policy:'leader_500m_after_start_others_500m_remaining',leader_after_start_m:500,other_positions_distance_remaining_m:500,rows:basisScenarios},
      coverage:coverage(basisPos100,basisPos200,basisScen,basisEligible,basisEarly500),
      period:sourcePeriod(basisPos,basisScen)
    }
  };
  result.short_analysis=buildSummary({laneSections:exactStart200Sections,comparisonLaneSections,laneOutcomes:exactLaneOutcomes,scenarioRows:exactScenarios,countryCode:track.country_code||null});
  return result;
}

export async function loadTripScenariosForEntries(env,entryIds,asOf=null){if(!env?.DB)throw new Error('DB is not configured');const ids=[...new Set((entryIds||[]).filter(Boolean).map(String))],out=new Map();for(const group of chunks(ids)){const bindings=[XLABS_TRIP_CLASSIFICATION_VERSION,...group],condition=asOf?'AND julianday(sr.fetched_at) <= julianday(?)':'';if(asOf)bindings.push(new Date(asOf).toISOString());const {results}=await env.DB.prepare(`WITH ranked AS (SELECT rp.*,sr.fetched_at,ROW_NUMBER() OVER (PARTITION BY rp.race_entry_id ORDER BY julianday(sr.fetched_at) DESC,rp.id DESC) row_number FROM race_positions rp JOIN source_records sr ON sr.id=rp.source_record_id WHERE rp.classification_version=? AND rp.race_entry_id IN (${group.map(()=>'?').join(',')}) ${condition}) SELECT * FROM ranked WHERE row_number=1`).bind(...bindings).all();for(const row of results||[]){const key=scenarioKeyFromRow(row);if(!key)continue;out.set(row.race_entry_id,{contract_version:'kentaurai-xlabs-trip-classification-v1',classification_version:row.classification_version,scenario_key:key,scenario_label:scenarioLabelFromRow(row),observed_at_m:finiteOrNull(row.observed_at_m),confidence:finiteOrNull(row.confidence),evidence_type:row.evidence_type||null,source_record_id:row.source_record_id||null,source_selected_at:row.fetched_at||null});}}return out;}
