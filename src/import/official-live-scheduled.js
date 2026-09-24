import { captureCalendar, captureGame, validateIsoDate } from '../provider/official.js';
import { normalizeCapturedOfficialGameSequential } from './official-live-sequential.js';
import { markOfficialRaceSourceGap, officialGameSourceGap } from './official-source-gap.js';
import { finishImportRun, startImportRun } from './common.js';

const GAME_TYPES = ['V85', 'V86'];
const DEFAULT_DAYS_AHEAD = 7;
const SOURCE_TYPE = 'official_provider';
const PENDING_QUALITY = 'captured_unmapped';
const AUTO_NORMALIZE_SOURCE_TYPE = 'official_live_normalize_auto';
const MAX_AUTO_NORMALIZE_FAILURES = 3;
const DEFAULT_NORMALIZE_STEPS_PER_RUN = 8;
const MAX_NORMALIZE_STEPS_PER_RUN = 12;

function dateFromInstant(value) {
  const instant = new Date(value ?? Date.now());
  if (Number.isNaN(instant.getTime())) throw new Error('scheduled time is invalid');
  return instant.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${validateIsoDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function scheduledLiveDates(scheduledTime, { includeToday = true, daysAhead = DEFAULT_DAYS_AHEAD } = {}) {
  const horizon = Number(daysAhead);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 14) throw new Error('daysAhead must be between 1 and 14');
  const today = dateFromInstant(scheduledTime);
  const firstOffset = includeToday ? 0 : 1;
  const dates = [];
  for (let offset = firstOffset; offset <= horizon; offset += 1) dates.push(addDays(today, offset));
  return dates;
}

export function v85V86GameIdsFromCalendar(payload, expectedDate) {
  const date = validateIsoDate(expectedDate);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.date !== date) {
    throw new Error('official calendar payload does not match the scheduled date');
  }
  if (!payload.games || typeof payload.games !== 'object' || Array.isArray(payload.games)) {
    throw new Error('official calendar payload games must be an object');
  }

  const ids = [];
  const seen = new Set();
  for (const gameType of GAME_TYPES) {
    const games = payload.games[gameType];
    if (games == null) continue;
    if (!Array.isArray(games)) throw new Error(`official calendar ${gameType} games must be an array`);
    for (const game of games) {
      const id = typeof game?.id === 'string' ? game.id.trim() : '';
      const unpublishedScheduled = game?.status === 'scheduled' && !id && Array.isArray(game.races) && game.races.length === 0;
      if (unpublishedScheduled) continue;
      if (!new RegExp(`^${gameType}_${date}_[A-Za-z0-9_-]+$`).test(id)) {
        throw new Error(`official calendar ${gameType} game id does not match the scheduled date`);
      }
      if (!Array.isArray(game.races) || game.races.length !== 8 || game.races.some((raceId) => typeof raceId !== 'string' || !raceId.startsWith(`${date}_`))) {
        throw new Error(`official calendar ${gameType} game must contain exactly eight same-date race ids`);
      }
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

async function loadJsonObject(env, objectKey, label) {
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const object = await env.RAW_BUCKET.get(objectKey);
  if (!object) throw new Error(`${label} raw object was not found`);
  let payload;
  try { payload = JSON.parse(await object.text()); } catch { throw new Error(`${label} raw object is invalid JSON`); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${label} payload must be an object`);
  return payload;
}

export async function captureUpcomingOfficialGames(env, scheduledTime, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  const includeToday = options.includeToday !== false;
  const dates = scheduledLiveDates(scheduledTime, { includeToday, daysAhead: options.daysAhead ?? DEFAULT_DAYS_AHEAD });
  const run = await startImportRun(env, 'official_live_scheduled_capture', {
    mode: includeToday ? 'morning' : 'evening',
    dates
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const capturedGameIds = [];
  const failures = [];

  for (const date of dates) {
    try {
      const calendar = await captureCalendar(env, date, { fetchImpl: options.fetchImpl });
      counts.inserted += Number(!calendar.reused);
      counts.skipped += Number(calendar.reused);
      const payload = await loadJsonObject(env, calendar.rawObjectKey, 'official calendar');
      const gameIds = v85V86GameIdsFromCalendar(payload, date);
      for (const gameId of gameIds) {
        try {
          const game = await captureGame(env, gameId, { fetchImpl: options.fetchImpl });
          counts.inserted += Number(!game.reused);
          counts.skipped += Number(game.reused);
          capturedGameIds.push(gameId);
        } catch (error) {
          counts.errors += 1;
          failures.push({ date, gameId, message: String(error.message).slice(0, 300) });
        }
      }
    } catch (error) {
      counts.errors += 1;
      failures.push({ date, message: String(error.message).slice(0, 300) });
    }
  }

  const aggregateError = failures.length ? new Error(`${failures.length} scheduled live capture operation(s) failed`) : null;
  await finishImportRun(env, run.id, counts, aggregateError);
  if (aggregateError) throw aggregateError;
  return {
    importRunId: run.id,
    mode: includeToday ? 'morning' : 'evening',
    dates,
    capturedGameIds,
    failureCount: 0,
    failures: []
  };
}

export async function completedNormalizationCursor(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  const sourceId = String(sourceRecordId || '').trim();
  if (!sourceId) throw new Error('source_record_id is required');
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT CAST(json_extract(metadata_json, '$.cursor') AS INTEGER) AS cursor
    FROM import_runs
    WHERE source_type = 'official_provider_normalize'
      AND status = 'success'
      AND json_extract(metadata_json, '$.stage') = 'entry'
      AND json_extract(metadata_json, '$.sourceRecordId') = ?
    ORDER BY cursor
  `).bind(sourceId).all();

  for (let index = 0; index < results.length; index += 1) {
    if (Number(results[index].cursor) !== index) {
      throw new Error('stored live normalization checkpoints are not contiguous');
    }
  }
  return results.length;
}

function failedRunMessage(errorJson) {
  try {
    const parsed = errorJson ? JSON.parse(errorJson) : null;
    return typeof parsed?.message === 'string' ? parsed.message : null;
  } catch {
    return null;
  }
}

async function selectExhaustedKnownSourceGap(env) {
  const { results } = await env.DB.prepare(`
    SELECT sr.id, sr.external_id, sr.fetched_at,
      (
        SELECT ir.error_json
        FROM import_runs ir
        WHERE ir.source_type = ?
          AND ir.status = 'failed'
          AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
        ORDER BY ir.started_at DESC, ir.id DESC
        LIMIT 1
      ) AS last_error_json
    FROM source_records sr
    WHERE sr.source_type = ? AND (sr.quality_status = ? OR (sr.quality_status = 'captured_source_gap' AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'))
      AND COALESCE(json_extract(sr.metadata_json, '$.normalizationOwner'),'') <> 'post_race_settlement_final'
      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')
      AND (
        SELECT COUNT(*)
        FROM import_runs ir
        WHERE ir.source_type = ?
          AND ir.status = 'failed'
          AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
      ) >= ?
    ORDER BY sr.fetched_at, sr.id
    LIMIT 20
  `).bind(AUTO_NORMALIZE_SOURCE_TYPE, SOURCE_TYPE, PENDING_QUALITY, AUTO_NORMALIZE_SOURCE_TYPE, MAX_AUTO_NORMALIZE_FAILURES).all();

  for (const row of results) {
    const message = failedRunMessage(row.last_error_json);
    if (message && /^races\[\d+\]\.starts\[\d+\]\.horse\.id is required$/.test(message)) {
      const { last_error_json: _lastError, ...source } = row;
      return source;
    }
  }
  return null;
}

export async function selectPendingOfficialGameSource(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const pending = await env.DB.prepare(`
    SELECT sr.id, sr.external_id, sr.fetched_at
    FROM source_records sr
    WHERE sr.source_type = ? AND (sr.quality_status = ? OR (sr.quality_status = 'captured_source_gap' AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'))
      AND COALESCE(json_extract(sr.metadata_json, '$.normalizationOwner'),'') <> 'post_race_settlement_final'
      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')
      AND NOT EXISTS (
        SELECT 1
        FROM source_records newer
        WHERE newer.source_type = sr.source_type
          AND newer.external_id = sr.external_id
          AND COALESCE(json_extract(newer.metadata_json, '$.normalizationOwner'),'') <> 'post_race_settlement_final'
          AND (
            newer.fetched_at > sr.fetched_at
            OR (newer.fetched_at = sr.fetched_at AND newer.id > sr.id)
          )
      )
      AND (
        sr.quality_status = 'captured_source_gap'
        OR (
          SELECT COUNT(*)
          FROM import_runs ir
          WHERE ir.source_type = ?
            AND ir.status = 'failed'
            AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
        ) < ?
      )
    ORDER BY
      CASE WHEN substr(sr.external_id, 10, 10) >= date('now') THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM game_rounds gr WHERE gr.id = substr(sr.external_id, 6)
      ) THEN 1 ELSE 0 END,
      CASE WHEN substr(sr.external_id, 10, 10) >= date('now') THEN substr(sr.external_id, 10, 10) END ASC,
      CASE WHEN substr(sr.external_id, 10, 10) < date('now') THEN substr(sr.external_id, 10, 10) END DESC,
      sr.fetched_at DESC,
      sr.id DESC
    LIMIT 1
  `).bind(SOURCE_TYPE, PENDING_QUALITY, AUTO_NORMALIZE_SOURCE_TYPE, MAX_AUTO_NORMALIZE_FAILURES).first();
  return pending || selectExhaustedKnownSourceGap(env);
}

function normalizeStepLimit(value) {
  const limit = value == null ? DEFAULT_NORMALIZE_STEPS_PER_RUN : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NORMALIZE_STEPS_PER_RUN) {
    throw new Error(`maxSteps must be between 1 and ${MAX_NORMALIZE_STEPS_PER_RUN}`);
  }
  return limit;
}

export async function normalizeNextPendingOfficialGame(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const source = await selectPendingOfficialGameSource(env);
  if (!source) return { status: 'idle', done: true };

  const maxSteps = normalizeStepLimit(options.maxSteps);
  const initialCursor = await completedNormalizationCursor(env, source.id);
  let cursor = initialCursor;
  let normalized = null;
  let steps = 0;

  while (steps < maxSteps) {
    const run = await startImportRun(env, AUTO_NORMALIZE_SOURCE_TYPE, {
      sourceRecordId: source.id,
      externalId: source.external_id,
      cursor
    });
    const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
    try {
      normalized = await normalizeCapturedOfficialGameSequential(env, source.id, cursor);
      await finishImportRun(env, run.id, counts);
      steps += 1;

      if (normalized.done === true) {
        return {
          status: 'completed_source',
          done: true,
          sourceRecordId: source.id,
          externalId: source.external_id,
          fetchedAt: source.fetched_at,
          cursor: initialCursor,
          nextCursor: null,
          steps,
          normalized
        };
      }

      const nextCursor = Number(normalized.nextCursor);
      if (!Number.isInteger(nextCursor) || nextCursor <= cursor) {
        throw new Error('live normalization did not advance its cursor');
      }
      cursor = nextCursor;
    } catch (error) {
      const gap = officialGameSourceGap(error);
      if (gap && cursor === 0) {
        const sourceGap = await markOfficialRaceSourceGap(env, source.id, gap);
        counts.skipped = 1;
        await finishImportRun(env, run.id, counts);
        return {
          status: 'source_gap',
          done: true,
          sourceRecordId: source.id,
          externalId: source.external_id,
          fetchedAt: source.fetched_at,
          cursor: initialCursor,
          nextCursor: null,
          steps,
          sourceGap
        };
      }
      counts.errors = 1;
      await finishImportRun(env, run.id, counts, error);
      throw error;
    }
  }

  return {
    status: 'running_source',
    done: false,
    sourceRecordId: source.id,
    externalId: source.external_id,
    fetchedAt: source.fetched_at,
    cursor: initialCursor,
    nextCursor: cursor,
    steps,
    normalized
  };
}
