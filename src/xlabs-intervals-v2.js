import { stableId } from './ids.js';
import {
  createEvidenceEnvelope,
  createFeatureProvenance
} from './analysis-v3-foundations.js';
import { finishImportRun, startImportRun } from './import/common.js';
import { mapXlabsTelemetryMeasurements } from './import/xlabs-telemetry.js';
import { validateXlabsRacePayload } from './provider/xlabs-race.js';

export const XLABS_INTERVALS_V2_VERSION = 'xlabs-intervals-v2';
export const XLABS_INTERVALS_V2_CONTRACT = 'kentaurai-xlabs-intervals-v2';
export const XLABS_INTERVALS_V2_POLICY = Object.freeze({
  intervalMeters: 100,
  localMinFrameCoverage: 0.90,
  maxEndpointErrorM: 20,
  minMeasuredDistanceRatio: 0.80,
  maxMeasuredDistanceRatio: 1.20,
  wholeRaceSummarySource: 'xlabs-telemetry-v1'
});

const SOURCE_TYPE = 'xlabs_race_json';
const PERSIST_BATCH_SIZE = 50;
const FIELD_RELATIVE_FEATURES = Object.freeze({
  first_100_km_pace_ms: 'lower_is_faster',
  second_100_km_pace_ms: 'lower_is_faster',
  last_100_km_pace_ms: 'lower_is_faster',
  last_200_km_pace_ms: 'lower_is_faster',
  last_400_km_pace_ms: 'lower_is_faster',
  extra_distance_pct: 'lower_is_less_distance'
});

function parseMetadata(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${name} must be a positive integer`);
  return number;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function instantText(value, name) {
  const ms = Date.parse(String(value ?? ''));
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a valid instant`);
  return new Date(ms).toISOString();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function populationVariance(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
}

function normalizeFrames(payload, trackId, raceNumber) {
  validateXlabsRacePayload(payload, trackId, raceNumber);
  return payload.map((frame, frameIndex) => {
    const targets = new Map();
    for (let targetIndex = 0; targetIndex < frame.targets.length; targetIndex += 1) {
      const target = frame.targets[targetIndex];
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error(`X-Labs interval target ${frameIndex}:${targetIndex} must be an object`);
      }
      const number = positiveInteger(target.number, `X-Labs interval target ${frameIndex}:${targetIndex} number`, 99);
      if (targets.has(number)) throw new Error(`X-Labs interval frame ${frameIndex} contains duplicate target ${number}`);
      targets.set(number, {
        number,
        posX: finiteNumber(target.posX, `X-Labs interval target ${frameIndex}:${targetIndex} posX`),
        posY: finiteNumber(target.posY, `X-Labs interval target ${frameIndex}:${targetIndex} posY`),
        distanceToFinish: finiteNumber(target.distanceToFinish, `X-Labs interval target ${frameIndex}:${targetIndex} distanceToFinish`)
      });
    }
    return {
      frameIndex,
      timestampMs: Date.parse(frame.timestamp),
      targets
    };
  });
}

function targetReadings(frames, startNumber) {
  const readings = [];
  for (const frame of frames) {
    const target = frame.targets.get(startNumber);
    if (!target) continue;
    readings.push({
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      distanceToFinish: target.distanceToFinish,
      posX: target.posX,
      posY: target.posY
    });
  }
  return readings;
}

function closestReading(readings, wantedDistanceToFinish) {
  let closest = null;
  let difference = Number.POSITIVE_INFINITY;
  for (const reading of readings) {
    const candidate = Math.abs(reading.distanceToFinish - wantedDistanceToFinish);
    if (candidate < difference) {
      closest = reading;
      difference = candidate;
    }
  }
  return closest ? { ...closest, endpointErrorM: difference } : null;
}

