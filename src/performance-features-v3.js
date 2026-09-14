import {
  ANALYSIS_V3_FOUNDATION_CONTRACTS,
  ANALYSIS_V3_INITIAL_BACKOFF_POLICY,
  classifyEvidenceLevel,
  createEvidenceEnvelope,
  createFeatureProvenance,
  createFeatureVersionRegistry,
  estimateWithHierarchicalBackoff
} from './analysis-v3-foundations.js';
import { getOfficialHorseSnapshotsAsOf } from './import/official-snapshots.js';
import {
  RELEVANT_HISTORY_CONTRACT_VERSION,
  RELEVANT_HISTORY_SELECTION_VERSION,
  buildRelevantHistoryForEntries
} from './relevant-history-v1.js';

export const PERFORMANCE_FEATURE_CONTRACT_VERSION = 'kentaurai-performance-features-v3';

export const PERFORMANCE_FEATURE_VERSIONS = Object.freeze({
  capacity: 'capacity_v1',
  form: 'form_v3',
  classContext: 'class_context_v1',
  development: 'development_v3',
  methodDistance: 'method_distance_v1',
  restReadiness: 'rest_readiness_v1',
  gallopRisk: 'gallop_risk_v1'
});

export const PERFORMANCE_FEATURE_POLICY = Object.freeze({
  confidenceFullSample: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize,
  developmentRecentRows: 3,
  developmentMinComparisonSamples: 2
});

const FEATURE_REGISTRY = createFeatureVersionRegistry([
  {
    family: 'capacity',
    version: PERFORMANCE_FEATURE_VERSIONS.capacity,
    semantics: 'Source-backed capacity facts and peak observations without a composite strength score.',
    parameters: {}
  },
  {
    family: 'form',
    version: PERFORMANCE_FEATURE_VERSIONS.form,
    semantics: 'Current factual form over the B2 relevant-history union with explicit missingness and optional X-Labs pace.',
    parameters: {}
  },
  {
    family: 'class_context',
    version: PERFORMANCE_FEATURE_VERSIONS.classContext,
    semantics: 'Target proposition, first-prize exposure and source-backed opposition proxies without market inputs.',
    parameters: {}
  },
  {
    family: 'development',
    version: PERFORMANCE_FEATURE_VERSIONS.development,
    semantics: 'Recent-versus-baseline factual development deltas; direction is exposed, never collapsed into a score.',
    parameters: {
      recentRows: PERFORMANCE_FEATURE_POLICY.developmentRecentRows,
      minComparisonSamples: PERFORMANCE_FEATURE_POLICY.developmentMinComparisonSamples
    }
  },
  {
    family: 'method_distance',
    version: PERFORMANCE_FEATURE_VERSIONS.methodDistance,
    semantics: 'Start-method, distance and track context with deterministic hierarchical shrinkage when evidence is sparse.',
    parameters: { backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version }
  },
  {
    family: 'rest_readiness',
    version: PERFORMANCE_FEATURE_VERSIONS.restReadiness,
    semantics: 'Rest interval context and comparable historical outcomes without a readiness score.',
    parameters: { backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version }
  },
  {
    family: 'gallop_risk',
    version: PERFORMANCE_FEATURE_VERSIONS.gallopRisk,
    semantics: 'Empirical gallop/disqualification rates with contextual shrinkage; unknown status is never treated as no gallop.',
    parameters: { backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version }
  }
]);

export function getPerformanceFeatureVersionRegistry() {
  return FEATURE_REGISTRY.snapshot();
}

