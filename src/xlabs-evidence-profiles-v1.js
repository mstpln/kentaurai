import {
  ANALYSIS_V3_EVIDENCE_POLICY,
  ANALYSIS_V3_INITIAL_BACKOFF_POLICY,
  classifyEvidenceLevel,
  createEvidenceEnvelope,
  createFeatureProvenance,
  estimateWithHierarchicalBackoff
} from './analysis-v3-foundations.js';
import { XLABS_INTERVALS_V2_VERSION } from './xlabs-intervals-v2.js';

export const XLABS_EVIDENCE_PROFILE_CONTRACT = 'kentaurai-xlabs-evidence-profiles-v1';
export const XLABS_EVIDENCE_PROFILE_VERSION = 'xlabs-evidence-profiles-v1';
const SQL_CHUNK_SIZE = 80;

export const XLABS_EVIDENCE_PROFILE_POLICY = Object.freeze({
  recentWindowStarts: 5,
  relevantContext: 'start_method_and_distance_bucket',
  minContextSamples: ANALYSIS_V3_EVIDENCE_POLICY.levelC.minContextSamples,
  minShiftSampleSize: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize,
  populationShiftTvdThreshold: 0.20,
  targetUnderObservedRatio: 0.50,
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
  ])
});

const FEATURE_SPECS = Object.freeze({
  opening_100_km_pace_ms: Object.freeze({
    valueKey: 'opening_100_km_pace_ms',
    sourceIdKey: 'opening_source_record_id',
    sourceTimeKey: 'opening_source_selected_at',
    lowerIsBetter: true
  }),
  closing_400_km_pace_ms: Object.freeze({
    valueKey: 'closing_400_km_pace_ms',
    sourceIdKey: 'v1_source_record_id',
    sourceTimeKey: 'v1_source_selected_at',
    lowerIsBetter: true
  }),
  extra_distance_pct: Object.freeze({
    valueKey: 'extra_distance_pct',
    sourceIdKey: 'v1_source_record_id',
    sourceTimeKey: 'v1_source_selected_at',
    lowerIsBetter: true
  })
});

const PUBLIC_SHIFT_DIMENSIONS = Object.freeze([
  'year', 'track', 'method', 'distance', 'class', 'race_type', 'field_size'
]);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const safe = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
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

function targetCutoff(target, requestedAsOf) {
  const requested = instant(requestedAsOf, 'asOf');
  const scheduled = Date.parse(String(target?.scheduled_start_at ?? ''));
  const fallback = dateBoundaryMs(target?.race_date);
  const eventMs = Number.isFinite(scheduled) ? scheduled : fallback;
  return new Date(eventMs == null ? requested.ms : Math.min(requested.ms, eventMs)).toISOString();
}

export function canonicalXlabsMethod(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'auto' || text === 'autostart') return 'auto';
  if (text === 'volt' || text === 'volte' || text === 'voltstart') return 'volt';
  return text;
}

export function xlabsDistanceBucket(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  if (distance < 1800) return 'short';
  if (distance < 2400) return 'middle';
  if (distance < 3000) return 'long';
  return 'stayer';
}

export function xlabsFieldBucket(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1) return null;
  if (size <= 8) return 'small';
  if (size <= 12) return 'medium';
  return 'large';
}

export function parseXlabsKilometerTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+)\.(\d{2}),(\d)\s+min\/km$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const tenths = Number(match[3]);
  if (!Number.isInteger(minutes) || minutes < 0 || seconds < 0 || seconds > 59 || tenths < 0 || tenths > 9) return null;
  return (minutes * 60_000) + (seconds * 1000) + (tenths * 100);
}

function targetContext(target, fieldSize) {
  const raceTypes = String(target?.race_types ?? '').split('|').filter(Boolean).sort();
  return {
    year: String(target?.race_date ?? '').slice(0, 4) || 'unknown',
    track: target?.track_id == null ? 'unknown' : String(target.track_id),
    method: canonicalXlabsMethod(target?.start_method) ?? 'unknown',
    distance: xlabsDistanceBucket(target?.distance_m) ?? 'unknown',
    class: target?.stl_class || target?.main_class || 'unclassified',
    race_type: raceTypes.length ? raceTypes.join('|') : 'unclassified',
    field_size: xlabsFieldBucket(fieldSize) ?? 'unknown'
  };
}

