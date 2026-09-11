import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';
import { normalizeCapturedOfficialRace, officialRaceHasFinalResults } from './official-historical-race.js';
import { recordObservation } from './official-live-chunked.js';
import { markOfficialRaceSourceGap, officialRaceSourceGap } from './official-source-gap.js';
import { captureCalendar, captureRace, validateIsoDate } from '../provider/official.js';
import { sourceFailureRetryDelayMs } from '../provider/source-error.js';

const SOURCE_TYPE = 'official_provider';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const BACKFILL_VERSION = 'official-se-trot-v2';
const MAX_RANGE_DAYS = 1096;
const MAX_EMPTY_DATES_PER_STEP = 14;
const HIGHER_PRIZE_GAME_TYPES = ['V75', 'V85', 'V86'];
export const DAILY_OFFICIAL_LOOKBACK_DAYS = 3;
export const MAX_HISTORICAL_CHECKPOINTS_PER_BATCH = 3;

function addDays(date, days) {
  const value = new Date(`${validateIsoDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(startDate, endDate) {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function validateRange(startDate, endDate) {
  const start = validateIsoDate(startDate);
  const end = validateIsoDate(endDate);
  const days = inclusiveDays(start, end);
  if (days < 1 || days > MAX_RANGE_DAYS) throw new Error(`historical range must contain between 1 and ${MAX_RANGE_DAYS} days`);
  return { start, end, days };
}

async function sourceForIdentity(env, externalId) {
  return env.DB.prepare(`
    SELECT id, fetched_at, raw_object_key, quality_status
    FROM source_records
    WHERE source_type = ? AND external_id = ? AND raw_object_key IS NOT NULL
    ORDER BY CASE quality_status WHEN 'normalized_verified_subset' THEN 0 ELSE 1 END, fetched_at DESC
    LIMIT 1
  `).bind(SOURCE_TYPE, externalId).first();
}

async function loadJsonObject(env, source, label) {
  if (!source?.raw_object_key) throw new Error(`${label} source record was not found`);
  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error(`${label} raw object was not found`);
  let payload;
  try { payload = JSON.parse(await object.text()); } catch (error) { throw new Error(`${label} raw object is invalid JSON: ${error.message}`); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${label} payload must be an object`);
  return payload;
}

function validateCalendar(payload, expectedDate) {
  if (payload.date !== expectedDate || !Array.isArray(payload.tracks)) throw new Error('official calendar payload does not match the checkpoint date');
  return payload;
}

