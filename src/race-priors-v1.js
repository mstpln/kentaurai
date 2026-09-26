import {
  ANALYSIS_V3_FOUNDATION_CONTRACTS,
  ANALYSIS_V3_INITIAL_BACKOFF_POLICY,
  createFeatureProvenance,
  estimateWithHierarchicalBackoff
} from './analysis-v3-foundations.js';
import { classifyRace } from './race-classification.js';
import { RACE_PROPOSITION_PARSER_VERSION } from './race-proposition-v1.js';

export const RACE_PRIOR_CONTRACT_VERSION = 'kentaurai-race-priors-v1';
export const RACE_PRIOR_FEATURE_VERSION = 'race_priors_v1';
export const RACE_PRIOR_QUERY_SHARD_VERSION = 'race_priors_query_year_shards_v1';

export const RACE_PRIOR_POLICY = Object.freeze({
  distanceBuckets: Object.freeze([
    Object.freeze({ key: 'short', min: 0, maxExclusive: 1800 }),
    Object.freeze({ key: 'middle', min: 1800, maxExclusive: 2400 }),
    Object.freeze({ key: 'long', min: 2400, maxExclusive: 3000 }),
    Object.freeze({ key: 'stayer', min: 3000, maxExclusive: null })
  ]),
  fieldBuckets: Object.freeze([
    Object.freeze({ key: 'small', min: 1, max: 8 }),
    Object.freeze({ key: 'medium', min: 9, max: 12 }),
    Object.freeze({ key: 'large', min: 13, max: null })
  ]),
  minEffectiveSampleSize: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize,
  priorEquivalentSampleSize: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.priorEquivalentSampleSize
});

const LEVEL_ORDER = Object.freeze([
  'track_method_distance_field',
  'track_method_distance',
  'track_method',
  'method_distance_field',
  'method_distance',
  'method',
  'global'
]);

function placeholders(values) { return values.map(() => '?').join(','); }
function chunks(values, size = 80) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

const RACE_PRIOR_SHARD_YEARS = 2;

function minIso(...values) {
  return values.filter(Boolean).sort()[0] || null;
}
function maxIso(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

async function raceDateShards(env, cutoff) {
  const cutoffDate=String(cutoff).slice(0,10);
  const row=await env.DB.prepare(`
    SELECT MIN(race_date) AS min_date
    FROM races INDEXED BY idx_races_date
    WHERE race_date < ?
  `).bind(cutoffDate).first();
  const minDate=String(row?.min_date || cutoffDate);
  const minYear=Number(minDate.slice(0,4));
  const cutoffYear=Number(cutoffDate.slice(0,4));
  if (!Number.isInteger(minYear) || !Number.isInteger(cutoffYear)) {
    throw new Error('race prior date bounds are invalid');
  }
  const shards=[];
  for(let year=minYear;year<=cutoffYear;year+=RACE_PRIOR_SHARD_YEARS){
    shards.push({
      startDate:`${year}-01-01`,
      endDate:`${year+RACE_PRIOR_SHARD_YEARS}-01-01`
    });
  }
  return shards;
}

function mergeAggregateRows(context, shardRows) {
  const out=new Map();
  for(const level of context.hierarchy){
    const parts=shardRows.map((rows)=>rows.get(level)).filter(Boolean);
    const starts=parts.reduce((sum,row)=>sum+Number(row.starts||0),0);
    const races=parts.reduce((sum,row)=>sum+Number(row.races||0),0);
    const wins=parts.reduce((sum,row)=>sum+Number(row.wins||0),0);
    const top3=parts.reduce((sum,row)=>sum+Number(row.top3||0),0);
    const gallopKnown=parts.reduce((sum,row)=>sum+Number(row.gallopKnown||0),0);
    const gallops=parts.reduce((sum,row)=>sum+Number(row.gallops||0),0);
    const sourceRecords=parts.reduce((sum,row)=>sum+Number(row.sourceRecords||0),0);
    out.set(level,{
      level,starts,races,wins,top3,gallopKnown,gallops,sourceRecords,
      firstSourceObservedAt:minIso(...parts.map((row)=>row.firstSourceObservedAt)),
      lastSourceObservedAt:maxIso(...parts.map((row)=>row.lastSourceObservedAt)),
      winRate:starts?wins/starts:null,
      top3Rate:starts?top3/starts:null,
      gallopRate:gallopKnown?gallops/gallopKnown:null,
      gallopCoverage:starts?gallopKnown/starts:null
    });
  }
  return out;
}

function mergeShapeRows(context, shardRows) {
  const out=new Map();
  for(const level of context.hierarchy){
    const laneCounts=new Map();
    let starts=0,races=0,sourceRecords=0;
    let firstSourceObservedAt=null,lastSourceObservedAt=null;
    for(const rows of shardRows){
      const row=rows.get(level);
      if(!row) continue;
      starts+=Number(row.starts||0);
      races+=Number(row.races||0);
      sourceRecords+=Number(row.sourceRecords||0);
      firstSourceObservedAt=minIso(firstSourceObservedAt,row.firstSourceObservedAt);
      lastSourceObservedAt=maxIso(lastSourceObservedAt,row.lastSourceObservedAt);
      for(const [lane,count] of row.laneCounts || []) laneCounts.set(lane,(laneCounts.get(lane)||0)+count);
    }
    const counts=[...laneCounts.values()];
    out.set(level,{
      level,starts,races,sourceRecords,firstSourceObservedAt,lastSourceObservedAt,
      hhi:hhi(counts),entropy:normalizedEntropy(counts),laneCounts
    });
  }
  return out;
}

function instant(value, field = 'asOf') {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return { ms, iso: new Date(ms).toISOString() };
}

function dateBoundaryMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function targetCutoff(row, requestedMs) {
  const scheduled = Date.parse(String(row?.scheduled_start_at ?? ''));
  const eventMs = Number.isFinite(scheduled) ? scheduled : dateBoundaryMs(row?.race_date);
  return new Date(eventMs == null ? requestedMs : Math.min(requestedMs, eventMs)).toISOString();
}

function canonicalMethod(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'auto' || text === 'autostart') return 'auto';
  if (text === 'volt' || text === 'volte' || text === 'voltstart') return 'volt';
  return text;
}