function sameRelevantContext(row, context) {
  let compared = 0;
  if (context.method !== 'unknown') {
    compared += 1;
    if ((canonicalXlabsMethod(row.start_method) ?? 'unknown') !== context.method) return false;
  }
  if (context.distance !== 'unknown') {
    compared += 1;
    if ((xlabsDistanceBucket(row.distance_m) ?? 'unknown') !== context.distance) return false;
  }
  return compared > 0;
}

function startSortMs(row) {
  const scheduled = Date.parse(String(row.scheduled_start_at ?? ''));
  if (Number.isFinite(scheduled)) return scheduled;
  return dateBoundaryMs(row.race_date) ?? Number.NEGATIVE_INFINITY;
}

function featureValue(row, featureName) {
  const spec = FEATURE_SPECS[featureName];
  return finiteOrNull(row?.[spec.valueKey]);
}

function featureSourceRef(row, featureName) {
  const spec = FEATURE_SPECS[featureName];
  const id = String(row?.[spec.sourceIdKey] ?? '').trim();
  const selected = String(row?.[spec.sourceTimeKey] ?? '').trim();
  if (!id || !selected || !Number.isFinite(Date.parse(selected))) return null;
  return { source_record_id: id, selected_at: new Date(Date.parse(selected)).toISOString(), time_basis: 'fetched_at' };
}