function intervalMeasurement(frames, readings, startNumber, startDistance, startM, endM) {
  const expectedDistanceM = endM - startM;
  const startReading = closestReading(readings, startDistance - startM);
  const endReading = closestReading(readings, startDistance - endM);
  if (!startReading || !endReading) {
    return {
      status: 'missing_endpoint',
      elapsedMs: null,
      kmPaceMs: null,
      measuredDistanceM: null,
      localTargetFrameCount: 0,
      localWindowFrameCount: 0,
      localFrameCoverage: 0,
      startEndpointErrorM: startReading?.endpointErrorM ?? null,
      endEndpointErrorM: endReading?.endpointErrorM ?? null
    };
  }

  const firstIndex = Math.min(startReading.frameIndex, endReading.frameIndex);
  const lastIndex = Math.max(startReading.frameIndex, endReading.frameIndex);
  const localWindowFrameCount = lastIndex - firstIndex + 1;
  let localTargetFrameCount = 0;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    if (frames[index]?.targets.has(startNumber)) localTargetFrameCount += 1;
  }
  const localFrameCoverage = localWindowFrameCount > 0 ? localTargetFrameCount / localWindowFrameCount : 0;
  const measuredDistanceM = startReading.distanceToFinish - endReading.distanceToFinish;
  const elapsedMs = endReading.timestampMs - startReading.timestampMs;
  const ratio = expectedDistanceM > 0 ? measuredDistanceM / expectedDistanceM : null;

  let status = 'valid';
  if (startReading.frameIndex >= endReading.frameIndex || !(elapsedMs > 0) || !(measuredDistanceM > 0)) {
    status = 'invalid_progression';
  } else if (
    startReading.endpointErrorM > XLABS_INTERVALS_V2_POLICY.maxEndpointErrorM ||
    endReading.endpointErrorM > XLABS_INTERVALS_V2_POLICY.maxEndpointErrorM
  ) {
    status = 'endpoint_too_far';
  } else if (
    ratio < XLABS_INTERVALS_V2_POLICY.minMeasuredDistanceRatio ||
    ratio > XLABS_INTERVALS_V2_POLICY.maxMeasuredDistanceRatio
  ) {
    status = 'distance_mismatch';
  } else if (localFrameCoverage < XLABS_INTERVALS_V2_POLICY.localMinFrameCoverage) {
    status = 'insufficient_local_coverage';
  }

  const kmPaceMs = status === 'valid' ? elapsedMs * (1000 / measuredDistanceM) : null;
  return {
    status,
    elapsedMs: status === 'valid' ? elapsedMs : null,
    kmPaceMs: Number.isFinite(kmPaceMs) ? kmPaceMs : null,
    measuredDistanceM,
    localTargetFrameCount,
    localWindowFrameCount,
    localFrameCoverage,
    startEndpointErrorM: startReading.endpointErrorM,
    endEndpointErrorM: endReading.endpointErrorM
  };
}

function standardIntervalBounds(startDistance) {
  const bounds = [];
  for (let startM = 0; startM + XLABS_INTERVALS_V2_POLICY.intervalMeters <= startDistance; startM += XLABS_INTERVALS_V2_POLICY.intervalMeters) {
    bounds.push([startM, startM + XLABS_INTERVALS_V2_POLICY.intervalMeters]);
  }
  return bounds;
}

function makeIntervalRows(frames, entry, sourceRecordId) {
  const startNumber = positiveInteger(entry.start_number, 'official race entry start_number', 99);
  const startDistance = positiveInteger(entry.actual_start_distance_m ?? entry.race_distance_m, 'official start distance');
  const readings = targetReadings(frames, startNumber);
  return standardIntervalBounds(startDistance).map(([startM, endM]) => {
    const measurement = intervalMeasurement(frames, readings, startNumber, startDistance, startM, endM);
    return {
      id: stableId('xlabsint', sourceRecordId, entry.race_entry_id, startM, endM, XLABS_INTERVALS_V2_VERSION),
      raceEntryId: entry.race_entry_id,
      sourceRecordId,
      startNumber,
      startDistance,
      intervalStartM: startM,
      intervalEndM: endM,
      ...measurement,
      mapperVersion: XLABS_INTERVALS_V2_VERSION
    };
  });
}

function directFeature(value, measurement, { asOf, sourceName = 'xlabs_direct_interval' } = {}) {
  const valid = typeof value === 'number' && Number.isFinite(value);
  return {
    ...createEvidenceEnvelope({
      value: valid ? value : null,
      evidenceSource: valid ? sourceName : `${sourceName}_unavailable`,
      evidenceLevel: valid ? 'B' : 'D',
      sampleSize: valid ? 1 : 0,
      relevantSampleSize: valid ? 1 : 0,
      coverage: measurement?.localFrameCoverage ?? 0,
      confidence: valid ? measurement.localFrameCoverage : 0,
      asOf,
      featureVersion: XLABS_INTERVALS_V2_VERSION
    }),
    measurement_status: measurement?.status ?? 'unavailable',
    interval_start_m: measurement?.intervalStartM ?? null,
    interval_end_m: measurement?.intervalEndM ?? null,
    measured_distance_m: measurement?.measuredDistanceM ?? null,
    local_target_frame_count: measurement?.localTargetFrameCount ?? 0,
    local_window_frame_count: measurement?.localWindowFrameCount ?? 0,
    local_frame_coverage: measurement?.localFrameCoverage ?? 0
  };
}

