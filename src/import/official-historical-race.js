import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';
import {
  finiteNumber,
  insertEquipment,
  maybeText,
  recordObservation,
  startPosition,
  upsertHorse,
  upsertPerson,
  upsertTrack
} from './official-live-chunked.js';
import { validateRaceId } from '../provider/official.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const ENTRY_QUALITY = 'official_historical_result';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function validateOfficialRacePayload(value) {
  const race = requireObject(value, 'official race payload');
  const id = validateRaceId(race.id);
  const [idDate, idTrack, idNumber] = id.split('_');
  if (race.date !== idDate || Number(race.track?.id) !== Number(idTrack) || Number(race.number) !== Number(idNumber)) {
    throw new Error('official race identity fields do not match its id');
  }
  if (!maybeText(race.track?.name)) throw new Error('official race track name is required');
  if (!Array.isArray(race.starts)) throw new Error('official race starts must be an array');
  const numbers = new Set();
  for (const start of race.starts) {
    requireObject(start, 'official race start');
    const number = finiteNumber(start.number);
    if (!Number.isInteger(number) || number < 1 || number > 99 || numbers.has(number)) {
      throw new Error('official race start numbers must be unique integers');
    }
    numbers.add(number);
    if (start.horse?.id == null || !maybeText(start.horse?.name)) throw new Error(`official race start ${number} is missing horse identity`);
    if (start.scratched != null && typeof start.scratched !== 'boolean') throw new Error(`official race start ${number} has invalid scratched status`);
    if (start.result != null) requireObject(start.result, `official race start ${number} result`);
  }
  return race;
}

export function officialRaceHasFinalResults(value) {
  const race = validateOfficialRacePayload(value);
  if (race.starts.length === 0) return false;
  return race.starts.every((start) => start.scratched === true || (start.result && typeof start.result === 'object' && !Array.isArray(start.result)));
}

function kmTimeText(value) {
  if (!value || typeof value !== 'object') return null;
  const minutes = finiteNumber(value.minutes);
  const seconds = finiteNumber(value.seconds);
  const tenths = finiteNumber(value.tenths);
  if (!Number.isInteger(minutes) || minutes < 0 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59 ||
      !Number.isInteger(tenths) || tenths < 0 || tenths > 9) return null;
  return `${minutes}.${String(seconds).padStart(2, '0')},${tenths}`;
}

