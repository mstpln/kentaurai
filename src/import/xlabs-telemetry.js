import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';
import { validateXlabsRacePayload } from '../provider/xlabs-race.js';

export const XLABS_TELEMETRY_VERSION = 'xlabs-telemetry-v1';
const SOURCE_TYPE = 'xlabs_race_json';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const MIN_FRAME_COVERAGE = 0.99;
const SEGMENT_LENGTHS = [200, 400, 500, 800, 1000];

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
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
  return number;
}

function normalizeFrames(payload, trackId, raceNumber) {
  validateXlabsRacePayload(payload, trackId, raceNumber);
  return payload.map((frame, frameIndex) => {
    const targets = new Map();
    for (let targetIndex = 0; targetIndex < frame.targets.length; targetIndex += 1) {
      const target = frame.targets[targetIndex];
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error(`X-Labs telemetry target ${frameIndex}:${targetIndex} must be an object`);
      }
      const number = positiveInteger(target.number, `X-Labs telemetry target ${frameIndex}:${targetIndex} number`, 99);
      if (targets.has(number)) throw new Error(`X-Labs telemetry frame ${frameIndex} contains duplicate target ${number}`);
      targets.set(number, {
        number,
        posX: finiteNumber(target.posX, `X-Labs telemetry target ${frameIndex}:${targetIndex} posX`),
        posY: finiteNumber(target.posY, `X-Labs telemetry target ${frameIndex}:${targetIndex} posY`),
        distanceToFinish: finiteNumber(target.distanceToFinish, `X-Labs telemetry target ${frameIndex}:${targetIndex} distanceToFinish`)
      });
    }
    return { timestampMs: Date.parse(frame.timestamp), targets };
  });
}

function closestReading(frames, startNumber, wantedDistanceToFinish) {
  let closest = null;
  let closestDifference = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const target = frame.targets.get(startNumber);
    if (!target) continue;
    const difference = Math.abs(target.distanceToFinish - wantedDistanceToFinish);
    if (difference < closestDifference) {
      closest = { timestampMs: frame.timestampMs, distanceToFinish: target.distanceToFinish };
      closestDifference = difference;
    }
  }
  return closest;
}

function perKilometerMilliseconds(frames, startNumber, startDistance, fromMeters, toMeters) {
  const cappedTo = Math.min(toMeters, startDistance - 1);
  const from = closestReading(frames, startNumber, startDistance - fromMeters);
  const to = closestReading(frames, startNumber, startDistance - cappedTo);
  if (!from || !to || from.timestampMs === to.timestampMs) return null;
  const measuredDistance = Math.abs(to.distanceToFinish - from.distanceToFinish);
  const elapsedMs = to.timestampMs - from.timestampMs;
  if (!(measuredDistance > 0) || !(elapsedMs >= 0)) return null;
  const result = elapsedMs * (1000 / measuredDistance);
  return Number.isFinite(result) ? result : null;
}

export function formatXlabsKilometerTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const wholeMilliseconds = Math.floor(milliseconds);
  const minutes = Math.floor(wholeMilliseconds / 60_000);
  const seconds = Math.floor(wholeMilliseconds / 1000) % 60;
  const tenths = Math.floor((wholeMilliseconds % 1000) / 100);
  return `${minutes}.${String(seconds).padStart(2, '0')},${tenths} min/km`;
}

function actualDistance(frames, startNumber) {
  let previous = null;
  let distance = 0;
  let firstTimestampMs = null;
  let lastTimestampMs = null;
  let includedFrames = 0;
  for (const frame of frames) {
    const target = frame.targets.get(startNumber);
    if (!target || !(target.distanceToFinish > 0)) continue;
    if (previous) distance += Math.hypot(target.posX - previous.posX, target.posY - previous.posY);
    else firstTimestampMs = frame.timestampMs;
    previous = target;
    lastTimestampMs = frame.timestampMs;
    includedFrames += 1;
  }
  if (includedFrames < 2 || !(distance > 0) || firstTimestampMs === lastTimestampMs) {
    return { distanceMeters: null, kilometerTimeMs: null };
  }
  const distanceMeters = Math.round(distance);
  const kilometerTimeMs = (lastTimestampMs - firstTimestampMs) * (1000 / distanceMeters);
  return {
    distanceMeters,
    kilometerTimeMs: Number.isFinite(kilometerTimeMs) && kilometerTimeMs >= 0 ? kilometerTimeMs : null
  };
}

function intervalMeasurements(frames, startNumber, startDistance) {
  const intervals = [];
  for (let start = 0; start < startDistance; start += 100) {
    const end = Math.min(start + 100, startDistance);
    intervals.push({
      start_m: start,
      end_m: end,
      km_time: formatXlabsKilometerTime(perKilometerMilliseconds(frames, startNumber, startDistance, start, end))
    });
  }
  return intervals;
}