function aggregateFeature(value, { asOf, validCount, expectedCount, sourceName }) {
  const valid = typeof value === 'number' && Number.isFinite(value);
  const coverage = expectedCount > 0 ? validCount / expectedCount : 0;
  return createEvidenceEnvelope({
    value: valid ? value : null,
    evidenceSource: valid ? sourceName : `${sourceName}_unavailable`,
    evidenceLevel: valid ? 'B' : 'D',
    sampleSize: valid ? validCount : 0,
    relevantSampleSize: valid ? validCount : 0,
    coverage,
    confidence: valid ? coverage : 0,
    asOf,
    featureVersion: XLABS_INTERVALS_V2_VERSION
  });
}

function measurementForSegment(frames, readings, startNumber, startDistance, startM, endM) {
  if (!(startM >= 0) || !(endM > startM) || endM > startDistance) return null;
  return {
    intervalStartM: startM,
    intervalEndM: endM,
    ...intervalMeasurement(frames, readings, startNumber, startDistance, startM, endM)
  };
}

function makeFeatureBundle({ frames, entry, intervals, sourceRecordId, sourceSelectedAt, asOf, trustedV1Row }) {
  const startNumber = positiveInteger(entry.start_number, 'official race entry start_number', 99);
  const startDistance = positiveInteger(entry.actual_start_distance_m ?? entry.race_distance_m, 'official start distance');
  const readings = targetReadings(frames, startNumber);
  const totalTargetFrameCount = readings.length;
  const totalFrameCoverage = frames.length > 0 ? totalTargetFrameCount / frames.length : 0;

  const first100 = measurementForSegment(frames, readings, startNumber, startDistance, 0, 100);
  const second100 = measurementForSegment(frames, readings, startNumber, startDistance, 100, 200);
  const last100 = measurementForSegment(frames, readings, startNumber, startDistance, startDistance - 100, startDistance);
  const last200 = measurementForSegment(frames, readings, startNumber, startDistance, startDistance - 200, startDistance);
  const last400 = measurementForSegment(frames, readings, startNumber, startDistance, startDistance - 400, startDistance);

  const validIntervals = intervals.filter((row) => row.status === 'valid' && Number.isFinite(row.kmPaceMs));
  const paceValues = validIntervals.map((row) => row.kmPaceMs);
  const intervalCoverage = intervals.length > 0 ? validIntervals.length / intervals.length : 0;
  const midraceIntervals = intervals.filter((row) => row.intervalStartM >= 200 && row.intervalEndM <= startDistance - 400);
  const midracePaces = midraceIntervals
    .filter((row) => row.status === 'valid' && Number.isFinite(row.kmPaceMs))
    .map((row) => row.kmPaceMs);
  const midraceMedian = median(midracePaces);

  const firstValue = first100?.status === 'valid' ? first100.kmPaceMs : null;
  const secondValue = second100?.status === 'valid' ? second100.kmPaceMs : null;
  const last100Value = last100?.status === 'valid' ? last100.kmPaceMs : null;
  const last200Value = last200?.status === 'valid' ? last200.kmPaceMs : null;
  const last400Value = last400?.status === 'valid' ? last400.kmPaceMs : null;
  const openingDelta = Number.isFinite(firstValue) && Number.isFinite(secondValue) ? secondValue - firstValue : null;
  const closingDelta = Number.isFinite(last400Value) && Number.isFinite(midraceMedian) ? last400Value - midraceMedian : null;
  const extraDistancePct = trustedV1Row?.extraDistanceM == null
    ? null
    : (trustedV1Row.extraDistanceM / startDistance) * 100;

  const provenance = createFeatureProvenance({
    featureFamily: 'xlabs_intervals',
    featureVersion: XLABS_INTERVALS_V2_VERSION,
    asOf,
    sourceRefs: [{
      source_record_id: sourceRecordId,
      selected_at: sourceSelectedAt,
      time_basis: 'fetched_at'
    }],
    parameters: XLABS_INTERVALS_V2_POLICY,
    backoffLevel: null,
    estimateSource: 'direct_telemetry'
  });

  return {
    contract_version: XLABS_INTERVALS_V2_CONTRACT,
    mapper_version: XLABS_INTERVALS_V2_VERSION,
    race_entry_id: entry.race_entry_id,
    start_number: startNumber,
    start_distance_m: startDistance,
    source_record_id: sourceRecordId,
    source_selected_at: sourceSelectedAt,
    as_of: asOf,
    total_frame_count: frames.length,
    total_target_frame_count: totalTargetFrameCount,
    total_frame_coverage: totalFrameCoverage,
    whole_race_v1_eligible: Boolean(trustedV1Row),
    expected_100m_interval_count: intervals.length,
    valid_100m_interval_count: validIntervals.length,
    valid_100m_interval_share: intervalCoverage,
    features: {
      first_100_km_pace_ms: directFeature(firstValue, first100, { asOf }),
      second_100_km_pace_ms: directFeature(secondValue, second100, { asOf }),
      opening_acceleration_delta_ms_per_km: aggregateFeature(openingDelta, {
        asOf,
        validCount: Number(Number.isFinite(firstValue)) + Number(Number.isFinite(secondValue)),
        expectedCount: 2,
        sourceName: 'xlabs_opening_two_intervals'
      }),
      best_100_km_pace_ms: aggregateFeature(paceValues.length ? Math.min(...paceValues) : null, {
        asOf,
        validCount: validIntervals.length,
        expectedCount: intervals.length,
        sourceName: 'xlabs_valid_100m_intervals'
      }),
      median_100_km_pace_ms: aggregateFeature(median(paceValues), {
        asOf,
        validCount: validIntervals.length,
        expectedCount: intervals.length,
        sourceName: 'xlabs_valid_100m_intervals'
      }),
      worst_100_km_pace_ms: aggregateFeature(paceValues.length ? Math.max(...paceValues) : null, {
        asOf,
        validCount: validIntervals.length,
        expectedCount: intervals.length,
        sourceName: 'xlabs_valid_100m_intervals'
      }),
      pace_variance_ms2_per_km2: aggregateFeature(populationVariance(paceValues), {
        asOf,
        validCount: validIntervals.length,
        expectedCount: intervals.length,
        sourceName: 'xlabs_valid_100m_intervals'
      }),
      last_100_km_pace_ms: directFeature(last100Value, last100, { asOf }),
      last_200_km_pace_ms: directFeature(last200Value, last200, { asOf }),
      last_400_km_pace_ms: directFeature(last400Value, last400, { asOf }),
      closing_vs_midrace_delta_ms_per_km: aggregateFeature(closingDelta, {
        asOf,
        validCount: midracePaces.length + Number(Number.isFinite(last400Value)),
        expectedCount: midraceIntervals.length + 1,
        sourceName: 'xlabs_closing_vs_midrace'
      }),
      extra_distance_pct: createEvidenceEnvelope({
        value: Number.isFinite(extraDistancePct) ? extraDistancePct : null,
        evidenceSource: Number.isFinite(extraDistancePct) ? 'xlabs_telemetry_v1_whole_race' : 'xlabs_telemetry_v1_whole_race_unavailable',
        evidenceLevel: Number.isFinite(extraDistancePct) ? 'B' : 'D',
        sampleSize: Number.isFinite(extraDistancePct) ? 1 : 0,
        relevantSampleSize: Number.isFinite(extraDistancePct) ? 1 : 0,
        coverage: totalFrameCoverage,
        confidence: Number.isFinite(extraDistancePct) ? totalFrameCoverage : 0,
        asOf,
        featureVersion: XLABS_INTERVALS_V2_VERSION
      })
    },
    field_relative: {},
    provenance
  };
}