async function ensureHistoricalRace(env, race, ctx) {
  const trackId = await upsertTrack(env, race.track, ctx, { observe: true });
  await env.DB.prepare(`
    INSERT INTO races
      (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method,
       field_size, starters_declared, first_prize_sek, race_name, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      track_id = excluded.track_id,
      race_date = excluded.race_date,
      race_number = excluded.race_number,
      scheduled_start_at = COALESCE(excluded.scheduled_start_at, races.scheduled_start_at),
      distance_m = COALESCE(excluded.distance_m, races.distance_m),
      start_method = COALESCE(excluded.start_method, races.start_method),
      field_size = excluded.field_size,
      starters_declared = excluded.starters_declared,
      race_name = COALESCE(excluded.race_name, races.race_name),
      status = COALESCE(excluded.status, races.status),
      source_quality = excluded.source_quality,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    race.id,
    trackId,
    race.date,
    race.number,
    maybeText(race.scheduledStartTime),
    finiteNumber(race.distance),
    maybeText(race.startMethod),
    race.starts.length,
    race.starts.length,
    null,
    maybeText(race.name),
    maybeText(race.status),
    NORMALIZED_QUALITY
  ).run();
  await env.DB.prepare(`
    INSERT INTO race_external_ids (race_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET race_id = excluded.race_id
  `).bind(race.id, EXTERNAL_SOURCE, race.id).run();
  await recordObservation(env, ctx.counts, 'race', race.id, ctx.sourceRecordId, ctx.observedAt, {
    externalId: race.id,
    trackExternalId: String(race.track.id),
    date: race.date,
    raceNumber: race.number,
    distanceM: finiteNumber(race.distance),
    startMethod: maybeText(race.startMethod),
    scheduledStartAt: maybeText(race.scheduledStartTime),
    startTime: maybeText(race.startTime),
    raceName: maybeText(race.name),
    status: maybeText(race.status),
    prizeText: maybeText(race.prize),
    terms: Array.isArray(race.terms) ? race.terms : null,
    observedStartCount: race.starts.length
  });
  return trackId;
}

async function mapHistoricalStart(env, race, start, ctx) {
  const trainerId = await upsertPerson(env, 'trainer', start.horse?.trainer, ctx);
  const driverId = await upsertPerson(env, 'driver', start.driver, ctx);
  const horseId = await upsertHorse(env, start.horse, trainerId, ctx);
  const entryId = stableId('entry', race.id, horseId);
  const pos = startPosition(race, start);
  const scratched = start.scratched === true;

  await env.DB.prepare(`
    INSERT INTO race_entries
      (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, start_tier,
       handicap_m, actual_start_distance_m, scratched, scratch_reason, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      driver_id = excluded.driver_id,
      trainer_id = excluded.trainer_id,
      start_number = excluded.start_number,
      actual_lane = excluded.actual_lane,
      start_tier = excluded.start_tier,
      handicap_m = excluded.handicap_m,
      actual_start_distance_m = excluded.actual_start_distance_m,
      scratched = excluded.scratched,
      data_quality = excluded.data_quality,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    entryId, race.id, horseId, driverId, trainerId, start.number, pos.lane, pos.tier,
    pos.handicapM, pos.actualDistance, Number(scratched), ENTRY_QUALITY
  ).run();

  await recordObservation(env, ctx.counts, 'race_entry', entryId, ctx.sourceRecordId, ctx.observedAt, {
    externalStartId: maybeText(start.id),
    raceExternalId: race.id,
    horseExternalId: String(start.horse.id),
    driverExternalId: start.driver?.id == null ? null : String(start.driver.id),
    trainerExternalId: start.horse?.trainer?.id == null ? null : String(start.horse.trainer.id),
    startNumber: start.number,
    postPosition: finiteNumber(start.postPosition),
    actualStartDistanceM: pos.actualDistance,
    handicapM: pos.handicapM,
    startTier: pos.tier,
    scratched,
    scratchSemanticsVerified: true
  });
  await insertEquipment(env, entryId, start.horse, ctx);

  const result = start.result && typeof start.result === 'object' ? start.result : null;
  if (!result) return;
  const place = finiteNumber(result.place);
  const placing = Number.isInteger(place) && place > 0 ? place : null;
  const gallop = result.galloped === true;
  const disqualified = result.disqualified === true;
  const officialOdds = finiteNumber(result.finalOdds);
  const insert = await env.DB.prepare(`
    INSERT INTO race_results
      (race_entry_id, placing, placing_text, km_time, prize_sek, gallop, disqualified,
       official_odds, result_status, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(race_entry_id) DO UPDATE SET
      placing = excluded.placing,
      placing_text = excluded.placing_text,
      km_time = excluded.km_time,
      prize_sek = excluded.prize_sek,
      gallop = excluded.gallop,
      disqualified = excluded.disqualified,
      official_odds = excluded.official_odds,
      result_status = excluded.result_status,
      source_record_id = excluded.source_record_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    entryId,
    placing,
    scratched ? 'scratched' : disqualified ? 'disqualified' : null,
    kmTimeText(result.kmTime),
    finiteNumber(result.prizeMoney),
    Number(gallop),
    Number(disqualified),
    officialOdds != null && officialOdds > 0 ? officialOdds : null,
    scratched ? 'scratched' : 'official',
    ctx.sourceRecordId
  ).run();
  ctx.counts.inserted += Number(insert.meta?.changes ?? 0);
  await recordObservation(env, ctx.counts, 'race_result', entryId, ctx.sourceRecordId, ctx.observedAt, {
    place: placing,
    finishOrder: finiteNumber(result.finishOrder),
    kmTime: kmTimeText(result.kmTime),
    kmTimeCode: maybeText(result.kmTime?.code),
    prizeSek: finiteNumber(result.prizeMoney),
    finalOdds: officialOdds,
    galloped: gallop,
    disqualified,
    scratched
  });
}

export async function normalizeCapturedOfficialRace(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  const source = await env.DB.prepare(`
    SELECT source_type, external_id, fetched_at, raw_object_key, quality_status
    FROM source_records WHERE id = ? AND source_type = ? LIMIT 1
  `).bind(id, SOURCE_TYPE).first();
  if (!source?.raw_object_key || !String(source.external_id || '').startsWith('race:')) {
    throw new Error('captured official race source record was not found');
  }
  if (source.quality_status === NORMALIZED_QUALITY) {
    return { sourceRecordId: id, raceId: source.external_id.slice(5), qualityStatus: NORMALIZED_QUALITY, done: true, reused: true };
  }
  if (source.quality_status !== 'captured_unmapped') throw new Error(`source record has unsupported quality status: ${source.quality_status}`);

  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured raw object was not found');
  let payload;
  try { payload = JSON.parse(await object.text()); } catch (error) { throw new Error(`captured raw object is not valid JSON: ${error.message}`); }
  const race = validateOfficialRacePayload(payload);
  if (source.external_id !== `race:${race.id}`) throw new Error('source record does not match the official race payload');

  const run = await startImportRun(env, 'official_historical_race_normalize', { sourceRecordId: id, raceId: race.id });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const ctx = {
    sourceRecordId: id,
    observedAt: source.fetched_at,
    counts,
    trackCache: new Map(),
    observedTracks: new Set()
  };
  try {
    if (!officialRaceHasFinalResults(race)) throw new Error('official race results are not final');
    await ensureHistoricalRace(env, race, ctx);
    for (const start of race.starts) await mapHistoricalStart(env, race, start, ctx);
    await env.DB.prepare('UPDATE source_records SET quality_status = ? WHERE id = ?').bind(NORMALIZED_QUALITY, id).run();
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: id,
      raceId: race.id,
      entryCount: race.starts.length,
      resultCount: race.starts.filter((start) => start.result && typeof start.result === 'object').length,
      scratchedCount: race.starts.filter((start) => start.scratched === true).length,
      qualityStatus: NORMALIZED_QUALITY,
      done: true,
      reused: false
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