function distanceBucket(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  if (distance < 1800) return 'short';
  if (distance < 2400) return 'middle';
  if (distance < 3000) return 'long';
  return 'stayer';
}

function fieldBucket(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1) return null;
  if (size <= 8) return 'small';
  if (size <= 12) return 'medium';
  return 'large';
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function propositionSignature(proposition) {
  if (!proposition || proposition.parseStatus !== 'parsed' || !proposition.facts || typeof proposition.facts !== 'object') return null;
  const selected = Object.fromEntries(Object.entries(proposition.facts).filter(([, value]) => value != null));
  return Object.keys(selected).length
    ? JSON.stringify(Object.fromEntries(Object.entries(selected).sort(([a], [b]) => a.localeCompare(b))))
    : null;
}

function raceTypeSignature(race) {
  const raceTypes = classifyRace({
    raceName: race?.race_name,
    mainClass: race?.main_class,
    classFlags: race?.class_flags_json
  }).raceTypes;
  return raceTypes.length ? [...raceTypes].sort().join('|') : null;
}

async function loadTargets(env, entryIds) {
  const rows = [];
  for (const group of chunks(entryIds)) {
    const { results } = await env.DB.prepare(`
      SELECT re.id AS race_entry_id, re.race_id, re.actual_lane, re.start_tier, re.handicap_m,
             r.track_id, r.race_date, r.scheduled_start_at, r.distance_m, r.start_method,
             r.field_size, r.race_name, r.main_class, r.class_flags_json,
             (SELECT COUNT(*) FROM race_entries active
               WHERE active.race_id = r.id AND active.scratched = 0) AS active_field_size
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      WHERE re.id IN (${placeholders(group)})
    `).bind(...group).all();
    rows.push(...results);
  }
  const byId = new Map(rows.map((row) => [row.race_entry_id, row]));
  const missing = entryIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`target race entries were not found: ${missing.join(', ')}`);
  return entryIds.map((id) => byId.get(id));
}

async function latestProposition(env, raceId, cutoff) {
  const row = await env.DB.prepare(`
    SELECT rpf.parse_status, rpf.facts_json, rpf.observed_at, rpf.source_record_id, sr.fetched_at AS source_fetched_at
    FROM race_proposition_facts rpf
    JOIN source_records sr ON sr.id = rpf.source_record_id
    WHERE rpf.race_id = ? AND rpf.parser_version = ?
      AND julianday(rpf.observed_at) <= julianday(?)
      AND julianday(sr.fetched_at) <= julianday(?)
    ORDER BY julianday(rpf.observed_at) DESC, julianday(sr.fetched_at) DESC, rpf.id DESC
    LIMIT 1
  `).bind(raceId, RACE_PROPOSITION_PARSER_VERSION, cutoff, cutoff).first();
  return row ? {
    parseStatus: row.parse_status,
    facts: parseJson(row.facts_json, {}),
    observedAt: row.observed_at,
    sourceRecordId: row.source_record_id
  } : null;
}

