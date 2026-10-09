import { captureCalendar, captureGame, validateIsoDate } from '../provider/official.js';
import { normalizeCapturedOfficialGameSequential } from './official-live-sequential.js';
import { markOfficialRaceSourceGap, officialGameSourceGap } from './official-source-gap.js';
import { finishImportRun, startImportRun } from './common.js';

const GAME_TYPES = ['V85', 'V86'];
const DEFAULT_DAYS_AHEAD = 7;
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

async function legacyNormalizationCursor(env, sourceId) {
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

export async function completedNormalizationCursor(env, sourceRecordId, externalIdValue = null) {
  if (!env.DB) throw new Error('DB is not configured');
  const sourceId = String(sourceRecordId || '').trim();
  if (!sourceId) throw new Error('source_record_id is required');

  const state = await env.DB.prepare(`
    SELECT next_cursor
    FROM official_live_normalization_state
    WHERE source_record_id = ?
    LIMIT 1
  `).bind(sourceId).first();
  if (state) return Number(state.next_cursor || 0);

  // Existing deployments may already have partial progress recorded in import_runs.
  // Validate that legacy audit history once before requiring source metadata so
  // the existing fail-closed contiguous-cursor guard remains authoritative.
  const cursor = await legacyNormalizationCursor(env, sourceId);

  let externalId = String(externalIdValue || '').trim();
  if (!externalId) {
    const source = await env.DB.prepare('SELECT external_id FROM source_records WHERE id = ? LIMIT 1').bind(sourceId).first();
    externalId = String(source?.external_id || '').trim();
  }
  if (!externalId) return cursor;

  await env.DB.prepare(`
    INSERT INTO official_live_normalization_state
      (source_record_id, external_id, next_cursor, status)
    VALUES (?, ?, ?, 'running')
    ON CONFLICT(source_record_id) DO NOTHING
  `).bind(sourceId, externalId, cursor).run();
  return cursor;
}

async function storeNormalizationProgress(env, source, {
  nextCursor,
  totalEntries = null,
  status = 'running',
  error = null
}) {
  const cursor = Number(nextCursor);
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('normalization state cursor is invalid');
  const total = totalEntries == null ? null : Number(totalEntries);
  if (total != null && (!Number.isInteger(total) || total < 0)) throw new Error('normalization state total is invalid');
  await env.DB.prepare(`
    INSERT INTO official_live_normalization_state
      (source_record_id, external_id, next_cursor, total_entries, status, failure_count, last_error)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(source_record_id) DO UPDATE SET
      external_id = excluded.external_id,
      next_cursor = excluded.next_cursor,
      total_entries = COALESCE(excluded.total_entries, official_live_normalization_state.total_entries),
      status = excluded.status,
      failure_count = CASE WHEN excluded.status IN ('running','completed','source_gap') THEN 0 ELSE official_live_normalization_state.failure_count END,
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP
  `).bind(source.id, source.external_id, cursor, total, status, error == null ? null : String(error).slice(0, 500)).run();
}

async function recordNormalizationFailure(env, source, error) {
  await env.DB.prepare(`
    INSERT INTO official_live_normalization_state
      (source_record_id, external_id, next_cursor, status, failure_count, last_error)
    VALUES (?, ?, 0, 'running', 1, ?)
    ON CONFLICT(source_record_id) DO UPDATE SET
      failure_count = official_live_normalization_state.failure_count + 1,
      status = CASE WHEN official_live_normalization_state.failure_count + 1 >= ? THEN 'failed' ELSE 'running' END,
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP
  `).bind(source.id, source.external_id, String(error?.message || error).slice(0, 500), MAX_AUTO_NORMALIZE_FAILURES).run();
}

export async function selectPendingOfficialGameSource(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const pending = await env.DB.prepare(`
    SELECT sr.id, sr.external_id, sr.fetched_at
    FROM source_records sr
    LEFT JOIN official_live_normalization_state ns ON ns.source_record_id = sr.id
    WHERE sr.source_type = 'official_provider'
      AND sr.quality_status IN ('captured_unmapped','captured_source_gap')
      AND (
        sr.quality_status = 'captured_unmapped'
        OR (
          sr.quality_status = 'captured_source_gap'
          AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'
        )
      )
      AND substr(sr.external_id,1,9) IN ('game:V85_','game:V86_')
      AND substr(sr.external_id,10,10) >= date('now','-3 day')
      AND COALESCE(json_extract(sr.metadata_json, '$.normalizationOwner'),'') <> 'post_race_settlement_final'
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
        OR COALESCE(
          ns.failure_count,
          (
            SELECT COUNT(*)
            FROM import_runs ir
            WHERE ir.source_type = 'official_live_normalize_auto'
              AND ir.status = 'failed'
              AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
          ),
          0
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
  `).bind(MAX_AUTO_NORMALIZE_FAILURES).first();
  return pending || null;
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
  const initialCursor = await completedNormalizationCursor(env, source.id, source.external_id);
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
        const totalEntries = Number(normalized.totalEntries ?? cursor);
        await storeNormalizationProgress(env, source, {
          nextCursor: Number.isInteger(totalEntries) && totalEntries >= 0 ? totalEntries : cursor,
          totalEntries: Number.isInteger(totalEntries) && totalEntries >= 0 ? totalEntries : null,
          status: 'completed'
        });
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
      await storeNormalizationProgress(env, source, {
        nextCursor: cursor,
        totalEntries: normalized.totalEntries,
        status: 'running'
      });
    } catch (error) {
      const gap = officialGameSourceGap(error);
      if (gap && cursor === 0) {
        const sourceGap = await markOfficialRaceSourceGap(env, source.id, gap);
        counts.skipped = 1;
        await finishImportRun(env, run.id, counts);
        await storeNormalizationProgress(env, source, { nextCursor: cursor, status: 'source_gap' });
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
      await recordNormalizationFailure(env, source, error);
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