function dedupeSourceRefs(rows, featureName) {
  const seen = new Set();
  const refs = [];
  for (const row of rows) {
    const ref = featureSourceRef(row, featureName);
    if (!ref) continue;
    const key = `${ref.source_record_id}|${ref.selected_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

function normalizedAggregateRows(rows = []) {
  if (!Array.isArray(rows)) throw new Error('populationAggregates must be an array');
  return rows.map((row) => {
    const dimension = requiredText(row.dimension, 'population aggregate dimension');
    const bucket = requiredText(row.bucket, 'population aggregate bucket');
    const features = {};
    for (const featureName of Object.keys(FEATURE_SPECS)) {
      features[featureName] = {
        eligible: Math.max(0, Number(row.eligible ?? 0)),
        measured: Math.max(0, Number(row[`${featureName}_measured`] ?? 0)),
        mean: finiteOrNull(row[`${featureName}_mean`])
      };
    }
    return { dimension, bucket, features };
  });
}

function aggregateLookup(rows, dimension, bucket, featureName) {
  const row = rows.find((item) => item.dimension === dimension && item.bucket === bucket);
  if (!row) return { eligible: 0, measured: 0, mean: null };
  return row.features[featureName] ?? { eligible: 0, measured: 0, mean: null };
}

function unavailableFeature(asOf, featureName, reason = 'horse_identity_unavailable') {
  return {
    ...createEvidenceEnvelope({
      value: null,
      evidenceSource: reason,
      evidenceLevel: 'D',
      sampleSize: 0,
      relevantSampleSize: 0,
      coverage: null,
      confidence: null,
      asOf,
      featureVersion: XLABS_EVIDENCE_PROFILE_VERSION
    }),
    context_sample_size: 0,
    measurement_depth: {
      completed_starts: 0,
      measured_starts: 0,
      recent_window_starts: 0,
      recent_measured_starts: 0,
      recent_measured_share: null,
      relevant_context_starts: 0,
      relevant_context_measured_starts: 0,
      relevant_context_measured_share: null,
      same_track_starts: 0,
      same_track_measured_starts: 0,
      same_class_starts: 0,
      same_class_measured_starts: 0
    },
    backoff: estimateWithHierarchicalBackoff(),
    direction: FEATURE_SPECS[featureName].lowerIsBetter ? 'lower_is_better' : null
  };
}

function featureProfile({ history, aggregateRows, context, target, featureName, asOf }) {
  const measured = history.filter((row) => featureValue(row, featureName) != null);
  const relevantHistory = history.filter((row) => sameRelevantContext(row, context));
  const relevantMeasured = relevantHistory.filter((row) => featureValue(row, featureName) != null);
  const selectedDirect = relevantMeasured.length ? relevantMeasured : measured;
  const directValue = mean(selectedDirect.map((row) => featureValue(row, featureName)));
  const directN = selectedDirect.length;
  const contextKey = `${context.method}|${context.distance}`;
  const contextPopulation = aggregateLookup(aggregateRows, 'method_distance', contextKey, featureName);
  const globalPopulation = aggregateLookup(aggregateRows, 'overall', 'all', featureName);
  const backoff = estimateWithHierarchicalBackoff({
    directValue,
    directSampleSize: directN,
    backoffCandidates: [
      { level: 'method_distance', value: contextPopulation.mean, sampleSize: contextPopulation.measured, effectiveSampleSize: contextPopulation.measured },
      { level: 'global', value: globalPopulation.mean, sampleSize: globalPopulation.measured, effectiveSampleSize: globalPopulation.measured }
    ]
  });
  const evidenceLevel = classifyEvidenceLevel({
    directSampleSize: measured.length,
    relevantDirectSampleSize: relevantMeasured.length,
    contextSampleSize: contextPopulation.measured
  });
  const sortedRecent = [...history].sort((a, b) => startSortMs(b) - startSortMs(a) || String(b.race_entry_id).localeCompare(String(a.race_entry_id)));
  const recent = sortedRecent.slice(0, XLABS_EVIDENCE_PROFILE_POLICY.recentWindowStarts);
  const recentMeasured = recent.filter((row) => featureValue(row, featureName) != null);
  const sameTrack = history.filter((row) => String(row.track_id ?? 'unknown') === context.track);
  const sameClass = history.filter((row) => String(row.stl_class || row.main_class || 'unclassified') === context.class);
  const envelope = createEvidenceEnvelope({
    value: backoff.value,
    evidenceSource: backoff.evidence_source,
    evidenceLevel,
    sampleSize: measured.length,
    relevantSampleSize: relevantMeasured.length,
    coverage: ratio(measured.length, history.length),
    confidence: null,
    asOf,
    featureVersion: XLABS_EVIDENCE_PROFILE_VERSION
  });
  const sourceRows = selectedDirect.length ? selectedDirect : [];
  const provenance = createFeatureProvenance({
    featureFamily: `xlabs_${featureName}`,
    featureVersion: XLABS_EVIDENCE_PROFILE_VERSION,
    asOf,
    sourceRefs: dedupeSourceRefs(sourceRows, featureName),
    inputVersions: {
      local_intervals: XLABS_INTERVALS_V2_VERSION,
      whole_race_telemetry: 'xlabs-telemetry-v1'
    },
    parameters: {
      recent_window_starts: XLABS_EVIDENCE_PROFILE_POLICY.recentWindowStarts,
      relevant_context: XLABS_EVIDENCE_PROFILE_POLICY.relevantContext,
      target_method: context.method,
      target_distance_bucket: context.distance
    },
    backoffLevel: backoff.backoff_level,
    estimateSource: backoff.evidence_source
  });
  return {
    ...envelope,
    context_sample_size: contextPopulation.measured,
    measurement_depth: {
      completed_starts: history.length,
      measured_starts: measured.length,
      recent_window_starts: recent.length,
      recent_measured_starts: recentMeasured.length,
      recent_measured_share: ratio(recentMeasured.length, recent.length),
      relevant_context_starts: relevantHistory.length,
      relevant_context_measured_starts: relevantMeasured.length,
      relevant_context_measured_share: ratio(relevantMeasured.length, relevantHistory.length),
      same_track_starts: sameTrack.length,
      same_track_measured_starts: sameTrack.filter((row) => featureValue(row, featureName) != null).length,
      same_class_starts: sameClass.length,
      same_class_measured_starts: sameClass.filter((row) => featureValue(row, featureName) != null).length
    },
    backoff,
    direction: FEATURE_SPECS[featureName].lowerIsBetter ? 'lower_is_better' : null,
    provenance
  };
}

function featureCoverage(profiles, entryIds, featureName) {
  const wanted = new Set(entryIds);
  const eligible = profiles.filter((profile) => wanted.has(profile.race_entry_id));
  const measured = eligible.filter((profile) => (profile.features[featureName]?.measurement_depth?.measured_starts ?? 0) > 0);
  return {
    measured_entries: measured.length,
    eligible_entries: eligible.length,
    measured_share: ratio(measured.length, eligible.length)
  };
}

function coverageBundle(profiles, entryIds) {
  const features = {};
  for (const featureName of Object.keys(FEATURE_SPECS)) features[featureName] = featureCoverage(profiles, entryIds, featureName);
  const wanted = new Set(entryIds);
  const eligible = profiles.filter((profile) => wanted.has(profile.race_entry_id));
  const tacticalMeasured = eligible.filter((profile) =>
    (profile.features.opening_100_km_pace_ms.measurement_depth.measured_starts > 0) ||
    (profile.features.closing_400_km_pace_ms.measurement_depth.measured_starts > 0)
  );
  return {
    eligible_entries: eligible.length,
    tactical_any_direct_entries: tacticalMeasured.length,
    tactical_any_direct_share: ratio(tacticalMeasured.length, eligible.length),
    features
  };
}

function shiftDimensionDiagnostic(rows, dimension, featureName, overallShare, targetBucket) {
  const dimensionRows = rows.filter((row) => row.dimension === dimension);
  const eligibleTotal = dimensionRows.reduce((sum, row) => sum + row.features[featureName].eligible, 0);
  const measuredTotal = dimensionRows.reduce((sum, row) => sum + row.features[featureName].measured, 0);
  let tvd = null;
  if (eligibleTotal > 0 && measuredTotal > 0) {
    tvd = 0.5 * dimensionRows.reduce((sum, row) => {
      const eligibleShare = row.features[featureName].eligible / eligibleTotal;
      const measuredShare = row.features[featureName].measured / measuredTotal;
      return sum + Math.abs(eligibleShare - measuredShare);
    }, 0);
  }
  const target = dimensionRows.find((row) => row.bucket === targetBucket) ?? null;
  const targetCoverage = target ? ratio(target.features[featureName].measured, target.features[featureName].eligible) : null;
  const flags = [];
  if (!target || target.features[featureName].eligible === 0) flags.push('target_bucket_unseen');
  else {
    if (target.features[featureName].eligible < XLABS_EVIDENCE_PROFILE_POLICY.minShiftSampleSize) flags.push('target_bucket_sparse');
    if (
      overallShare != null && overallShare > 0 && targetCoverage != null &&
      targetCoverage < overallShare * XLABS_EVIDENCE_PROFILE_POLICY.targetUnderObservedRatio
    ) flags.push('target_bucket_underobserved');
  }
  if (
    eligibleTotal >= XLABS_EVIDENCE_PROFILE_POLICY.minShiftSampleSize &&
    measuredTotal >= XLABS_EVIDENCE_PROFILE_POLICY.minShiftSampleSize &&
    tvd != null && tvd >= XLABS_EVIDENCE_PROFILE_POLICY.populationShiftTvdThreshold
  ) flags.push('distribution_shift');
  return {
    total_variation_distance: tvd,
    eligible_occurrences: eligibleTotal,
    measured_occurrences: measuredTotal,
    target_bucket: targetBucket,
    target_bucket_coverage: target ? {
      eligible: target.features[featureName].eligible,
      measured: target.features[featureName].measured,
      measured_share: targetCoverage
    } : { eligible: 0, measured: 0, measured_share: null },
    flags: [...new Set(flags)].sort(),
    coverage: dimensionRows.map((row) => ({
      bucket: row.bucket,
      eligible: row.features[featureName].eligible,
      measured: row.features[featureName].measured,
      measured_share: ratio(row.features[featureName].measured, row.features[featureName].eligible)
    }))
  };
}

export function buildXlabsPopulationShiftDiagnostics(populationAggregates, target, fieldSize) {
  const rows = normalizedAggregateRows(populationAggregates);
  const context = targetContext(target, fieldSize);
  const features = {};
  const allFlags = [];
  for (const featureName of Object.keys(FEATURE_SPECS)) {
    const overall = aggregateLookup(rows, 'overall', 'all', featureName);
    const overallShare = ratio(overall.measured, overall.eligible);
    const dimensions = {};
    for (const dimension of PUBLIC_SHIFT_DIMENSIONS) {
      dimensions[dimension] = shiftDimensionDiagnostic(rows, dimension, featureName, overallShare, context[dimension]);
      for (const flag of dimensions[dimension].flags) allFlags.push(`${featureName}:${dimension}:${flag}`);
    }
    features[featureName] = {
      overall: {
        eligible: overall.eligible,
        measured: overall.measured,
        measured_share: overallShare
      },
      dimensions
    };
  }
  return {
    contract_version: XLABS_EVIDENCE_PROFILE_CONTRACT,
    feature_version: XLABS_EVIDENCE_PROFILE_VERSION,
    policy: {
      min_shift_sample_size: XLABS_EVIDENCE_PROFILE_POLICY.minShiftSampleSize,
      tvd_risk_threshold: XLABS_EVIDENCE_PROFILE_POLICY.populationShiftTvdThreshold,
      target_underobserved_ratio: XLABS_EVIDENCE_PROFILE_POLICY.targetUnderObservedRatio
    },
    target_context: context,
    population_shift_risk: allFlags.some((flag) => flag.endsWith(':distribution_shift') || flag.endsWith(':target_bucket_underobserved') || flag.endsWith(':target_bucket_unseen')),
    risk_flags: [...new Set(allFlags)].sort(),
    features
  };
}

export function buildXlabsEvidenceProfiles({
  target,
  entries,
  historyRows = [],
  populationAggregates = [],
  frontContenderEntryIds = [],
  asOf
}) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('target race is required');
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('target entries are required');
  if (!Array.isArray(historyRows)) throw new Error('historyRows must be an array');
  if (!Array.isArray(frontContenderEntryIds)) throw new Error('frontContenderEntryIds must be an array');
  const cutoff = targetCutoff(target, asOf);
  const activeEntries = entries.filter((entry) => Number(entry.scratched || 0) !== 1);
  if (!activeEntries.length) throw new Error('target race has no active entries');
  const activeIds = new Set(activeEntries.map((entry) => requiredText(entry.race_entry_id ?? entry.id, 'race entry id')));
  const contenderIds = frontContenderEntryIds.map((value) => requiredText(value, 'front contender entry id'));
  if (new Set(contenderIds).size !== contenderIds.length) throw new Error('frontContenderEntryIds must not contain duplicates');
  for (const id of contenderIds) if (!activeIds.has(id)) throw new Error('front contender entry ids must belong to active target entries');
  const aggregates = normalizedAggregateRows(populationAggregates);
  const context = targetContext(target, activeEntries.length);
  const profiles = activeEntries.map((entry) => {
    const raceEntryId = requiredText(entry.race_entry_id ?? entry.id, 'race entry id');
    const horseId = entry.horse_id == null || String(entry.horse_id).trim() === '' ? null : String(entry.horse_id);
    const horseHistory = horseId == null ? [] : historyRows.filter((row) => String(row.horse_id ?? '') === horseId);
    const features = {};
    for (const featureName of Object.keys(FEATURE_SPECS)) {
      features[featureName] = horseId == null
        ? unavailableFeature(cutoff, featureName)
        : featureProfile({ history: horseHistory, aggregateRows: aggregates, context, target, featureName, asOf: cutoff });
    }
    return {
      race_entry_id: raceEntryId,
      horse_id: horseId,
      start_number: finiteOrNull(entry.start_number),
      features
    };
  });
  const fieldEntryIds = activeEntries.map((entry) => String(entry.race_entry_id ?? entry.id));
  return {
    contract_version: XLABS_EVIDENCE_PROFILE_CONTRACT,
    feature_version: XLABS_EVIDENCE_PROFILE_VERSION,
    as_of: cutoff,
    race_id: requiredText(target.id ?? target.race_id, 'target race id'),
    target_context: context,
    profiles,
    coverage: {
      field: coverageBundle(profiles, fieldEntryIds),
      front_contenders: contenderIds.length
        ? { status: 'available', selection_source: 'caller_supplied_market_blind_ids', ...coverageBundle(profiles, contenderIds) }
        : { status: 'not_provided', selection_source: null, ...coverageBundle(profiles, []) }
    },
    population_shift: buildXlabsPopulationShiftDiagnostics(populationAggregates, target, activeEntries.length),
    separation: {
      baseline_strength_modified: false,
      direct_data_bonus_applied: false,
      note: 'C2 reports optional telemetry evidence and coverage only; it does not modify baseline strength features.'
    }
  };
}

function featureRowsCte() {
  return `
    WITH opening_ranked AS (
      SELECT xi.race_entry_id, xi.km_pace_ms, xi.source_record_id, sr.fetched_at,
        ROW_NUMBER() OVER (
          PARTITION BY xi.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC, xi.source_record_id DESC
        ) AS rn
      FROM xlabs_intervals xi
      JOIN source_records sr ON sr.id=xi.source_record_id
      WHERE xi.mapper_version=?
        AND xi.eligibility_status='valid'
        AND xi.interval_start_m=0 AND xi.interval_end_m=100
        AND sr.source_type='xlabs_race_json'
        AND julianday(sr.fetched_at)<=julianday(?)
    ),
    v1_ranked AS (
      SELECT x.race_entry_id, x.last_400_time, x.extra_distance_m, x.source_record_id, sr.fetched_at,
        ROW_NUMBER() OVER (
          PARTITION BY x.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC, x.source_record_id DESC
        ) AS rn
      FROM xlabs_data x
      JOIN source_records sr ON sr.id=x.source_record_id
      WHERE x.quality_status='xlabs-telemetry-v1'
        AND sr.source_type='xlabs_race_json'
        AND julianday(sr.fetched_at)<=julianday(?)
    ),
    feature_rows AS (
      SELECT
        re.id AS race_entry_id,
        re.horse_id,
        r.id AS race_id,
        r.race_date,
        r.scheduled_start_at,
        r.track_id,
        r.start_method,
        r.distance_m,
        r.main_class,
        rsc.stl_class,
        COALESCE((
          SELECT GROUP_CONCAT(race_type,'|')
          FROM (SELECT race_type FROM race_type_classifications rtc WHERE rtc.race_id=r.id ORDER BY race_type)
        ), '') AS race_types,
        COALESCE(r.field_size, (
          SELECT COUNT(*) FROM race_entries fre WHERE fre.race_id=r.id AND COALESCE(fre.scratched,0)=0
        )) AS field_size,
        oi.km_pace_ms AS opening_100_km_pace_ms,
        CASE
          WHEN v1.last_400_time GLOB '[0-9]*.[0-9][0-9],[0-9] min/km'
          THEN (CAST(SUBSTR(v1.last_400_time,1,INSTR(v1.last_400_time,'.')-1) AS INTEGER)*60000)
             + (CAST(SUBSTR(v1.last_400_time,INSTR(v1.last_400_time,'.')+1,2) AS INTEGER)*1000)
             + (CAST(SUBSTR(v1.last_400_time,INSTR(v1.last_400_time,',')+1,1) AS INTEGER)*100)
          ELSE NULL
        END AS closing_400_km_pace_ms,
        CASE
          WHEN v1.extra_distance_m IS NOT NULL AND COALESCE(re.actual_start_distance_m,r.distance_m)>0
          THEN (v1.extra_distance_m * 100.0) / COALESCE(re.actual_start_distance_m,r.distance_m)
          ELSE NULL
        END AS extra_distance_pct,
        oi.source_record_id AS opening_source_record_id,
        oi.fetched_at AS opening_source_selected_at,
        v1.source_record_id AS v1_source_record_id,
        v1.fetched_at AS v1_source_selected_at
      FROM race_entries re
      JOIN races r ON r.id=re.race_id
      JOIN race_results rr ON rr.race_entry_id=re.id
      JOIN source_records result_sr ON result_sr.id=rr.source_record_id AND result_sr.source_type='official_provider'
      LEFT JOIN race_stl_classifications rsc ON rsc.race_id=r.id
      LEFT JOIN opening_ranked oi ON oi.race_entry_id=re.id AND oi.rn=1
      LEFT JOIN v1_ranked v1 ON v1.race_entry_id=re.id AND v1.rn=1
      WHERE COALESCE(re.scratched,0)=0
        AND re.horse_id IS NOT NULL
        AND julianday(result_sr.fetched_at)<=julianday(?)
        AND julianday(COALESCE(r.scheduled_start_at, r.race_date || 'T00:00:00Z'))<julianday(?)
    )
  `;
}

function featureRowsBindings(cutoff) {
  return [XLABS_INTERVALS_V2_VERSION, cutoff, cutoff, cutoff, cutoff];
}

function methodSql(alias = 'fr') {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.start_method,'')) IN ('auto','autostart') THEN 'auto'
    WHEN LOWER(COALESCE(${alias}.start_method,'')) IN ('volt','volte','voltstart') THEN 'volt'
    WHEN ${alias}.start_method IS NULL OR TRIM(${alias}.start_method)='' THEN 'unknown'
    ELSE LOWER(${alias}.start_method)
  END`;
}

function distanceSql(alias = 'fr') {
  return `CASE
    WHEN ${alias}.distance_m IS NULL OR ${alias}.distance_m<=0 THEN 'unknown'
    WHEN ${alias}.distance_m<1800 THEN 'short'
    WHEN ${alias}.distance_m<2400 THEN 'middle'
    WHEN ${alias}.distance_m<3000 THEN 'long'
    ELSE 'stayer'
  END`;
}

function fieldSql(alias = 'fr') {
  return `CASE
    WHEN ${alias}.field_size IS NULL OR ${alias}.field_size<1 THEN 'unknown'
    WHEN ${alias}.field_size<=8 THEN 'small'
    WHEN ${alias}.field_size<=12 THEN 'medium'
    ELSE 'large'
  END`;
}

async function loadTargetRace(env, raceId) {
  const race = await env.DB.prepare(`
    SELECT r.id,r.track_id,r.race_date,r.scheduled_start_at,r.distance_m,r.start_method,r.main_class,
      rsc.stl_class,
      COALESCE((
        SELECT GROUP_CONCAT(race_type,'|')
        FROM (SELECT race_type FROM race_type_classifications rtc WHERE rtc.race_id=r.id ORDER BY race_type)
      ), '') AS race_types
    FROM races r
    LEFT JOIN race_stl_classifications rsc ON rsc.race_id=r.id
    WHERE r.id=?
    LIMIT 1
  `).bind(raceId).first();
  if (!race) throw new Error('target race was not found');
  const { results: entries } = await env.DB.prepare(`
    SELECT id AS race_entry_id,horse_id,start_number,scratched
    FROM race_entries
    WHERE race_id=?
    ORDER BY start_number,id
  `).bind(raceId).all();
  if (!entries?.length) throw new Error('target race has no entries');
  return { race, entries };
}

async function loadHorseHistory(env, cutoff, horseIds) {
  if (!horseIds.length) return [];
  const rows = [];
  for (let index = 0; index < horseIds.length; index += SQL_CHUNK_SIZE) {
    const group = horseIds.slice(index, index + SQL_CHUNK_SIZE);
    const placeholders = group.map(() => '?').join(',');
    const sql = `${featureRowsCte()}
      SELECT * FROM feature_rows
      WHERE horse_id IN (${placeholders})
      ORDER BY horse_id, race_date, scheduled_start_at, race_entry_id
    `;
    const { results } = await env.DB.prepare(sql).bind(...featureRowsBindings(cutoff), ...group).all();
    rows.push(...(results || []));
  }
  return rows.sort((left, right) =>
    String(left.horse_id).localeCompare(String(right.horse_id))
    || String(left.race_date || '').localeCompare(String(right.race_date || ''))
    || String(left.scheduled_start_at || '').localeCompare(String(right.scheduled_start_at || ''))
    || String(left.race_entry_id).localeCompare(String(right.race_entry_id))
  );
}

async function loadPopulationAggregates(env, cutoff) {
  const sql = `${featureRowsCte()},
    dimensions (dimension) AS (
      VALUES ('overall'),('year'),('track'),('method'),('distance'),
        ('method_distance'),('class'),('race_type'),('field_size')
    ),
    expanded AS (
      SELECT d.dimension,
        CASE d.dimension
          WHEN 'overall' THEN 'all'
          WHEN 'year' THEN COALESCE(NULLIF(SUBSTR(fr.race_date,1,4),''),'unknown')
          WHEN 'track' THEN COALESCE(CAST(fr.track_id AS TEXT),'unknown')
          WHEN 'method' THEN ${methodSql('fr')}
          WHEN 'distance' THEN ${distanceSql('fr')}
          WHEN 'method_distance' THEN ${methodSql('fr')} || '|' || ${distanceSql('fr')}
          WHEN 'class' THEN COALESCE(NULLIF(fr.stl_class,''),NULLIF(fr.main_class,''),'unclassified')
          WHEN 'race_type' THEN COALESCE(NULLIF(fr.race_types,''),'unclassified')
          WHEN 'field_size' THEN ${fieldSql('fr')}
        END AS bucket,
        fr.*
      FROM feature_rows fr
      CROSS JOIN dimensions d
    )
    SELECT dimension,bucket,COUNT(*) AS eligible,
      SUM(CASE WHEN opening_100_km_pace_ms IS NOT NULL THEN 1 ELSE 0 END) AS opening_100_km_pace_ms_measured,
      AVG(opening_100_km_pace_ms) AS opening_100_km_pace_ms_mean,
      SUM(CASE WHEN closing_400_km_pace_ms IS NOT NULL THEN 1 ELSE 0 END) AS closing_400_km_pace_ms_measured,
      AVG(closing_400_km_pace_ms) AS closing_400_km_pace_ms_mean,
      SUM(CASE WHEN extra_distance_pct IS NOT NULL THEN 1 ELSE 0 END) AS extra_distance_pct_measured,
      AVG(extra_distance_pct) AS extra_distance_pct_mean
    FROM expanded
    GROUP BY dimension,bucket
    ORDER BY dimension,bucket
  `;
  const { results } = await env.DB.prepare(sql).bind(...featureRowsBindings(cutoff)).all();
  return results || [];
}

export async function buildXlabsEvidenceProfilesForRace(env, {
  raceId,
  asOf,
  frontContenderEntryIds = []
} = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = requiredText(raceId, 'raceId');
  const { race, entries } = await loadTargetRace(env, id);
  const cutoff = targetCutoff(race, asOf);
  const horseIds = [...new Set(entries
    .filter((entry) => Number(entry.scratched || 0) !== 1 && entry.horse_id != null)
    .map((entry) => String(entry.horse_id)))];
  const [historyRows, populationAggregates] = await Promise.all([
    loadHorseHistory(env, cutoff, horseIds),
    loadPopulationAggregates(env, cutoff)
  ]);
  return buildXlabsEvidenceProfiles({
    target: race,
    entries,
    historyRows,
    populationAggregates,
    frontContenderEntryIds,
    asOf: cutoff
  });
}