const METHOD_SQL = `CASE
  WHEN LOWER(COALESCE(r.start_method,'')) IN ('auto','autostart') THEN 'auto'
  WHEN LOWER(COALESCE(r.start_method,'')) IN ('volt','volte','voltstart') THEN 'volt'
  WHEN r.start_method IS NULL OR TRIM(r.start_method) = '' THEN NULL
  ELSE LOWER(r.start_method)
END`;

const DISTANCE_SQL = `CASE
  WHEN r.distance_m IS NULL OR r.distance_m <= 0 THEN NULL
  WHEN r.distance_m < 1800 THEN 'short'
  WHEN r.distance_m < 2400 THEN 'middle'
  WHEN r.distance_m < 3000 THEN 'long'
  ELSE 'stayer'
END`;

const FIELD_SQL = `CASE
  WHEN rf.active_field_size BETWEEN 1 AND 8 THEN 'small'
  WHEN rf.active_field_size BETWEEN 9 AND 12 THEN 'medium'
  WHEN rf.active_field_size >= 13 THEN 'large'
  ELSE NULL
END`;

function availableHierarchy(context) {
  const levels = [];
  const hasTrack = context.trackId != null;
  const hasMethod = context.method != null;
  const hasDistance = context.distanceBucket != null;
  const hasField = context.fieldBucket != null;
  if (hasTrack && hasMethod && hasDistance && hasField) levels.push('track_method_distance_field');
  if (hasTrack && hasMethod && hasDistance) levels.push('track_method_distance');
  if (hasTrack && hasMethod) levels.push('track_method');
  if (hasMethod && hasDistance && hasField) levels.push('method_distance_field');
  if (hasMethod && hasDistance) levels.push('method_distance');
  if (hasMethod) levels.push('method');
  levels.push('global');
  return levels;
}

function levelCondition(level, context, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  switch (level) {
    case 'track_method_distance_field':
      return { where: `${prefix}track_id = ? AND ${prefix}method_key = ? AND ${prefix}distance_bucket = ? AND ${prefix}field_bucket = ?`, bindings: [context.trackId, context.method, context.distanceBucket, context.fieldBucket] };
    case 'track_method_distance':
      return { where: `${prefix}track_id = ? AND ${prefix}method_key = ? AND ${prefix}distance_bucket = ?`, bindings: [context.trackId, context.method, context.distanceBucket] };
    case 'track_method':
      return { where: `${prefix}track_id = ? AND ${prefix}method_key = ?`, bindings: [context.trackId, context.method] };
    case 'method_distance_field':
      return { where: `${prefix}method_key = ? AND ${prefix}distance_bucket = ? AND ${prefix}field_bucket = ?`, bindings: [context.method, context.distanceBucket, context.fieldBucket] };
    case 'method_distance':
      return { where: `${prefix}method_key = ? AND ${prefix}distance_bucket = ?`, bindings: [context.method, context.distanceBucket] };
    case 'method':
      return { where: `${prefix}method_key = ?`, bindings: [context.method] };
    case 'global':
      return { where: '1 = 1', bindings: [] };
    default:
      throw new Error(`unsupported race prior level: ${level}`);
  }
}

function baseCte() {
  return `WITH race_fields AS MATERIALIZED (
      SELECT r0.id AS race_id, SUM(CASE WHEN re0.scratched = 0 THEN 1 ELSE 0 END) AS active_field_size
      FROM races r0 INDEXED BY idx_races_date
      JOIN race_entries re0 INDEXED BY idx_entries_race ON re0.race_id = r0.id
      WHERE r0.race_date >= ? AND r0.race_date < ?
      GROUP BY r0.id
    ), eligible AS MATERIALIZED (
      SELECT r.id AS race_id, r.track_id, ${METHOD_SQL} AS method_key, ${DISTANCE_SQL} AS distance_bucket,
             ${FIELD_SQL} AS field_bucket, re.actual_lane, re.start_tier, re.handicap_m,
             rr.placing, rr.gallop, rr.source_record_id, sr.fetched_at AS source_observed_at,
             r.race_name, r.main_class, r.class_flags_json
      FROM races r INDEXED BY idx_races_date
      JOIN race_fields rf ON rf.race_id = r.id
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN source_records sr ON sr.id = rr.source_record_id
      WHERE r.race_date >= ? AND r.race_date < ?
        AND re.scratched = 0 AND rr.result_status = 'official'
        AND sr.fetched_at <= ?
        AND COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59.999Z') < ?
        AND r.id <> ?
    )`;
}

function hierarchyRow(level, context, ordinal) {
  const row = { ordinal, level, trackId: null, method: null, distanceBucket: null, fieldBucket: null };
  if (level.includes('track')) row.trackId = context.trackId;
  if (level.includes('method')) row.method = context.method;
  if (level.includes('distance')) row.distanceBucket = context.distanceBucket;
  if (level.includes('field')) row.fieldBucket = context.fieldBucket;
  return row;
}