export function mapXlabsTelemetryMeasurements(payload, { trackId, raceNumber, entries }) {
  const frames = normalizeFrames(payload, trackId, raceNumber);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('normalized official race entries are required');
  const seenStarts = new Set();
  const rows = [];
  const skipped = [];

  for (const entry of entries) {
    const startNumber = positiveInteger(entry.start_number, 'official race entry start_number', 99);
    if (seenStarts.has(startNumber)) throw new Error(`official race contains duplicate start number ${startNumber}`);
    seenStarts.add(startNumber);
    const targetFrameCount = frames.reduce((count, frame) => count + Number(frame.targets.has(startNumber)), 0);
    const frameCoverage = targetFrameCount / frames.length;
    if (frameCoverage < MIN_FRAME_COVERAGE) {
      skipped.push({ raceEntryId: entry.race_entry_id, startNumber, reason: 'insufficient_frame_coverage', frameCoverage });
      continue;
    }

    const startDistance = positiveInteger(entry.actual_start_distance_m ?? entry.race_distance_m, 'official start distance');
    const segments = new Map(SEGMENT_LENGTHS.map((length) => [
      length,
      formatXlabsKilometerTime(perKilometerMilliseconds(frames, startNumber, startDistance, startDistance - length, startDistance))
    ]));
    const actual = actualDistance(frames, startNumber);
    rows.push({
      raceEntryId: entry.race_entry_id,
      startNumber,
      startDistance,
      first200Time: formatXlabsKilometerTime(perKilometerMilliseconds(frames, startNumber, startDistance, 0, 200)),
      last200Time: segments.get(200),
      last400Time: segments.get(400),
      last500Time: segments.get(500),
      last800Time: segments.get(800),
      last1000Time: segments.get(1000),
      actualDistanceM: actual.distanceMeters,
      extraDistanceM: actual.distanceMeters == null ? null : actual.distanceMeters - startDistance,
      convertedKmTime: formatXlabsKilometerTime(actual.kilometerTimeMs),
      slipstreamM: null,
      segments: {
        version: XLABS_TELEMETRY_VERSION,
        frame_count: frames.length,
        target_frame_count: targetFrameCount,
        frame_coverage: frameCoverage,
        intervals: intervalMeasurements(frames, startNumber, startDistance)
      },
      qualityStatus: XLABS_TELEMETRY_VERSION
    });
  }
  return { rows, skipped, frameCount: frames.length };
}

async function loadCapturedSource(env, sourceRecordId) {
  const source = await env.DB.prepare(`
    SELECT id, raw_object_key, quality_status, metadata_json
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
  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured X-Labs raw object was not found');
  let payload;
  try { payload = JSON.parse(await object.text()); } catch { throw new Error('captured X-Labs raw object was not valid JSON'); }
  validateXlabsRacePayload(payload, trackId, raceNumber);
  return { source, metadata: { ...metadata, date, trackId, requestedTrackId, raceNumber }, payload };
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

export async function deriveCapturedXlabsMeasurements(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  const captured = await loadCapturedSource(env, id);
  const official = await loadOfficialRaceEntries(env, captured.metadata);
  const mapped = mapXlabsTelemetryMeasurements(captured.payload, {
    trackId: captured.metadata.trackId,
    raceNumber: captured.metadata.raceNumber,
    entries: official.entries
  });
  if (mapped.rows.length === 0) throw new Error('captured X-Labs telemetry had no official entries with verified frame coverage');
  return { ...captured, ...official, ...mapped };
}

export async function normalizeCapturedXlabsRace(env, sourceRecordId) {
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  const run = await startImportRun(env, 'xlabs_telemetry_normalize', { sourceRecordId: id, version: XLABS_TELEMETRY_VERSION });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const derived = await deriveCapturedXlabsMeasurements(env, id);
    for (const row of derived.rows) {
      const result = await env.DB.prepare(`
        INSERT INTO xlabs_data
          (id, race_entry_id, first_200_time, last_200_time, last_400_time, last_500_time,
           last_800_time, last_1000_time, actual_distance_m, extra_distance_m, converted_km_time,
           slipstream_m, segments_json, quality_status, source_record_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(race_entry_id, source_record_id) DO NOTHING
      `).bind(
        stableId('xlabs', id, row.raceEntryId), row.raceEntryId, row.first200Time, row.last200Time,
        row.last400Time, row.last500Time, row.last800Time, row.last1000Time, row.actualDistanceM,
        row.extraDistanceM, row.convertedKmTime, row.slipstreamM, JSON.stringify(row.segments),
        row.qualityStatus, id
      ).run();
      if ((result?.meta?.changes || 0) > 0) counts.inserted += 1;
      else counts.skipped += 1;
    }
    counts.skipped += derived.skipped.length;
    await env.DB.prepare(`UPDATE source_records SET quality_status = ? WHERE id = ?`).bind(NORMALIZED_QUALITY, id).run();
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: id,
      raceId: derived.race.id,
      frameCount: derived.frameCount,
      normalizedRows: derived.rows.length,
      skippedEntries: derived.skipped.length,
      counts,
      qualityStatus: NORMALIZED_QUALITY,
      mapperVersion: XLABS_TELEMETRY_VERSION,
      verifiedSemantics: [
        'first_200_time', 'last_200_time', 'last_400_time', 'last_500_time', 'last_800_time',
        'last_1000_time', 'actual_distance_m', 'extra_distance_m', 'converted_km_time'
      ],
      unmappedSemantics: ['slipstream_m']
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