export function swedishTrottingRaceIds(calendar) {
  const ids = [];
  const seen = new Set();
  for (const track of calendar.tracks || []) {
    if (track?.countryCode !== 'SE' || track?.sport !== 'trot' || !Array.isArray(track.races)) continue;
    for (const race of track.races) {
      const id = typeof race?.id === 'string' ? race.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

export function historicalGameTypesForRace(calendar, raceId) {
  const games = calendar?.games;
  if (!games || typeof games !== 'object' || Array.isArray(games)) return [];
  return HIGHER_PRIZE_GAME_TYPES.filter((gameType) => {
    const rounds = games[gameType];
    if (!Array.isArray(rounds)) return false;
    return rounds.some((round) => Array.isArray(round?.races) && round.races.includes(raceId));
  });
}

async function recordHistoricalGameMembership(env, calendarSource, calendar, raceId, counts) {
  const gameTypes = historicalGameTypesForRace(calendar, raceId);
  if (!gameTypes.length) return gameTypes;
  await recordObservation(
    env,
    counts,
    'race',
    raceId,
    calendarSource.id,
    calendarSource.fetched_at,
    { gameTypes },
    NORMALIZED_QUALITY
  );
  return gameTypes;
}

export async function startHistoricalBackfill(env, startDate, endDate, { resume = false } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const range = validateRange(startDate, endDate);
  const id = stableId('backfill', BACKFILL_VERSION, range.start, range.end);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO historical_backfill_jobs (id, start_date, end_date, next_date, status)
    VALUES (?, ?, ?, ?, 'running')
  `).bind(id, range.start, range.end, range.end).run();
  if (resume) {
    await env.DB.prepare(`
      UPDATE historical_backfill_jobs
      SET status = CASE WHEN next_date >= start_date THEN 'running' ELSE status END,
          consecutive_errors = 0, last_error = NULL, lease_token = NULL, lease_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'failed'
    `).bind(id).run();
  }
  return getHistoricalBackfill(env, id);
}

export async function ensureDailyOfficialHistoryJobs(env, scheduledTime = Date.now()) {
  const instant = new Date(scheduledTime);
  if (Number.isNaN(instant.getTime())) throw new Error('scheduled time is invalid');
  const scheduledDate = instant.toISOString().slice(0, 10);
  const jobs = [];
  for (let offset = 1; offset <= DAILY_OFFICIAL_LOOKBACK_DAYS; offset += 1) {
    const date = addDays(scheduledDate, -offset);
    jobs.push(await startHistoricalBackfill(env, date, date));
  }
  return { lookbackDays: DAILY_OFFICIAL_LOOKBACK_DAYS, jobs };
}

async function loadHistoricalBackfill(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('job_id is required');
  return env.DB.prepare('SELECT * FROM historical_backfill_jobs WHERE id = ? LIMIT 1').bind(id).first();
}

export async function getHistoricalBackfill(env, jobId) {
  const row = await loadHistoricalBackfill(env, jobId);
  if (!row) throw new Error('historical backfill job was not found');
  const { lease_token: _leaseToken, ...visible } = row;
  return visible;
}

async function selectAutomaticHistoricalJob(env) {
  return env.DB.prepare(`
    SELECT *
    FROM historical_backfill_jobs
    WHERE status = 'running'
    ORDER BY CASE WHEN start_date = end_date THEN 0 ELSE 1 END,
             CASE WHEN start_date = end_date THEN end_date ELSE NULL END DESC,
             created_at
    LIMIT 1
  `).first();
}

async function acquireLease(env, job) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 4 * 60_000).toISOString();
  const result = await env.DB.prepare(`
    UPDATE historical_backfill_jobs
    SET lease_token = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until < ?)
  `).bind(token, leaseUntil, job.id, now).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function advanceDate(env, job, leaseToken) {
  const next = addDays(job.next_date, -1);
  const completed = next < job.start_date;
  const result = await env.DB.prepare(`
    UPDATE historical_backfill_jobs
    SET next_date = ?, next_race_index = 0, processed_dates = processed_dates + 1,
        status = ?, consecutive_errors = 0, last_error = NULL,
        last_run_at = ?,
        lease_token = CASE WHEN ? = 1 THEN NULL ELSE lease_token END,
        lease_until = CASE WHEN ? = 1 THEN NULL ELSE lease_until END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?
  `).bind(next, completed ? 'completed' : 'running', new Date().toISOString(), Number(completed), Number(completed), job.id, leaseToken).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('historical backfill lease was lost while advancing date');
  return completed;
}

async function checkpointRace(env, job, leaseToken, { reused = false } = {}) {
  const nextIndex = job.next_race_index + 1;
  const checkpoint = await env.DB.prepare(`
    UPDATE historical_backfill_jobs
    SET next_race_index = ?, processed_races = processed_races + 1,
        reused_races = reused_races + ?, consecutive_errors = 0, last_error = NULL,
        last_run_at = ?, lease_token = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?
  `).bind(nextIndex, Number(reused), new Date().toISOString(), job.id, leaseToken).run();
  if (Number(checkpoint.meta?.changes ?? 0) !== 1) throw new Error('historical backfill lease was lost before checkpoint update');
  return nextIndex;
}

async function chooseRaceSource(env, raceId, options, counts) {
  const source = await sourceForIdentity(env, `race:${raceId}`);
  if (source?.quality_status === NORMALIZED_QUALITY) return source;

  if (source) {
    const cachedPayload = await loadJsonObject(env, source, 'official race');
    try {
      if (officialRaceHasFinalResults(cachedPayload)) return source;
    } catch (error) {
      if (!officialRaceSourceGap(error)) throw error;
    }
  }

  const captured = await captureRace(env, raceId, { fetchImpl: options.fetchImpl });
  counts.inserted += Number(!captured.reused);
  counts.skipped += Number(captured.reused);
  return {
    id: captured.sourceRecordId,
    raw_object_key: captured.rawObjectKey,
    quality_status: 'captured_unmapped'
  };
}

export async function runHistoricalBackfillStep(env, jobId = null, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  let job = jobId ? await loadHistoricalBackfill(env, jobId) : await selectAutomaticHistoricalJob(env);
  if (!job) return { status: 'idle', done: true };
  if (job.status !== 'running') return { jobId: job.id, status: job.status, done: job.status === 'completed', reused: true };
  const leaseToken = await acquireLease(env, job);
  if (!leaseToken) return { jobId: job.id, status: 'busy', done: false, reused: true };

  const run = await startImportRun(env, 'official_historical_backfill_step', {
    jobId: job.id, date: job.next_date, raceIndex: job.next_race_index, direction: 'newest_first', version: BACKFILL_VERSION
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    for (let skippedDates = 0; skippedDates < MAX_EMPTY_DATES_PER_STEP; skippedDates += 1) {
      let calendarSource = await sourceForIdentity(env, `calendar:${job.next_date}`);
      if (!calendarSource) {
        const captured = await captureCalendar(env, job.next_date, { fetchImpl: options.fetchImpl });
        calendarSource = { id: captured.sourceRecordId, fetched_at: new Date().toISOString(), raw_object_key: captured.rawObjectKey, quality_status: 'captured_unmapped' };
        counts.inserted += Number(!captured.reused);
        counts.skipped += Number(captured.reused);
      } else {
        counts.skipped += 1;
      }
      const calendar = validateCalendar(await loadJsonObject(env, calendarSource, 'official calendar'), job.next_date);
      const raceIds = swedishTrottingRaceIds(calendar);
      if (job.next_race_index >= raceIds.length) {
        const completed = await advanceDate(env, job, leaseToken);
        if (completed) {
          await finishImportRun(env, run.id, counts);
          return { importRunId: run.id, jobId: job.id, status: 'completed', done: true };
        }
        job = await loadHistoricalBackfill(env, job.id);
        continue;
      }

      const raceId = raceIds[job.next_race_index];
      let raceSource = null;
      try {
        raceSource = await chooseRaceSource(env, raceId, options, counts);
        const normalized = await normalizeCapturedOfficialRace(env, raceSource.id);
        const gameTypes = await recordHistoricalGameMembership(env, calendarSource, calendar, raceId, counts);
        if (normalized.reused) counts.skipped += 1;
        else counts.updated += 1;
        const nextIndex = await checkpointRace(env, job, leaseToken, { reused: normalized.reused });
        await finishImportRun(env, run.id, counts);
        return {
          importRunId: run.id,
          jobId: job.id,
          status: 'running',
          checkpoint: { date: job.next_date, nextRaceIndex: nextIndex },
          raceId,
          gameTypes,
          normalized,
          done: false
        };
      } catch (error) {
        const gap = officialRaceSourceGap(error);
        if (!gap || !raceSource?.id) throw error;
        const sourceGap = await markOfficialRaceSourceGap(env, raceSource.id, gap);
        counts.skipped += 1;
        const nextIndex = await checkpointRace(env, job, leaseToken);
        await finishImportRun(env, run.id, counts);
        return {
          importRunId: run.id,
          jobId: job.id,
          status: 'running',
          checkpoint: { date: job.next_date, nextRaceIndex: nextIndex },
          raceId,
          sourceRecordId: raceSource.id,
          sourceGap,
          normalized: null,
          done: false
        };
      }
    }
    throw new Error(`no Swedish trotting races found within ${MAX_EMPTY_DATES_PER_STEP} checkpoint dates`);
  } catch (error) {
    counts.errors = 1;
    const retryDelayMs = sourceFailureRetryDelayMs(error);
    const retryAt = retryDelayMs == null ? null : new Date(Date.now() + retryDelayMs).toISOString();
    await env.DB.prepare(`
      UPDATE historical_backfill_jobs
      SET consecutive_errors = consecutive_errors + 1,
          status = CASE WHEN consecutive_errors + 1 >= 3 THEN 'failed' ELSE 'running' END,
          last_error = ?, last_run_at = ?, lease_token = NULL, lease_until = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND lease_token = ?
    `).bind(String(error.message).slice(0, 1000), new Date().toISOString(), retryAt, job.id, leaseToken).run();
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}

export async function runHistoricalBackfillBatch(env, jobId = null, options = {}) {
  const step = options.stepImpl || runHistoricalBackfillStep;
  const results = [];
  for (let index = 0; index < MAX_HISTORICAL_CHECKPOINTS_PER_BATCH; index += 1) {
    const result = await step(env, jobId, options);
    results.push(result);
    if (!result || result.done || result.status !== 'running') break;
  }
  const last = results.at(-1) || { status: 'idle', done: true };
  return {
    jobId: last.jobId || jobId || null,
    status: last.status,
    done: Boolean(last.done),
    stepCount: results.length,
    maxCheckpoints: MAX_HISTORICAL_CHECKPOINTS_PER_BATCH,
    results
  };
}