function hierarchyCte(context) {
  const rows = context.hierarchy.map((level, index) => hierarchyRow(level, context, index));
  return {
    sql: `context_levels (ordinal, level, track_id, method_key, distance_bucket, field_bucket) AS (
      VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}
    )`,
    bindings: rows.flatMap((row) => [
      row.ordinal, row.level, row.trackId, row.method, row.distanceBucket, row.fieldBucket
    ])
  };
}

const HIERARCHY_MATCH_SQL = `
  (cl.track_id IS NULL OR e.track_id = cl.track_id)
  AND (cl.method_key IS NULL OR e.method_key = cl.method_key)
  AND (cl.distance_bucket IS NULL OR e.distance_bucket = cl.distance_bucket)
  AND (cl.field_bucket IS NULL OR e.field_bucket = cl.field_bucket)
`;

function hierarchyQueryBase(context, shard) {
  const levels = hierarchyCte(context);
  return {
    sql: `${baseCte()},
    ${levels.sql}`,
    bindings: [shard.startDate, shard.endDate, shard.startDate, shard.endDate, context.cutoff, context.cutoff, context.raceId, ...levels.bindings]
  };
}

function normalizeAggregate(row) {
  const starts = Number(row?.starts ?? 0);
  const races = Number(row?.races ?? 0);
  const gallopKnown = Number(row?.gallop_known ?? 0);
  return {
    level: row?.level || null,
    starts,
    races,
    wins: Number(row?.wins ?? 0),
    top3: Number(row?.top3 ?? 0),
    gallopKnown,
    gallops: Number(row?.gallops ?? 0),
    sourceRecords: Number(row?.source_records ?? 0),
    firstSourceObservedAt: row?.first_source_observed_at || null,
    lastSourceObservedAt: row?.last_source_observed_at || null,
    winRate: starts ? Number(row?.wins ?? 0) / starts : null,
    top3Rate: starts ? Number(row?.top3 ?? 0) / starts : null,
    gallopRate: gallopKnown ? Number(row?.gallops ?? 0) / gallopKnown : null,
    gallopCoverage: starts ? gallopKnown / starts : null
  };
}

async function loadAggregateLevelsShard(env, context, shard) {
  const query = hierarchyQueryBase(context, shard);
  const { results } = await env.DB.prepare(`${query.sql}
    SELECT cl.level,
      COUNT(e.race_id) AS starts,
      COUNT(DISTINCT e.race_id) AS races,
      SUM(CASE WHEN e.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN e.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN e.gallop IS NOT NULL THEN 1 ELSE 0 END) AS gallop_known,
      SUM(CASE WHEN e.gallop = 1 THEN 1 ELSE 0 END) AS gallops,
      COUNT(DISTINCT e.source_record_id) AS source_records,
      MIN(e.source_observed_at) AS first_source_observed_at,
      MAX(e.source_observed_at) AS last_source_observed_at
    FROM context_levels cl
    LEFT JOIN eligible e ON ${HIERARCHY_MATCH_SQL}
    GROUP BY cl.ordinal, cl.level
    ORDER BY cl.ordinal
  `).bind(...query.bindings).all();
  return new Map(results.map((row) => [row.level, normalizeAggregate(row)]));
}

function hhi(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  return values.reduce((sum, value) => {
    const p = value / total;
    return sum + p * p;
  }, 0);
}

function normalizedEntropy(values) {
  const positive = values.filter((value) => value > 0);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (!total || positive.length <= 1) return positive.length === 1 ? 0 : null;
  const entropy = -positive.reduce((sum, value) => {
    const p = value / total;
    return sum + p * Math.log(p);
  }, 0);
  return entropy / Math.log(positive.length);
}