function addFieldRelativeMetrics(bundles) {
  const activeFieldSize = bundles.length;
  for (const [featureName, direction] of Object.entries(FIELD_RELATIVE_FEATURES)) {
    const measured = bundles
      .map((bundle) => ({
        bundle,
        value: bundle.features[featureName]?.value
      }))
      .filter((item) => typeof item.value === 'number' && Number.isFinite(item.value))
      .sort((a, b) => a.value - b.value || a.bundle.start_number - b.bundle.start_number || a.bundle.race_entry_id.localeCompare(b.bundle.race_entry_id));
    const measuredCount = measured.length;
    const measuredShare = activeFieldSize > 0 ? measuredCount / activeFieldSize : 0;
    for (const bundle of bundles) {
      const value = bundle.features[featureName]?.value;
      const rank = typeof value === 'number' && Number.isFinite(value)
        ? 1 + measured.filter((item) => item.value < value).length
        : null;
      bundle.field_relative[featureName] = {
        direction,
        ascending_rank: rank,
        ascending_percentile: rank == null ? null : measuredCount <= 1 ? 0.5 : (rank - 1) / (measuredCount - 1),
        measured_field_count: measuredCount,
        active_field_size: activeFieldSize,
        measured_field_share: measuredShare
      };
    }
  }
}

