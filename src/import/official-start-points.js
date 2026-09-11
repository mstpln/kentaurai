import { stableId } from '../ids.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';

export function verifiedOfficialStartPoints(horse) {
  const value = horse?.statistics?.life?.startPoints;
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('official horse statistics.life.startPoints must be a non-negative integer when present');
  }
  return value;
}

function raceBlocks(payload) {
  if (Array.isArray(payload?.races)) {
    return payload.races.map((race) => ({
      raceExternalId: race?.id == null ? null : String(race.id).trim() || null,
      starts: Array.isArray(race?.starts) ? race.starts : []
    }));
  }
  return [{
    raceExternalId: payload?.id == null ? null : String(payload.id).trim() || null,
    starts: Array.isArray(payload?.starts) ? payload.starts : []
  }];
}

function collectHorseStartPoints(payload) {
  const observations = new Map();
  for (const block of raceBlocks(payload)) {
    for (const start of block.starts) {
      const horse = start?.horse;
      if (!horse || horse.id == null) continue;
      const points = verifiedOfficialStartPoints(horse);
      if (points == null) continue;
      const externalHorseId = String(horse.id).trim();
      if (!externalHorseId) continue;
      const prior = observations.get(externalHorseId);
      if (prior && prior.points !== points) {
        throw new Error('official source contains conflicting startPoints values for the same horse');
      }
      if (!prior) {
        observations.set(externalHorseId, { points, raceExternalId: block.raceExternalId });
      } else if (prior.raceExternalId !== block.raceExternalId) {
        prior.raceExternalId = null;
      }
    }
  }
  return observations;
}

async function mapHorseId(env, externalHorseId) {
  const row = await env.DB.prepare(`
    SELECT horse_id AS id
    FROM horse_external_ids
    WHERE source_type = ? AND external_id = ?
    LIMIT 1
  `).bind(EXTERNAL_SOURCE, externalHorseId).first();
  return row?.id || null;
}

async function mapRaceEntryId(env, horseId, raceExternalId) {
  if (!raceExternalId) return null;
  const { results } = await env.DB.prepare(`
    SELECT re.id
    FROM race_external_ids rx
    JOIN race_entries re ON re.race_id = rx.race_id
    WHERE rx.source_type = ?
      AND rx.external_id = ?
      AND re.horse_id = ?
    ORDER BY re.id
    LIMIT 2
  `).bind(EXTERNAL_SOURCE, raceExternalId, horseId).all();
  return results?.length === 1 ? results[0].id : null;
}

async function storeObservation(env, source, horseId, points, raceEntryId) {
  const id = stableId('horse-start-points', horseId, source.id);
  await env.DB.prepare(`
    INSERT INTO horse_start_points
      (id, horse_id, points, observed_at, race_entry_id, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(horse_id, source_record_id) DO UPDATE SET
      race_entry_id = COALESCE(horse_start_points.race_entry_id, excluded.race_entry_id)
  `).bind(id, horseId, points, source.fetched_at, raceEntryId, source.id).run();

  await env.DB.prepare(`
    UPDATE horses
    SET current_start_points = ?,
        current_start_points_observed_at = ?,
        current_start_points_source_record_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        current_start_points_observed_at IS NULL
        OR current_start_points_observed_at < ?
        OR (
          current_start_points_observed_at = ?
          AND COALESCE(current_start_points_source_record_id, '') < ?
        )
      )
  `).bind(
    points,
    source.fetched_at,
    source.id,
    horseId,
    source.fetched_at,
    source.fetched_at,
    source.id
  ).run();
}

async function markSource(env, sourceRecordId, status, count, errorMessage = null) {
  await env.DB.prepare(`
    INSERT INTO horse_start_point_source_sync
      (source_record_id, status, horse_observation_count, error_message)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_record_id) DO UPDATE SET
      status = excluded.status,
      horse_observation_count = excluded.horse_observation_count,
      error_message = excluded.error_message,
      processed_at = CURRENT_TIMESTAMP
  `).bind(sourceRecordId, status, count, errorMessage).run();
}

export async function syncHorseStartPointsFromSource(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const source = await env.DB.prepare(`
    SELECT id, source_type, fetched_at, raw_object_key, quality_status
    FROM source_records
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
  if (!source || source.source_type !== SOURCE_TYPE || source.quality_status !== NORMALIZED_QUALITY || !source.raw_object_key) {
    throw new Error('source record is not a normalized official raw capture');
  }

  try {
    const object = await env.RAW_BUCKET.get(source.raw_object_key);
    if (!object) throw new Error('captured raw object was not found');
    let payload;
    try {
      payload = JSON.parse(await object.text());
    } catch (error) {
      throw new Error(`captured raw object is not valid JSON: ${error.message}`);
    }
    const observations = collectHorseStartPoints(payload);
    let stored = 0;
    for (const [externalHorseId, observation] of observations.entries()) {
      const horseId = await mapHorseId(env, externalHorseId);
      if (!horseId) continue;
      const raceEntryId = await mapRaceEntryId(env, horseId, observation.raceExternalId);
      await storeObservation(env, source, horseId, observation.points, raceEntryId);
      stored += 1;
    }
    await markSource(env, id, 'complete', stored);
    return { sourceRecordId: id, status: 'complete', horseObservationCount: stored };
  } catch (error) {
    await markSource(env, id, 'failed', 0, String(error?.message || error).slice(0, 500));
    throw error;
  }
}

export async function syncOnePendingHorseStartPointSource(env) {
  if (!env.DB || !env.RAW_BUCKET?.get) return { status: 'not_configured' };
  const source = await env.DB.prepare(`
    SELECT sr.id
    FROM source_records sr
    LEFT JOIN horse_start_point_source_sync hs ON hs.source_record_id = sr.id
    WHERE sr.source_type = ?
      AND sr.quality_status = ?
      AND sr.raw_object_key IS NOT NULL
      AND hs.source_record_id IS NULL
    ORDER BY sr.fetched_at DESC, sr.id DESC
    LIMIT 1
  `).bind(SOURCE_TYPE, NORMALIZED_QUALITY).first();
  if (!source?.id) return { status: 'idle' };
  try {
    return await syncHorseStartPointsFromSource(env, source.id);
  } catch (error) {
    console.error('horse start-point source sync failed', error);
    return { sourceRecordId: source.id, status: 'failed', message: String(error?.message || error) };
  }
}