async function loadShapeLevelsShard(env, context, shard) {
  const laneQuery = hierarchyQueryBase(context, shard);
  const metaQuery = hierarchyQueryBase(context, shard);
  const [laneResult, metaResult] = await Promise.all([
    env.DB.prepare(`${laneQuery.sql}
      SELECT cl.level, e.actual_lane, COUNT(*) AS winners
      FROM context_levels cl
      JOIN eligible e ON ${HIERARCHY_MATCH_SQL}
        AND e.placing = 1 AND e.actual_lane IS NOT NULL
      GROUP BY cl.ordinal, cl.level, e.actual_lane
      ORDER BY cl.ordinal, e.actual_lane
    `).bind(...laneQuery.bindings).all(),
    env.DB.prepare(`${metaQuery.sql}
      SELECT cl.level,
        COUNT(e.race_id) AS winners,
        COUNT(DISTINCT e.race_id) AS races,
        COUNT(DISTINCT e.source_record_id) AS source_records,
        MIN(e.source_observed_at) AS first_source_observed_at,
        MAX(e.source_observed_at) AS last_source_observed_at
      FROM context_levels cl
      LEFT JOIN eligible e ON ${HIERARCHY_MATCH_SQL}
        AND e.placing = 1 AND e.actual_lane IS NOT NULL
      GROUP BY cl.ordinal, cl.level
      ORDER BY cl.ordinal
    `).bind(...metaQuery.bindings).all()
  ]);
  const lanesByLevel = new Map(context.hierarchy.map((level) => [level, new Map()]));
  for (const row of laneResult.results) {
    const lane=Number(row.actual_lane);
    if(Number.isFinite(lane)) lanesByLevel.get(row.level)?.set(lane,Number(row.winners ?? 0));
  }
  const metaByLevel = new Map(metaResult.results.map((row) => [row.level, row]));
  const out = new Map();
  for (const level of context.hierarchy) {
    const laneCounts=lanesByLevel.get(level) || new Map();
    const meta = metaByLevel.get(level) || {};
    const counts=[...laneCounts.values()];
    out.set(level, {
      level,
      starts: Number(meta.winners ?? 0),
      races: Number(meta.races ?? 0),
      sourceRecords: Number(meta.source_records ?? 0),
      firstSourceObservedAt: meta.first_source_observed_at || null,
      lastSourceObservedAt: meta.last_source_observed_at || null,
      hhi: hhi(counts),
      entropy: normalizedEntropy(counts),
      laneCounts
    });
  }
  return out;
}

async function loadSpecificContextRowsShard(env, context, shard) {
  const directLevel = context.hierarchy[0];
  const condition = levelCondition(directLevel, context);
  const { results } = await env.DB.prepare(`${baseCte()}
    SELECT eligible.*,
      (SELECT rpf.parse_status FROM race_proposition_facts rpf
        JOIN source_records rpf_sr ON rpf_sr.id = rpf.source_record_id
        WHERE rpf.race_id = eligible.race_id AND rpf.parser_version = ?
          AND julianday(rpf.observed_at) <= julianday(?) AND julianday(rpf_sr.fetched_at) <= julianday(?)
        ORDER BY julianday(rpf.observed_at) DESC, rpf.id DESC LIMIT 1) AS proposition_status,
      (SELECT rpf.facts_json FROM race_proposition_facts rpf
        JOIN source_records rpf_sr ON rpf_sr.id = rpf.source_record_id
        WHERE rpf.race_id = eligible.race_id AND rpf.parser_version = ?
          AND julianday(rpf.observed_at) <= julianday(?) AND julianday(rpf_sr.fetched_at) <= julianday(?)
        ORDER BY julianday(rpf.observed_at) DESC, rpf.id DESC LIMIT 1) AS proposition_facts_json
    FROM eligible
    WHERE ${condition.where}
    ORDER BY race_id, actual_lane
  `).bind(
    shard.startDate, shard.endDate, shard.startDate, shard.endDate,
    context.cutoff, context.cutoff, context.raceId,
    RACE_PROPOSITION_PARSER_VERSION, context.cutoff, context.cutoff,
    RACE_PROPOSITION_PARSER_VERSION, context.cutoff, context.cutoff,
    ...condition.bindings
  ).all();
  return results.map((row) => ({
    raceId: row.race_id,
    raceTypeSignature: raceTypeSignature(row),
    propositionSignature: row.proposition_status === 'parsed'
      ? propositionSignature({ parseStatus: 'parsed', facts: parseJson(row.proposition_facts_json, {}) })
      : null,
    actualLane: numberOrNull(row.actual_lane),
    startTier: numberOrNull(row.start_tier),
    handicapM: numberOrNull(row.handicap_m),
    placing: numberOrNull(row.placing),
    gallop: row.gallop == null ? null : Number(row.gallop) === 1,
    sourceRecordId: row.source_record_id || null,
    sourceObservedAt: row.source_observed_at || null
  }));
}

function confidence(ess, coverage = 1) {
  if (!(ess > 0) || coverage == null) return null;
  return Math.round(Math.min(1, ess / RACE_PRIOR_POLICY.minEffectiveSampleSize) * coverage * 1_000_000) / 1_000_000;
}

function unavailablePrior(metric, directLevel = null) {
  return Object.freeze({
    metric,
    value: null,
    evidence_source: 'unknown',
    direct_level: directLevel,
    direct_sample_size: 0,
    direct_effective_sample_size: 0,
    sample_size: 0,
    effective_sample_size: 0,
    backoff_level: null,
    backoff_sample_size: 0,
    backoff_effective_sample_size: 0,
    confidence: null,
    coverage: null,
    source_record_count: 0,
    source_observed_at_min: null,
    source_observed_at_max: null,
    policy_version: ANALYSIS_V3_FOUNDATION_CONTRACTS.hierarchicalBackoff
  });
}