export function buildXlabsIntervalsV2(payload, {
  trackId,
  raceNumber,
  entries,
  sourceRecordId,
  sourceSelectedAt,
  asOf = sourceSelectedAt
}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('normalized official race entries are required');
  const sourceId = requiredText(sourceRecordId, 'sourceRecordId');
  const selectedAt = instantText(sourceSelectedAt, 'sourceSelectedAt');
  const featureAsOf = instantText(asOf, 'asOf');
  if (Date.parse(selectedAt) > Date.parse(featureAsOf)) throw new Error('sourceSelectedAt cannot be after asOf');
  const activeEntries = entries.filter((entry) => Number(entry.scratched || 0) !== 1);
  if (activeEntries.length === 0) throw new Error('normalized official race has no active entries');
  const frames = normalizeFrames(payload, trackId, raceNumber);

  const seenStarts = new Set();
  for (const entry of activeEntries) {
    const startNumber = positiveInteger(entry.start_number, 'official race entry start_number', 99);
    if (seenStarts.has(startNumber)) throw new Error(`official race contains duplicate start number ${startNumber}`);
    seenStarts.add(startNumber);
  }

  const trustedV1 = mapXlabsTelemetryMeasurements(payload, {
    trackId,
    raceNumber,
    entries: activeEntries
  });
  const trustedV1ByEntry = new Map(trustedV1.rows.map((row) => [row.raceEntryId, row]));

  const intervals = [];
  const bundles = [];
  for (const entry of activeEntries) {
    const entryIntervals = makeIntervalRows(frames, entry, sourceId);
    intervals.push(...entryIntervals);
    bundles.push(makeFeatureBundle({
      frames,
      entry,
      intervals: entryIntervals,
      sourceRecordId: sourceId,
      sourceSelectedAt: selectedAt,
      asOf: featureAsOf,
      trustedV1Row: trustedV1ByEntry.get(entry.race_entry_id) ?? null
    }));
  }
  addFieldRelativeMetrics(bundles);

  return {
    contractVersion: XLABS_INTERVALS_V2_CONTRACT,
    mapperVersion: XLABS_INTERVALS_V2_VERSION,
    frameCount: frames.length,
    activeFieldSize: activeEntries.length,
    intervalRows: intervals,
    bundles
  };
}

async function loadCapturedSource(env, sourceRecordId) {
  const source = await env.DB.prepare(`
    SELECT id, raw_object_key, quality_status, metadata_json, fetched_at
    FROM source_records
    WHERE id = ? AND source_type = ?
    LIMIT 1
  `).bind(sourceRecordId, SOURCE_TYPE).first();
  if (!source?.raw_object_key) throw new Error('captured X-Labs race source record was not found');
  const metadata = parseMetadata(source.metadata_json);
  const date = String(metadata.date || '');
  const trackId = positiveInteger(metadata.xlabsTrackId, 'captured X-Labs track id', 99);
  const requestedTrackId = positiveInteger(metadata.requestedTrackId, 'captured official track id', 99);
  const raceNumber = positiveInteger(metadata.raceNumber, 'captured X-Labs race number', 99);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('captured X-Labs race date is invalid');
  if (trackId !== requestedTrackId) throw new Error('captured X-Labs and official track ids are not the verified observed identity');
  const fetchedAt = instantText(source.fetched_at, 'captured X-Labs fetched_at');
  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured X-Labs raw object was not found');
  let payload;
  try { payload = JSON.parse(await object.text()); } catch { throw new Error('captured X-Labs raw object was not valid JSON'); }
  validateXlabsRacePayload(payload, trackId, raceNumber);
  return { source, metadata: { ...metadata, date, trackId, requestedTrackId, raceNumber }, fetchedAt, payload };
}