function placeholders(values) { return values.map(() => '?').join(','); }
function chunks(values, size = 80) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function finite(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function unitRatio(numerator, denominator) {
  if (!(denominator > 0)) return null;
  return numerator / denominator;
}

function roundConfidence(value) {
  return value == null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function empiricalConfidence(sampleSize, coverage) {
  if (!(sampleSize > 0) || coverage == null) return null;
  const full = PERFORMANCE_FEATURE_POLICY.confidenceFullSample;
  return roundConfidence(Math.min(1, sampleSize / full) * coverage);
}

function metric({
  value,
  evidenceSource,
  known = 0,
  total = known,
  relevant = known,
  contextSampleSize = 0,
  asOf,
  featureVersion,
  factual = false,
  confidence = undefined
}) {
  const sampleSize = Math.max(0, Number.isInteger(known) ? known : 0);
  const relevantSampleSize = Math.min(sampleSize, Math.max(0, Number.isInteger(relevant) ? relevant : 0));
  const denominator = Math.max(0, Number.isInteger(total) ? total : 0);
  const coverage = denominator > 0 ? Math.min(1, sampleSize / denominator) : null;
  const evidenceLevel = classifyEvidenceLevel({
    directSampleSize: sampleSize,
    relevantDirectSampleSize: relevantSampleSize,
    contextSampleSize: Math.max(0, Number.isInteger(contextSampleSize) ? contextSampleSize : 0)
  });
  const resolvedConfidence = confidence === undefined
    ? (value == null ? null : factual ? coverage : empiricalConfidence(sampleSize, coverage))
    : confidence;
  return createEvidenceEnvelope({
    value: value ?? null,
    evidenceSource,
    evidenceLevel,
    sampleSize,
    relevantSampleSize,
    coverage,
    confidence: resolvedConfidence,
    asOf,
    featureVersion
  });
}

function parsePaceSeconds(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s*min\/km$/i, '');
  const match = text.match(/^(\d+)[.:](\d{2})[,.](\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const tenths = Number(match[3]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || !Number.isInteger(tenths) || seconds > 59) return null;
  return (minutes * 60) + seconds + (tenths / 10);
}

function recordPaceSeconds(record) {
  const minutes = finite(record?.time?.minutes);
  const seconds = finite(record?.time?.seconds);
  const tenths = finite(record?.time?.tenths);
  if (minutes == null || seconds == null || tenths == null || seconds < 0 || seconds > 59 || tenths < 0 || tenths > 9) return null;
  return (minutes * 60) + seconds + (tenths / 10);
}

function orderedRows(history) {
  return [...(history?.relevantHistoryUnion || [])].sort((a, b) => {
    const aMs = Date.parse(a.scheduledStartAt || `${a.raceDate}T00:00:00Z`);
    const bMs = Date.parse(b.scheduledStartAt || `${b.raceDate}T00:00:00Z`);
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return bMs - aMs;
    return `${a.raceId}|${a.raceEntryId}`.localeCompare(`${b.raceId}|${b.raceEntryId}`);
  });
}

function knownPlacings(rows) {
  return rows.map((row) => finite(row?.result?.placing)).filter((value) => value != null && value > 0);
}

function placingRate(rows, predicate) {
  const values = knownPlacings(rows);
  return { value: values.length ? values.filter(predicate).length / values.length : null, known: values.length, total: rows.length };
}

function averagePlacing(rows) {
  const values = knownPlacings(rows);
  return { value: mean(values), known: values.length, total: rows.length };
}

function parsedPaces(rows, accessor) {
  return rows.map(accessor).map(parsePaceSeconds).filter((value) => value != null);
}

function paceMean(rows, accessor) {
  const values = parsedPaces(rows, accessor);
  return { value: mean(values), known: values.length, total: rows.length };
}

function paceBest(rows, accessor) {
  const values = parsedPaces(rows, accessor);
  return { value: values.length ? Math.min(...values) : null, known: values.length, total: rows.length };
}

function firstPrizeStats(rows) {
  const values = rows.map((row) => finite(row.firstPrizeSek)).filter((value) => value != null && value >= 0);
  return {
    known: values.length,
    total: rows.length,
    mean: mean(values),
    median: median(values),
    max: values.length ? Math.max(...values) : null
  };
}

function booleanRate(rows, accessor) {
  const values = [];
  for (const row of rows) {
    const value = accessor(row);
    if (value === true || value === false) values.push(value);
  }
  return { value: values.length ? values.filter(Boolean).length / values.length : null, known: values.length, total: rows.length };
}

function targetDistance(history) {
  return finite(history?.target?.actualStartDistanceM) ?? finite(history?.target?.distanceM);
}

function rowDistance(row) {
  return finite(row?.actualStartDistanceM) ?? finite(row?.distanceM);
}

function snapshotStartPoints(snapshot) {
  const yearly = snapshot?.officialStatistics?.year;
  if (yearly?.startPoints != null) return {
    value: finite(yearly.startPoints),
    observedAt: yearly.observedAt || null,
    sourceRecordId: yearly.sourceRecordId || null,
    scope: 'year'
  };
  const life = snapshot?.officialStatistics?.life;
  if (life?.startPoints != null) return {
    value: finite(life.startPoints),
    observedAt: life.observedAt || null,
    sourceRecordId: life.sourceRecordId || null,
    scope: 'life'
  };
  return { value: null, observedAt: null, sourceRecordId: null, scope: null };
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function sourceRef(sourceRecordId, selectedAt, timeBasis) {
  if (!sourceRecordId || !validInstant(selectedAt)) return null;
  return { source_record_id: sourceRecordId, selected_at: new Date(Date.parse(selectedAt)).toISOString(), time_basis: timeBasis };
}

function historySourceRefs(rows, { includeXlabs = false, includeProposition = false } = {}) {
  const refs = [];
  for (const row of rows) {
    const result = sourceRef(row?.result?.sourceRecordId, row?.result?.observedAt, 'result_observed_at');
    if (result) refs.push(result);
    if (includeXlabs) {
      const xlabs = sourceRef(row?.xlabs?.sourceRecordId, row?.xlabs?.observedAt, 'xlabs_observed_at');
      if (xlabs) refs.push(xlabs);
    }
    if (includeProposition) {
      const proposition = sourceRef(row?.proposition?.sourceRecordId, row?.proposition?.observedAt, 'proposition_observed_at');
      if (proposition) refs.push(proposition);
    }
  }
  return refs;
}

function snapshotRefs(snapshot) {
  const refs = [];
  for (const item of [snapshot?.age, snapshot?.currentRecord, snapshot?.officialStatistics?.year, snapshot?.officialStatistics?.life]) {
    const ref = sourceRef(item?.sourceRecordId, item?.observedAt, 'official_snapshot_observed_at');
    if (ref) refs.push(ref);
  }
  return refs;
}

function propositionRefs(proposition) {
  const ref = sourceRef(proposition?.sourceRecordId, proposition?.observedAt, 'proposition_observed_at');
  return ref ? [ref] : [];
}

function dedupeSourceRefs(refs) {
  const map = new Map();
  for (const ref of refs.filter(Boolean)) {
    const key = `${ref.source_record_id}|${ref.selected_at}|${ref.time_basis}`;
    if (!map.has(key)) map.set(key, ref);
  }
  return [...map.values()].sort((a, b) => `${a.source_record_id}|${a.selected_at}|${a.time_basis}`.localeCompare(`${b.source_record_id}|${b.selected_at}|${b.time_basis}`));
}

function familyProvenance({ family, version, asOf, refs, history, parameters = {}, estimateSource = null, backoffLevel = null }) {
  return createFeatureProvenance({
    featureFamily: family,
    featureVersion: version,
    asOf,
    sourceRefs: dedupeSourceRefs(refs),
    inputVersions: {
      relevantHistory: history.contractVersion,
      relevantHistorySelection: history.selectionVersion,
      evidence: ANALYSIS_V3_FOUNDATION_CONTRACTS.evidenceEnvelope,
      hierarchicalBackoff: ANALYSIS_V3_FOUNDATION_CONTRACTS.hierarchicalBackoff
    },
    parameters,
    estimateSource,
    backoffLevel
  });
}

async function loadRaceContexts(env, raceIds) {
  const ids = [...new Set(raceIds.filter(Boolean).map(String))];
  const out = new Map(ids.map((id) => [id, { raceId: id, firstPrizeSek: null, entries: [] }]));
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      SELECT r.id AS race_id, r.first_prize_sek, re.id AS race_entry_id, re.horse_id, re.scratched
      FROM races r
      JOIN race_entries re ON re.race_id = r.id
      WHERE r.id IN (${placeholders(group)})
      ORDER BY r.id, re.start_number, re.id
    `).bind(...group).all();
    for (const row of results) {
      const value = out.get(row.race_id);
      value.firstPrizeSek = row.first_prize_sek == null ? null : Number(row.first_prize_sek);
      value.entries.push({ raceEntryId: row.race_entry_id, horseId: row.horse_id, scratched: Number(row.scratched) === 1 });
    }
  }
  return out;
}

async function snapshotContextForHistory(env, history, raceContext, cache) {
  const cutoff = history.targetCutoff;
  const key = `${history.target.raceId}|${cutoff}`;
  if (cache.has(key)) return cache.get(key);
  const horseIds = [...new Set((raceContext?.entries || []).filter((entry) => !entry.scratched).map((entry) => entry.horseId).filter(Boolean))];
  const snapshots = horseIds.length ? await getOfficialHorseSnapshotsAsOf(env, horseIds, cutoff) : new Map();
  const context = { snapshots, raceContext };
  cache.set(key, context);
  return context;
}

function buildCapacity(history, snapshot, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.capacity;
  const startPoints = snapshotStartPoints(snapshot);
  const record = recordPaceSeconds(snapshot?.currentRecord);
  const life = snapshot?.officialStatistics?.life || null;
  const lifeStarts = finite(life?.starts);
  const lifeWins = finite(life?.wins);
  const lifeWinRate = lifeStarts != null && lifeStarts > 0 && lifeWins != null ? lifeWins / lifeStarts : null;
  const officialPace = paceBest(rows, (row) => row?.result?.kmTime);
  const xlabsLast400 = paceBest(rows, (row) => row?.xlabs?.last400Time);
  const prize = firstPrizeStats(rows);
  const refs = [...snapshotRefs(snapshot), ...historySourceRefs(rows, { includeXlabs: true })];

  return {
    version,
    metrics: {
      official_record_km_seconds: metric({ value: record, evidenceSource: 'official_record_snapshot', known: record == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      official_start_points: metric({ value: startPoints.value, evidenceSource: startPoints.scope ? `official_${startPoints.scope}_snapshot` : 'official_snapshot_unavailable', known: startPoints.value == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      official_life_win_rate: metric({ value: lifeWinRate, evidenceSource: 'official_life_snapshot', known: lifeWinRate == null ? 0 : Math.max(1, Math.trunc(lifeStarts)), total: lifeWinRate == null ? 0 : Math.max(1, Math.trunc(lifeStarts)), relevant: 0, asOf, featureVersion: version }),
      best_relevant_official_km_seconds: metric({ value: officialPace.value, evidenceSource: 'relevant_history_official_km_time', known: officialPace.known, total: officialPace.total, asOf, featureVersion: version }),
      best_relevant_xlabs_last400_km_seconds: metric({ value: xlabsLast400.value, evidenceSource: 'relevant_history_xlabs_last400', known: xlabsLast400.known, total: xlabsLast400.total, asOf, featureVersion: version }),
      max_relevant_first_prize_sek: metric({ value: prize.max, evidenceSource: 'relevant_history_first_prize', known: prize.known, total: prize.total, asOf, featureVersion: version })
    },
    provenance: familyProvenance({ family: 'capacity', version, asOf, refs, history })
  };
}

function buildForm(history, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.form;
  const wins = placingRate(rows, (placing) => placing === 1);
  const top3 = placingRate(rows, (placing) => placing <= 3);
  const placing = averagePlacing(rows);
  const officialKm = paceMean(rows, (row) => row?.result?.kmTime);
  const gallop = booleanRate(rows, (row) => row?.result?.gallop);
  const dq = booleanRate(rows, (row) => row?.result?.disqualified);
  const first200 = paceMean(rows, (row) => row?.xlabs?.first200Time);
  const last400 = paceMean(rows, (row) => row?.xlabs?.last400Time);
  const xlabsRows = rows.filter((row) => row.xlabs != null).length;
  const lastStart = rows[0] || null;
  const restDays = finite(history?.target?.restDaysBeforeStart);
  const refs = historySourceRefs(rows, { includeXlabs: true });

  return {
    version,
    metrics: {
      win_rate: metric({ value: wins.value, evidenceSource: 'relevant_history_results', known: wins.known, total: wins.total, asOf, featureVersion: version }),
      top3_rate: metric({ value: top3.value, evidenceSource: 'relevant_history_results', known: top3.known, total: top3.total, asOf, featureVersion: version }),
      average_placing: metric({ value: placing.value, evidenceSource: 'relevant_history_results', known: placing.known, total: placing.total, asOf, featureVersion: version }),
      average_official_km_seconds: metric({ value: officialKm.value, evidenceSource: 'relevant_history_official_km_time', known: officialKm.known, total: officialKm.total, asOf, featureVersion: version }),
      gallop_rate: metric({ value: gallop.value, evidenceSource: 'relevant_history_gallop_status', known: gallop.known, total: gallop.total, asOf, featureVersion: version }),
      disqualification_rate: metric({ value: dq.value, evidenceSource: 'relevant_history_disqualification_status', known: dq.known, total: dq.total, asOf, featureVersion: version }),
      days_since_last_start: metric({ value: restDays, evidenceSource: lastStart ? 'relevant_history_schedule' : 'relevant_history_unavailable', known: restDays == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      xlabs_start_coverage_rate: metric({ value: rows.length ? xlabsRows / rows.length : null, evidenceSource: 'relevant_history_xlabs_availability', known: rows.length, total: rows.length, relevant: xlabsRows, asOf, featureVersion: version, factual: true }),
      average_xlabs_first200_km_seconds: metric({ value: first200.value, evidenceSource: 'relevant_history_xlabs_first200', known: first200.known, total: first200.total, asOf, featureVersion: version }),
      average_xlabs_last400_km_seconds: metric({ value: last400.value, evidenceSource: 'relevant_history_xlabs_last400', known: last400.known, total: last400.total, asOf, featureVersion: version })
    },
    provenance: familyProvenance({ family: 'form', version, asOf, refs, history })
  };
}

function buildClassContext(history, snapshotContext, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.classContext;
  const raceContext = snapshotContext?.raceContext || null;
  const targetFirstPrize = finite(raceContext?.firstPrizeSek);
  const prize = firstPrizeStats(rows);
  const targetSnapshot = snapshotContext?.snapshots?.get(history.target.horseId) || null;
  const targetPoints = snapshotStartPoints(targetSnapshot);
  const opponentPoints = [];
  const opponentRefs = [];
  for (const entry of raceContext?.entries || []) {
    if (entry.scratched || entry.raceEntryId === history.target.raceEntryId) continue;
    const snapshot = snapshotContext.snapshots.get(entry.horseId) || null;
    const points = snapshotStartPoints(snapshot);
    if (points.value != null) opponentPoints.push(points.value);
    opponentRefs.push(...snapshotRefs(snapshot));
  }
  const opponentCount = (raceContext?.entries || []).filter((entry) => !entry.scratched && entry.raceEntryId !== history.target.raceEntryId).length;
  const opponentMean = mean(opponentPoints);
  const proposition = history?.target?.proposition || null;
  const propositionFacts = proposition?.parseStatus === 'parsed' && proposition?.facts && typeof proposition.facts === 'object'
    ? Object.values(proposition.facts).filter((value) => value != null).length
    : null;
  const targetVsHistoryMax = targetFirstPrize != null && prize.max != null && prize.max > 0 ? targetFirstPrize / prize.max : null;
  const targetVsHistoryMean = targetFirstPrize != null && prize.mean != null && prize.mean > 0 ? targetFirstPrize / prize.mean : null;
  const targetVsOpponents = targetPoints.value != null && opponentMean != null ? targetPoints.value - opponentMean : null;
  const refs = [
    ...historySourceRefs(rows, { includeProposition: true }),
    ...snapshotRefs(targetSnapshot),
    ...opponentRefs,
    ...propositionRefs(proposition)
  ];

  return {
    version,
    metrics: {
      target_first_prize_sek: metric({ value: targetFirstPrize, evidenceSource: 'target_race_fact', known: targetFirstPrize == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      historical_first_prize_mean_sek: metric({ value: prize.mean, evidenceSource: 'relevant_history_first_prize', known: prize.known, total: prize.total, asOf, featureVersion: version }),
      historical_first_prize_median_sek: metric({ value: prize.median, evidenceSource: 'relevant_history_first_prize', known: prize.known, total: prize.total, asOf, featureVersion: version }),
      historical_first_prize_max_sek: metric({ value: prize.max, evidenceSource: 'relevant_history_first_prize', known: prize.known, total: prize.total, asOf, featureVersion: version }),
      target_vs_history_max_first_prize_ratio: metric({ value: targetVsHistoryMax, evidenceSource: 'target_vs_relevant_history_first_prize', known: targetVsHistoryMax == null ? 0 : prize.known, total: prize.total, asOf, featureVersion: version }),
      target_vs_history_mean_first_prize_ratio: metric({ value: targetVsHistoryMean, evidenceSource: 'target_vs_relevant_history_first_prize', known: targetVsHistoryMean == null ? 0 : prize.known, total: prize.total, asOf, featureVersion: version }),
      proposition_parse_status: metric({ value: proposition?.parseStatus || null, evidenceSource: proposition ? 'structured_race_proposition' : 'structured_race_proposition_unavailable', known: proposition ? 1 : 0, total: 1, asOf, featureVersion: version, factual: true }),
      proposition_fact_count: metric({ value: propositionFacts, evidenceSource: 'structured_race_proposition', known: propositionFacts == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      opponent_start_points_mean: metric({ value: opponentMean, evidenceSource: 'official_opposition_snapshots', known: opponentPoints.length, total: opponentCount, relevant: 0, asOf, featureVersion: version }),
      opponent_start_points_median: metric({ value: median(opponentPoints), evidenceSource: 'official_opposition_snapshots', known: opponentPoints.length, total: opponentCount, relevant: 0, asOf, featureVersion: version }),
      target_start_points_vs_opponents_mean_delta: metric({ value: targetVsOpponents, evidenceSource: 'official_target_and_opposition_snapshots', known: targetVsOpponents == null ? 0 : opponentPoints.length, total: opponentCount, relevant: 0, asOf, featureVersion: version })
    },
    provenance: familyProvenance({ family: 'class_context', version, asOf, refs, history })
  };
}

function segmentMetric(rows, accessor) {
  const values = rows.map(accessor).filter((value) => value != null && Number.isFinite(value));
  return { value: mean(values), known: values.length, total: rows.length };
}

function developmentDelta(recent, baseline, minimum) {
  if (recent.known < minimum || baseline.known < minimum || recent.value == null || baseline.value == null) return null;
  return recent.value - baseline.value;
}

function buildDevelopment(history, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.development;
  const recentRows = rows.slice(0, PERFORMANCE_FEATURE_POLICY.developmentRecentRows);
  const baselineRows = rows.slice(PERFORMANCE_FEATURE_POLICY.developmentRecentRows);
  const minimum = PERFORMANCE_FEATURE_POLICY.developmentMinComparisonSamples;
  const recentPlacing = segmentMetric(recentRows, (row) => {
    const value = finite(row?.result?.placing);
    return value != null && value > 0 ? value : null;
  });
  const baselinePlacing = segmentMetric(baselineRows, (row) => {
    const value = finite(row?.result?.placing);
    return value != null && value > 0 ? value : null;
  });
  const recentTop3 = placingRate(recentRows, (placing) => placing <= 3);
  const baselineTop3 = placingRate(baselineRows, (placing) => placing <= 3);
  const recentKm = segmentMetric(recentRows, (row) => parsePaceSeconds(row?.result?.kmTime));
  const baselineKm = segmentMetric(baselineRows, (row) => parsePaceSeconds(row?.result?.kmTime));
  const recentPrize = segmentMetric(recentRows, (row) => finite(row.firstPrizeSek));
  const baselinePrize = segmentMetric(baselineRows, (row) => finite(row.firstPrizeSek));
  const recentLast400 = segmentMetric(recentRows, (row) => parsePaceSeconds(row?.xlabs?.last400Time));
  const baselineLast400 = segmentMetric(baselineRows, (row) => parsePaceSeconds(row?.xlabs?.last400Time));
  const placingDelta = developmentDelta(recentPlacing, baselinePlacing, minimum);
  const top3Delta = developmentDelta(recentTop3, baselineTop3, minimum);
  const kmDelta = developmentDelta(recentKm, baselineKm, minimum);
  const prizeDelta = developmentDelta(recentPrize, baselinePrize, minimum);
  const xlabsDelta = developmentDelta(recentLast400, baselineLast400, minimum);
  const comparisonSample = (recentKnown, baselineKnown, value) => value == null ? 0 : Math.min(recentKnown, baselineKnown);
  const refs = historySourceRefs(rows, { includeXlabs: true });

  return {
    version,
    metrics: {
      recent_average_placing: metric({ value: recentPlacing.value, evidenceSource: 'recent_relevant_history_results', known: recentPlacing.known, total: recentPlacing.total, asOf, featureVersion: version }),
      baseline_average_placing: metric({ value: baselinePlacing.value, evidenceSource: 'baseline_relevant_history_results', known: baselinePlacing.known, total: baselinePlacing.total, asOf, featureVersion: version }),
      average_placing_delta_recent_minus_baseline: metric({ value: placingDelta, evidenceSource: 'recent_vs_baseline_relevant_history', known: comparisonSample(recentPlacing.known, baselinePlacing.known, placingDelta), total: Math.max(recentPlacing.total, baselinePlacing.total), asOf, featureVersion: version }),
      recent_top3_rate: metric({ value: recentTop3.value, evidenceSource: 'recent_relevant_history_results', known: recentTop3.known, total: recentTop3.total, asOf, featureVersion: version }),
      baseline_top3_rate: metric({ value: baselineTop3.value, evidenceSource: 'baseline_relevant_history_results', known: baselineTop3.known, total: baselineTop3.total, asOf, featureVersion: version }),
      top3_rate_delta_recent_minus_baseline: metric({ value: top3Delta, evidenceSource: 'recent_vs_baseline_relevant_history', known: comparisonSample(recentTop3.known, baselineTop3.known, top3Delta), total: Math.max(recentTop3.total, baselineTop3.total), asOf, featureVersion: version }),
      recent_average_official_km_seconds: metric({ value: recentKm.value, evidenceSource: 'recent_relevant_history_official_km_time', known: recentKm.known, total: recentKm.total, asOf, featureVersion: version }),
      baseline_average_official_km_seconds: metric({ value: baselineKm.value, evidenceSource: 'baseline_relevant_history_official_km_time', known: baselineKm.known, total: baselineKm.total, asOf, featureVersion: version }),
      official_km_delta_recent_minus_baseline: metric({ value: kmDelta, evidenceSource: 'recent_vs_baseline_official_km_time', known: comparisonSample(recentKm.known, baselineKm.known, kmDelta), total: Math.max(recentKm.total, baselineKm.total), asOf, featureVersion: version }),
      recent_average_first_prize_sek: metric({ value: recentPrize.value, evidenceSource: 'recent_relevant_history_first_prize', known: recentPrize.known, total: recentPrize.total, asOf, featureVersion: version }),
      baseline_average_first_prize_sek: metric({ value: baselinePrize.value, evidenceSource: 'baseline_relevant_history_first_prize', known: baselinePrize.known, total: baselinePrize.total, asOf, featureVersion: version }),
      first_prize_delta_recent_minus_baseline_sek: metric({ value: prizeDelta, evidenceSource: 'recent_vs_baseline_first_prize', known: comparisonSample(recentPrize.known, baselinePrize.known, prizeDelta), total: Math.max(recentPrize.total, baselinePrize.total), asOf, featureVersion: version }),
      recent_average_xlabs_last400_km_seconds: metric({ value: recentLast400.value, evidenceSource: 'recent_relevant_history_xlabs_last400', known: recentLast400.known, total: recentLast400.total, asOf, featureVersion: version }),
      baseline_average_xlabs_last400_km_seconds: metric({ value: baselineLast400.value, evidenceSource: 'baseline_relevant_history_xlabs_last400', known: baselineLast400.known, total: baselineLast400.total, asOf, featureVersion: version }),
      xlabs_last400_delta_recent_minus_baseline: metric({ value: xlabsDelta, evidenceSource: 'recent_vs_baseline_xlabs_last400', known: comparisonSample(recentLast400.known, baselineLast400.known, xlabsDelta), total: Math.max(recentLast400.total, baselineLast400.total), asOf, featureVersion: version })
    },
    provenance: familyProvenance({
      family: 'development', version, asOf, refs, history,
      parameters: {
        recentRows: PERFORMANCE_FEATURE_POLICY.developmentRecentRows,
        minComparisonSamples: PERFORMANCE_FEATURE_POLICY.developmentMinComparisonSamples
      }
    })
  };
}

function shrunkRateMetric({ direct, backoffCandidates, asOf, version, evidenceSource }) {
  const estimate = estimateWithHierarchicalBackoff({
    directValue: direct.value,
    directSampleSize: direct.known,
    backoffCandidates
  });
  const priorSample = estimate.backoff_sample_size || 0;
  const envelopeSample = estimate.evidence_source === 'model_estimate' ? priorSample : direct.known;
  const total = estimate.evidence_source === 'model_estimate'
    ? Math.max(priorSample, 1)
    : Math.max(direct.total, direct.known);
  const contextSampleSize = priorSample;
  return {
    metric: metric({
      value: estimate.value,
      evidenceSource: `${evidenceSource}:${estimate.evidence_source}`,
      known: envelopeSample,
      total,
      relevant: estimate.evidence_source === 'model_estimate' ? 0 : direct.known,
      contextSampleSize,
      asOf,
      featureVersion: version
    }),
    estimate
  };
}

function buildMethodDistance(history, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.methodDistance;
  const method = history?.target?.startMethod || null;
  const distance = targetDistance(history);
  const track = history?.target?.trackId || null;
  const tolerance = finite(history?.policy?.similarDistanceToleranceM) ?? 250;
  const sameMethod = rows.filter((row) => method && row.startMethod === method);
  const exactContext = sameMethod.filter((row) => {
    const historicalDistance = rowDistance(row);
    return distance != null && historicalDistance != null && Math.abs(historicalDistance - distance) <= tolerance;
  });
  const methodBackoff = sameMethod.filter((row) => !exactContext.includes(row));
  const broaderBackoff = rows.filter((row) => !exactContext.includes(row));
  const sameTrack = rows.filter((row) => track && row.trackId === track);
  const direct = placingRate(exactContext, (placing) => placing <= 3);
  const methodRate = placingRate(sameMethod, (placing) => placing <= 3);
  const trackRate = placingRate(sameTrack, (placing) => placing <= 3);
  const allRate = placingRate(rows, (placing) => placing <= 3);
  const methodPrior = placingRate(methodBackoff, (placing) => placing <= 3);
  const broaderPrior = placingRate(broaderBackoff, (placing) => placing <= 3);
  const contextKm = paceMean(exactContext, (row) => row?.result?.kmTime);
  const shrunk = shrunkRateMetric({
    direct,
    backoffCandidates: [
      { level: 'same_start_method', value: methodPrior.value, sampleSize: methodPrior.known, effectiveSampleSize: methodPrior.known },
      { level: 'relevant_history', value: broaderPrior.value, sampleSize: broaderPrior.known, effectiveSampleSize: broaderPrior.known }
    ],
    asOf,
    version,
    evidenceSource: 'method_distance_top3_backoff'
  });
  const refs = historySourceRefs(rows);

  return {
    version,
    metrics: {
      method_distance_top3_rate: metric({ value: direct.value, evidenceSource: 'same_method_similar_distance_results', known: direct.known, total: direct.total, asOf, featureVersion: version }),
      same_method_top3_rate: metric({ value: methodRate.value, evidenceSource: 'same_start_method_results', known: methodRate.known, total: methodRate.total, asOf, featureVersion: version }),
      same_track_top3_rate: metric({ value: trackRate.value, evidenceSource: 'same_track_results', known: trackRate.known, total: trackRate.total, asOf, featureVersion: version }),
      relevant_history_top3_rate: metric({ value: allRate.value, evidenceSource: 'relevant_history_results', known: allRate.known, total: allRate.total, asOf, featureVersion: version }),
      method_distance_average_official_km_seconds: metric({ value: contextKm.value, evidenceSource: 'same_method_similar_distance_official_km_time', known: contextKm.known, total: contextKm.total, asOf, featureVersion: version }),
      shrunk_method_distance_top3_rate: shrunk.metric
    },
    estimates: { shrunk_method_distance_top3_rate: shrunk.estimate },
    provenance: familyProvenance({
      family: 'method_distance', version, asOf, refs, history,
      parameters: { similarDistanceToleranceM: tolerance, backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version },
      estimateSource: shrunk.estimate.evidence_source,
      backoffLevel: shrunk.estimate.backoff_level
    })
  };
}

function buildRestReadiness(history, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.restReadiness;
  const bucket = history?.target?.restBucket || null;
  const restDays = finite(history?.target?.restDaysBeforeStart);
  const comparable = bucket ? rows.filter((row) => {
    const days = finite(row.restDaysBeforeStart);
    if (days == null) return false;
    if (bucket === 'short') return days <= history.policy.restShortMaxDays;
    if (bucket === 'normal') return days > history.policy.restShortMaxDays && days <= history.policy.restNormalMaxDays;
    return days > history.policy.restNormalMaxDays;
  }) : [];
  const direct = placingRate(comparable, (placing) => placing <= 3);
  const all = placingRate(rows, (placing) => placing <= 3);
  const nonComparable = bucket ? rows.filter((row) => !comparable.includes(row)) : rows;
  const broadPrior = placingRate(nonComparable, (placing) => placing <= 3);
  const comparableGallop = booleanRate(comparable, (row) => row?.result?.gallop);
  const shrunk = shrunkRateMetric({
    direct,
    backoffCandidates: [
      { level: 'relevant_history_other_rest', value: broadPrior.value, sampleSize: broadPrior.known, effectiveSampleSize: broadPrior.known }
    ],
    asOf,
    version,
    evidenceSource: 'rest_top3_backoff'
  });
  const refs = historySourceRefs(rows);

  return {
    version,
    metrics: {
      target_rest_days: metric({ value: restDays, evidenceSource: 'target_rest_interval', known: restDays == null ? 0 : 1, total: 1, asOf, featureVersion: version, factual: true }),
      target_rest_bucket: metric({ value: bucket, evidenceSource: 'target_rest_interval_policy', known: bucket ? 1 : 0, total: 1, asOf, featureVersion: version, factual: true }),
      comparable_rest_top3_rate: metric({ value: direct.value, evidenceSource: 'comparable_rest_results', known: direct.known, total: direct.total, asOf, featureVersion: version }),
      comparable_rest_gallop_rate: metric({ value: comparableGallop.value, evidenceSource: 'comparable_rest_gallop_status', known: comparableGallop.known, total: comparableGallop.total, asOf, featureVersion: version }),
      relevant_history_top3_rate: metric({ value: all.value, evidenceSource: 'relevant_history_results', known: all.known, total: all.total, asOf, featureVersion: version }),
      shrunk_comparable_rest_top3_rate: shrunk.metric
    },
    estimates: { shrunk_comparable_rest_top3_rate: shrunk.estimate },
    provenance: familyProvenance({
      family: 'rest_readiness', version, asOf, refs, history,
      parameters: {
        restShortMaxDays: history.policy.restShortMaxDays,
        restNormalMaxDays: history.policy.restNormalMaxDays,
        backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version
      },
      estimateSource: shrunk.estimate.evidence_source,
      backoffLevel: shrunk.estimate.backoff_level
    })
  };
}

function buildGallopRisk(history, asOf) {
  const rows = orderedRows(history);
  const version = PERFORMANCE_FEATURE_VERSIONS.gallopRisk;
  const method = history?.target?.startMethod || null;
  const distance = targetDistance(history);
  const tolerance = finite(history?.policy?.similarDistanceToleranceM) ?? 250;
  const sameMethod = rows.filter((row) => method && row.startMethod === method);
  const exactContext = sameMethod.filter((row) => {
    const historicalDistance = rowDistance(row);
    return distance != null && historicalDistance != null && Math.abs(historicalDistance - distance) <= tolerance;
  });
  const methodBackoff = sameMethod.filter((row) => !exactContext.includes(row));
  const direct = booleanRate(exactContext, (row) => row?.result?.gallop);
  const methodRate = booleanRate(sameMethod, (row) => row?.result?.gallop);
  const methodPrior = booleanRate(methodBackoff, (row) => row?.result?.gallop);
  const full = history?.fullHistoryAggregates || {};
  const fullGallopKnown = Number.isInteger(full.gallopKnownStarts) ? full.gallopKnownStarts : 0;
  const fullGallopRate = finite(full.gallopRate);
  const fullDqKnown = Number.isInteger(full.disqualificationKnownStarts) ? full.disqualificationKnownStarts : 0;
  const fullDqRate = finite(full.disqualificationRate);
  const shrunk = shrunkRateMetric({
    direct,
    backoffCandidates: [
      { level: 'same_start_method', value: methodPrior.value, sampleSize: methodPrior.known, effectiveSampleSize: methodPrior.known },
      { level: 'full_safe_history', value: fullGallopRate, sampleSize: fullGallopKnown, effectiveSampleSize: fullGallopKnown }
    ],
    asOf,
    version,
    evidenceSource: 'gallop_context_backoff'
  });
  const refs = historySourceRefs(rows);

  return {
    version,
    metrics: {
      full_history_gallop_rate: metric({ value: fullGallopRate, evidenceSource: 'full_safe_history_gallop_status', known: fullGallopKnown, total: history.counts.totalSafe, relevant: 0, asOf, featureVersion: version }),
      full_history_disqualification_rate: metric({ value: fullDqRate, evidenceSource: 'full_safe_history_disqualification_status', known: fullDqKnown, total: history.counts.totalSafe, relevant: 0, asOf, featureVersion: version }),
      same_method_gallop_rate: metric({ value: methodRate.value, evidenceSource: 'same_start_method_gallop_status', known: methodRate.known, total: methodRate.total, asOf, featureVersion: version }),
      method_distance_gallop_rate: metric({ value: direct.value, evidenceSource: 'same_method_similar_distance_gallop_status', known: direct.known, total: direct.total, asOf, featureVersion: version }),
      shrunk_method_distance_gallop_rate: shrunk.metric
    },
    estimates: { shrunk_method_distance_gallop_rate: shrunk.estimate },
    provenance: familyProvenance({
      family: 'gallop_risk', version, asOf, refs, history,
      parameters: { similarDistanceToleranceM: tolerance, backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version },
      estimateSource: shrunk.estimate.evidence_source,
      backoffLevel: shrunk.estimate.backoff_level
    })
  };
}

export async function buildPerformanceFeaturesV3ForEntries(env, raceEntryIds, asOf, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!Array.isArray(raceEntryIds)) throw new Error('raceEntryIds must be an array');
  const entryIds = [...new Set(raceEntryIds.filter(Boolean).map(String))];
  if (!entryIds.length) return new Map();

  const historyOptions = options.history || {};
  const histories = await buildRelevantHistoryForEntries(env, entryIds, asOf, historyOptions);
  const raceIds = [...new Set([...histories.values()].map((history) => history.target.raceId))];
  const raceContexts = await loadRaceContexts(env, raceIds);
  const snapshotCache = new Map();
  const out = new Map();

  for (const entryId of entryIds) {
    const history = histories.get(entryId);
    if (!history) throw new Error(`relevant history was not available for ${entryId}`);
    if (history.contractVersion !== RELEVANT_HISTORY_CONTRACT_VERSION || history.selectionVersion !== RELEVANT_HISTORY_SELECTION_VERSION) {
      throw new Error('unexpected relevant-history contract version');
    }
    const featureAsOf = history.targetCutoff;
    const snapshotContext = await snapshotContextForHistory(env, history, raceContexts.get(history.target.raceId), snapshotCache);
    const snapshot = snapshotContext.snapshots.get(history.target.horseId) || null;

    out.set(entryId, {
      contractVersion: PERFORMANCE_FEATURE_CONTRACT_VERSION,
      requestedAsOf: history.asOf,
      asOf: featureAsOf,
      raceEntryId: entryId,
      horseId: history.target.horseId,
      raceId: history.target.raceId,
      inputs: {
        relevantHistoryContractVersion: history.contractVersion,
        relevantHistorySelectionVersion: history.selectionVersion,
        evidenceContractVersion: ANALYSIS_V3_FOUNDATION_CONTRACTS.evidenceEnvelope,
        featureProvenanceContractVersion: ANALYSIS_V3_FOUNDATION_CONTRACTS.featureProvenance,
        hierarchicalBackoffContractVersion: ANALYSIS_V3_FOUNDATION_CONTRACTS.hierarchicalBackoff
      },
      historyCounts: { ...history.counts },
      families: {
        capacity: buildCapacity(history, snapshot, featureAsOf),
        form: buildForm(history, featureAsOf),
        classContext: buildClassContext(history, snapshotContext, featureAsOf),
        development: buildDevelopment(history, featureAsOf),
        methodDistance: buildMethodDistance(history, featureAsOf),
        restReadiness: buildRestReadiness(history, featureAsOf),
        gallopRisk: buildGallopRisk(history, featureAsOf)
      }
    });
  }
  return out;
}