function buildPrior(metric, levels, { directLevel, allowedLevels } = {}) {
  const permitted = allowedLevels || [...levels.keys()];
  const firstLevel = directLevel || permitted[0] || null;
  if (!firstLevel) return unavailablePrior(metric, null);
  const direct = levels.get(firstLevel) || null;
  const valueKey = metric === 'win_rate' ? 'winRate' : metric === 'top3_rate' ? 'top3Rate' : 'gallopRate';
  const coverageKey = metric === 'gallop_rate' ? 'gallopCoverage' : null;
  const directValue = direct?.[valueKey] ?? null;
  const directEss = direct?.races ?? 0;
  const candidates = permitted
    .filter((level) => level !== firstLevel)
    .map((level) => levels.get(level))
    .filter(Boolean)
    .map((item) => ({ level: item.level, value: item[valueKey], sampleSize: item.starts, effectiveSampleSize: item.races }));
  const estimate = estimateWithHierarchicalBackoff({
    directValue,
    directSampleSize: directValue == null ? 0 : directEss,
    backoffCandidates: candidates
  });
  const chosen = estimate.evidence_source === 'model_estimate' ? levels.get(estimate.backoff_level) : direct;
  const coverage = chosen ? (coverageKey ? chosen[coverageKey] : chosen.starts > 0 ? 1 : null) : null;
  const effective = estimate.evidence_source === 'model_estimate'
    ? estimate.backoff_effective_sample_size
    : Math.max(directEss, estimate.backoff_effective_sample_size || 0);
  return Object.freeze({
    metric,
    value: estimate.value,
    evidence_source: estimate.evidence_source,
    direct_level: firstLevel,
    direct_sample_size: direct?.starts ?? 0,
    direct_effective_sample_size: directEss,
    sample_size: chosen?.starts ?? 0,
    effective_sample_size: effective,
    backoff_level: estimate.backoff_level,
    backoff_sample_size: estimate.backoff_sample_size,
    backoff_effective_sample_size: estimate.backoff_effective_sample_size,
    confidence: estimate.value == null ? null : confidence(effective, coverage ?? 1),
    coverage,
    source_record_count: chosen?.sourceRecords ?? 0,
    source_observed_at_min: chosen?.firstSourceObservedAt ?? null,
    source_observed_at_max: chosen?.lastSourceObservedAt ?? null,
    policy_version: estimate.policy_version
  });
}

function aggregateRows(rows, level) {
  const starts = rows.length;
  const races = new Set(rows.map((row) => row.raceId)).size;
  const gallopRows = rows.filter((row) => row.gallop === true || row.gallop === false);
  const observed = rows.map((row) => row.sourceObservedAt).filter(Boolean).sort();
  const wins = rows.filter((row) => row.placing === 1).length;
  const top3 = rows.filter((row) => row.placing != null && row.placing >= 1 && row.placing <= 3).length;
  const gallops = gallopRows.filter((row) => row.gallop).length;
  return {
    level,
    starts,
    races,
    wins,
    top3,
    gallopKnown: gallopRows.length,
    gallops,
    sourceRecords: new Set(rows.map((row) => row.sourceRecordId).filter(Boolean)).size,
    firstSourceObservedAt: observed[0] || null,
    lastSourceObservedAt: observed.at(-1) || null,
    winRate: starts ? wins / starts : null,
    top3Rate: starts ? top3 / starts : null,
    gallopRate: gallopRows.length ? gallops / gallopRows.length : null,
    gallopCoverage: starts ? gallopRows.length / starts : null
  };
}

function filteredPrior(metric, rows, predicate, levels, directLevel, hierarchy) {
  const augmented = new Map(levels);
  augmented.set(directLevel, aggregateRows(rows.filter(predicate), directLevel));
  return buildPrior(metric, augmented, { directLevel, allowedLevels: [directLevel, ...hierarchy] });
}

function positionPriors(rows, levels, target, hierarchy) {
  function byValue(label, value, accessor) {
    if (value == null) return Object.freeze({
      status: 'unavailable',
      value: null,
      win_rate: unavailablePrior('win_rate', label),
      top3_rate: unavailablePrior('top3_rate', label),
      gallop_rate: unavailablePrior('gallop_rate', label)
    });
    const direct = aggregateRows(rows.filter((row) => accessor(row) === value), label);
    const augmented = new Map(levels);
    augmented.set(label, direct);
    const options = { directLevel: label, allowedLevels: [label, ...hierarchy] };
    return Object.freeze({
      status: direct.starts ? 'available' : 'sparse',
      value,
      win_rate: buildPrior('win_rate', augmented, options),
      top3_rate: buildPrior('top3_rate', augmented, options),
      gallop_rate: buildPrior('gallop_rate', augmented, options)
    });
  }
  return Object.freeze({
    lane: byValue('same_lane', target.actualLane, (row) => row.actualLane),
    tier: byValue('same_tier', target.startTier, (row) => row.startTier),
    handicap: byValue('same_handicap', target.handicapM, (row) => row.handicapM)
  });
}