async function loadOfficialRaceEntries(env, { date, requestedTrackId, raceNumber }) {
  const { results: races } = await env.DB.prepare(`
    SELECT r.id, r.distance_m AS race_distance_m
    FROM races r
    JOIN track_external_ids tx ON tx.track_id = r.track_id
    WHERE r.race_date = ? AND r.race_number = ?
      AND tx.source_type = 'official' AND tx.external_id = ?
    ORDER BY r.id
  `).bind(date, raceNumber, String(requestedTrackId)).all();
  if (races.length !== 1) throw new Error('captured X-Labs race did not resolve to exactly one normalized official race');
  const race = races[0];
  const { results: entries } = await env.DB.prepare(`
    SELECT id AS race_entry_id, start_number, actual_start_distance_m, scratched, ? AS race_distance_m
    FROM race_entries
    WHERE race_id = ?
    ORDER BY start_number, id
  `).bind(race.race_distance_m, race.id).all();
  if (entries.length === 0) throw new Error('normalized official race has no entries');
  return { race, entries };
}

export async function deriveCapturedXlabsIntervalsV2(env, sourceRecordId, { asOf = null } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = requiredText(sourceRecordId, 'source_record_id');
  const captured = await loadCapturedSource(env, id);
  const official = await loadOfficialRaceEntries(env, captured.metadata);
  const featureAsOf = asOf == null ? captured.fetchedAt : instantText(asOf, 'asOf');
  return {
    ...captured,
    ...official,
    ...buildXlabsIntervalsV2(captured.payload, {
      trackId: captured.metadata.trackId,
      raceNumber: captured.metadata.raceNumber,
      entries: official.entries,
      sourceRecordId: id,
      sourceSelectedAt: captured.fetchedAt,
      asOf: featureAsOf
    })
  };
}

function insertIntervalStatement(env, row) {
  return env.DB.prepare(`
    INSERT INTO xlabs_intervals
      (id, race_entry_id, source_record_id, interval_start_m, interval_end_m,
       elapsed_ms, km_pace_ms, measured_distance_m, local_target_frame_count,
       local_window_frame_count, local_frame_coverage, start_endpoint_error_m,
       end_endpoint_error_m, eligibility_status, mapper_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(race_entry_id, source_record_id, interval_start_m, interval_end_m, mapper_version) DO NOTHING
  `).bind(
    row.id,
    row.raceEntryId,
    row.sourceRecordId,
    row.intervalStartM,
    row.intervalEndM,
    row.elapsedMs,
    row.kmPaceMs,
    row.measuredDistanceM,
    row.localTargetFrameCount,
    row.localWindowFrameCount,
    row.localFrameCoverage,
    row.startEndpointErrorM,
    row.endEndpointErrorM,
    row.status,
    row.mapperVersion
  );
}

export async function normalizeCapturedXlabsIntervalsV2(env, sourceRecordId, options = {}) {
  const id = requiredText(sourceRecordId, 'source_record_id');
  const run = await startImportRun(env, 'xlabs_intervals_v2_normalize', {
    sourceRecordId: id,
    version: XLABS_INTERVALS_V2_VERSION
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const derived = await deriveCapturedXlabsIntervalsV2(env, id, options);
    for (let offset = 0; offset < derived.intervalRows.length; offset += PERSIST_BATCH_SIZE) {
      const rows = derived.intervalRows.slice(offset, offset + PERSIST_BATCH_SIZE);
      const results = await env.DB.batch(rows.map((row) => insertIntervalStatement(env, row)));
      for (const result of results) {
        if ((result?.meta?.changes || 0) > 0) counts.inserted += 1;
        else counts.skipped += 1;
      }
    }
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: id,
      raceId: derived.race.id,
      mapperVersion: XLABS_INTERVALS_V2_VERSION,
      intervalRows: derived.intervalRows.length,
      validIntervals: derived.intervalRows.filter((row) => row.status === 'valid').length,
      featureBundles: derived.bundles.length,
      counts,
      sourceQualityStatus: derived.source.quality_status
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