function buildShapePrior(metric, shapeLevels, hierarchy) {
  const key = metric === 'winner_lane_hhi' ? 'hhi' : 'entropy';
  const directLevel = hierarchy[0];
  const direct = shapeLevels.get(directLevel) || null;
  const candidates = hierarchy.slice(1).map((level) => shapeLevels.get(level)).filter(Boolean).map((item) => ({
    level: item.level,
    value: item[key],
    sampleSize: item.starts,
    effectiveSampleSize: item.races
  }));
  const estimate = estimateWithHierarchicalBackoff({
    directValue: direct?.[key] ?? null,
    directSampleSize: direct?.[key] == null ? 0 : direct.races,
    backoffCandidates: candidates
  });
  if (estimate.value == null) return unavailablePrior(metric, directLevel);
  const chosen = estimate.evidence_source === 'model_estimate' ? shapeLevels.get(estimate.backoff_level) : direct;
  const effective = estimate.evidence_source === 'model_estimate'
    ? estimate.backoff_effective_sample_size
    : Math.max(direct?.races ?? 0, estimate.backoff_effective_sample_size || 0);
  return Object.freeze({
    metric,
    value: estimate.value,
    evidence_source: estimate.evidence_source,
    direct_level: directLevel,
    direct_sample_size: direct?.starts ?? 0,
    direct_effective_sample_size: direct?.races ?? 0,
    sample_size: chosen?.starts ?? 0,
    effective_sample_size: effective,
    backoff_level: estimate.backoff_level,
    backoff_sample_size: estimate.backoff_sample_size,
    backoff_effective_sample_size: estimate.backoff_effective_sample_size,
    confidence: confidence(effective, 1),
    coverage: 1,
    source_record_count: chosen?.sourceRecords ?? 0,
    source_observed_at_min: chosen?.firstSourceObservedAt ?? null,
    source_observed_at_max: chosen?.lastSourceObservedAt ?? null,
    policy_version: estimate.policy_version
  });
}

function shapePriors(shapeLevels, hierarchy) {
  return Object.freeze({
    winner_lane_hhi: buildShapePrior('winner_lane_hhi', shapeLevels, hierarchy),
    winner_lane_normalized_entropy: buildShapePrior('winner_lane_normalized_entropy', shapeLevels, hierarchy)
  });
}

function buildProvenance(context, targetProposition) {
  const refs = [];
  if (targetProposition?.sourceRecordId && targetProposition?.observedAt) refs.push({
    source_record_id: targetProposition.sourceRecordId,
    selected_at: targetProposition.observedAt,
    time_basis: 'proposition_observed_at'
  });
  return createFeatureProvenance({
    featureFamily: 'race_priors',
    featureVersion: RACE_PRIOR_FEATURE_VERSION,
    asOf: context.cutoff,
    sourceRefs: refs,
    inputVersions: {
      raceProposition: RACE_PROPOSITION_PARSER_VERSION,
      hierarchicalBackoff: ANALYSIS_V3_FOUNDATION_CONTRACTS.hierarchicalBackoff,
      querySharding: RACE_PRIOR_QUERY_SHARD_VERSION
    },
    parameters: {
      distanceBucket: context.distanceBucket,
      fieldBucket: context.fieldBucket,
      levelOrder: context.hierarchy,
      minEffectiveSampleSize: RACE_PRIOR_POLICY.minEffectiveSampleSize,
      priorEquivalentSampleSize: RACE_PRIOR_POLICY.priorEquivalentSampleSize,
      resultPopulationSource: 'official_race_results_as_of',
      positionOutcomePriors: false
    }
  });
}

async function buildRaceContext(env, target, requested) {
  const cutoff = targetCutoff(target, requested.ms);
  const targetProposition = await latestProposition(env, target.race_id, cutoff);
  const context = {
    raceId: target.race_id,
    cutoff,
    trackId: target.track_id || null,
    method: canonicalMethod(target.start_method),
    distanceBucket: distanceBucket(numberOrNull(target.distance_m)),
    fieldBucket: fieldBucket(Number(target.active_field_size || target.field_size || 0) || null),
    raceTypeSignature: raceTypeSignature(target),
    propositionSignature: propositionSignature(targetProposition)
  };
  context.hierarchy = availableHierarchy(context);
  const shards=await raceDateShards(env,cutoff);
  const aggregateParts=[];
  const shapeParts=[];
  const specificRows=[];
  for(const shard of shards){
    const [aggregate,shape,specific]=await Promise.all([
      loadAggregateLevelsShard(env,context,shard),
      loadShapeLevelsShard(env,context,shard),
      loadSpecificContextRowsShard(env,context,shard)
    ]);
    aggregateParts.push(aggregate);
    shapeParts.push(shape);
    specificRows.push(...specific);
  }
  const levels=mergeAggregateRows(context,aggregateParts);
  const shapeLevels=mergeShapeRows(context,shapeParts);
  return { context, levels, specificRows, shapeLevels, targetProposition };
}

function buildPack(target, requested, shared) {
  const { context, levels, specificRows, shapeLevels, targetProposition } = shared;
  const raceType = context.raceTypeSignature;
  const proposition = context.propositionSignature;
  const raceTypePredicate = raceType ? (row) => row.raceTypeSignature === raceType : null;
  const propositionPredicate = proposition ? (row) => row.propositionSignature === proposition : null;
  const contextLevel = raceTypePredicate && propositionPredicate
    ? 'race_type_proposition'
    : raceTypePredicate ? 'race_type' : propositionPredicate ? 'proposition' : null;
  const contextPredicate = raceTypePredicate && propositionPredicate
    ? (row) => raceTypePredicate(row) && propositionPredicate(row)
    : raceTypePredicate || propositionPredicate;
  const contextDirectStarts = contextPredicate ? specificRows.filter(contextPredicate).length : 0;
  const positionTarget = {
    actualLane: numberOrNull(target.actual_lane),
    startTier: numberOrNull(target.start_tier),
    handicapM: numberOrNull(target.handicap_m)
  };
  const directLevel = context.hierarchy[0];

  const contextPriors = contextPredicate ? Object.freeze({
    status: contextDirectStarts ? 'available' : 'sparse',
    race_type_signature: raceType,
    proposition_signature: proposition,
    win_rate: filteredPrior('win_rate', specificRows, contextPredicate, levels, contextLevel, context.hierarchy),
    top3_rate: filteredPrior('top3_rate', specificRows, contextPredicate, levels, contextLevel, context.hierarchy),
    gallop_rate: filteredPrior('gallop_rate', specificRows, contextPredicate, levels, contextLevel, context.hierarchy)
  }) : Object.freeze({
    status: 'unavailable',
    race_type_signature: raceType,
    proposition_signature: proposition,
    win_rate: unavailablePrior('win_rate', null),
    top3_rate: unavailablePrior('top3_rate', null),
    gallop_rate: unavailablePrior('gallop_rate', null)
  });

  const basePriorOptions = { directLevel, allowedLevels: context.hierarchy };
  return Object.freeze({
    contractVersion: RACE_PRIOR_CONTRACT_VERSION,
    featureVersion: RACE_PRIOR_FEATURE_VERSION,
    asOf: requested.iso,
    targetCutoff: context.cutoff,
    target: Object.freeze({
      raceEntryId: target.race_entry_id,
      raceId: target.race_id,
      trackId: context.trackId,
      startMethod: context.method,
      distanceBucket: context.distanceBucket,
      fieldBucket: context.fieldBucket,
      actualLane: positionTarget.actualLane,
      startTier: positionTarget.startTier,
      handicapM: positionTarget.handicapM
    }),
    priors: Object.freeze({
      race_outcome: Object.freeze({
        win_rate: buildPrior('win_rate', levels, basePriorOptions),
        top3_rate: buildPrior('top3_rate', levels, basePriorOptions),
        gallop_rate: buildPrior('gallop_rate', levels, basePriorOptions)
      }),
      race_context: contextPriors,
      starting_position: positionPriors(specificRows, levels, positionTarget, context.hierarchy),
      shape: shapePriors(shapeLevels, context.hierarchy)
    }),
    provenance: buildProvenance(context, targetProposition)
  });
}

export async function buildRacePriorsV1ForEntries(env, raceEntryIds, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!Array.isArray(raceEntryIds)) throw new Error('raceEntryIds must be an array');
  const ids = [...new Set(raceEntryIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const requested = instant(asOf);
  const targets = await loadTargets(env, ids);
  const sharedByRace = new Map();
  for (const target of targets) {
    if (!sharedByRace.has(target.race_id)) {
      sharedByRace.set(target.race_id, await buildRaceContext(env, target, requested));
    }
  }
  return new Map(targets.map((target) => [target.race_entry_id, buildPack(target, requested, sharedByRace.get(target.race_id))]));
}
