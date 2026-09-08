import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';
import { normalizeCapturedXlabsRace } from './xlabs-telemetry.js';
import { captureXlabsDate, validateXlabsDate } from '../provider/xlabs.js';
import { captureReferencedXlabsScript } from '../provider/xlabs-script.js';
import { captureXlabsRaceJson } from '../provider/xlabs-race.js';

const BACKFILL_VERSION = 'xlabs-race-v1';
const MAX_RANGE_DAYS = 1096;
const NORMALIZED_QUALITY = 'normalized_verified_subset';

function addDays(date, days) {
  const value = new Date(`${validateXlabsDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(startDate, endDate) {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function validateRange(startDate, endDate) {
  const start = validateXlabsDate(startDate);
  const end = validateXlabsDate(endDate);
  const days = inclusiveDays(start, end);
  if (days < 1 || days > MAX_RANGE_DAYS) throw new Error(`X-Labs historical range must contain between 1 and ${MAX_RANGE_DAYS} days`);
  return { start, end, days };
}

async function loadJob(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('job_id is required');
  return env.DB.prepare('SELECT * FROM xlabs_backfill_jobs WHERE id = ? LIMIT 1').bind(id).first();
}

export async function getXlabsBackfill(env, jobId) {
  const row = await loadJob(env, jobId);
  if (!row) throw new Error('X-Labs backfill job was not found');
  const { lease_token: _leaseToken, ...visible } = row;
  return visible;
}

export async function startXlabsBackfill(env, startDate, endDate, { resume = false } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const range = validateRange(startDate, endDate);
  const id = stableId('xlabsbackfill', BACKFILL_VERSION, range.start, range.end);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO xlabs_backfill_jobs (id, start_date, end_date, next_date, status)
    VALUES (?, ?, ?, ?, 'running')
  `).bind(id, range.start, range.end, range.end).run();
  if (resume) {
    await env.DB.prepare(`
      UPDATE xlabs_backfill_jobs
      SET status = CASE WHEN next_date >= start_date THEN 'running' ELSE status END,
          consecutive_errors = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'failed'
    `).bind(id).run();
  }
  return getXlabsBackfill(env, id);
}

export async function ensureDailyXlabsJob(env, scheduledTime = Date.now()) {
  const instant = new Date(scheduledTime);
  if (Number.isNaN(instant.getTime())) throw new Error('scheduled time is invalid');
  const yesterday = addDays(instant.toISOString().slice(0, 10), -1);
  return startXlabsBackfill(env, yesterday, yesterday);
}

async function acquireLease(env, job) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 4 * 60_000).toISOString();
  const result = await env.DB.prepare(`
    UPDATE xlabs_backfill_jobs
    SET lease_token = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until < ?)
  `).bind(token, leaseUntil, job.id, now).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function advanceDate(env, job, leaseToken, { unavailableDate = false } = {}) {
  const next = addDays(job.next_date, -1);
  const completed = next < job.start_date;
  const result = await env.DB.prepare(`
    UPDATE xlabs_backfill_jobs
    SET next_date = ?, next_race_index = 0, processed_dates = processed_dates + 1,
        unavailable_dates = unavailable_dates + ?, status = ?, consecutive_errors = 0,
        last_error = NULL, last_run_at = ?, lease_token = NULL, lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?
  `).bind(next, Number(unavailableDate), completed ? 'completed' : 'running', new Date().toISOString(), job.id, leaseToken).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('X-Labs backfill lease was lost while advancing date');
  return completed;
}

async function racesForDate(env, date) {
  const { results } = await env.DB.prepare(`
    SELECT r.id AS race_id, tx.external_id AS track_id, r.race_number
    FROM races r
    JOIN tracks t ON t.id = r.track_id
    JOIN track_external_ids tx ON tx.track_id = r.track_id
    WHERE r.race_date = ?
      AND t.country_code = 'SE'
      AND tx.source_type = 'official'
      AND r.race_number IS NOT NULL
      AND EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id = r.id)
    ORDER BY CAST(tx.external_id AS INTEGER), r.race_number, r.id
  `).bind(date).all();
  return results.filter((row) => {
    const trackId = Number(row.track_id);
    const raceNumber = Number(row.race_number);
    return Number.isInteger(trackId) && trackId >= 1 && trackId <= 99 &&
      Number.isInteger(raceNumber) && raceNumber >= 1 && raceNumber <= 99;
  });
}

async function latestSource(env, sourceType, externalId) {
  return env.DB.prepare(`
    SELECT id, quality_status, raw_object_key, metadata_json, fetched_at
    FROM source_records
    WHERE source_type = ? AND external_id = ? AND raw_object_key IS NOT NULL
    ORDER BY CASE quality_status WHEN 'normalized_verified_subset' THEN 0 ELSE 1 END, fetched_at DESC, id DESC
    LIMIT 1
  `).bind(sourceType, externalId).first();
}

async function ensureDateContext(env, date, options, counts) {
  let parent = await latestSource(env, 'xlabs', `date:${date}`);
  if (!parent) {
    try {
      const captured = await captureXlabsDate(env, date, { fetchImpl: options.dateFetchImpl ?? options.fetchImpl });
      parent = { id: captured.sourceRecordId };
      counts.inserted += Number(!captured.reused);
      counts.skipped += Number(captured.reused);
    } catch (error) {
      if (error?.code === 'XLABS_NOT_FOUND') return { unavailable: true };
      throw error;
    }
  } else counts.skipped += 1;

  const captures = {};
  for (const scriptName of ['calculate.js', 'main.js']) {
    let script = await latestSource(env, 'xlabs_script', `${parent.id}:${scriptName}`);
    if (!script) {
      const captured = await captureReferencedXlabsScript(env, parent.id, scriptName, {
        fetchImpl: options.scriptFetchImpl ?? options.fetchImpl
      });
      script = { id: captured.sourceRecordId };
      counts.inserted += Number(!captured.reused);
      counts.skipped += Number(captured.reused);
    } else counts.skipped += 1;
    captures[scriptName] = script;
  }
  return { unavailable: false, calculateSourceRecordId: captures['calculate.js'].id };
}

async function sourceForRace(env, date, trackId, raceNumber) {
  return latestSource(env, 'xlabs_race_json', `${date}:${trackId}:${raceNumber}`);
}

async function recordUnavailableRace(env, job, leaseToken) {
  const nextIndex = job.next_race_index + 1;
  const result = await env.DB.prepare(`
    UPDATE xlabs_backfill_jobs
    SET next_race_index = ?, processed_races = processed_races + 1,
        unavailable_races = unavailable_races + 1, consecutive_errors = 0,
        last_error = NULL, last_run_at = ?, lease_token = NULL, lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?
  `).bind(nextIndex, new Date().toISOString(), job.id, leaseToken).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('X-Labs backfill lease was lost while recording unavailable race');
  return nextIndex;
}

async function recordCompletedRace(env, job, leaseToken, reused) {
  const nextIndex = job.next_race_index + 1;
  const result = await env.DB.prepare(`
    UPDATE xlabs_backfill_jobs
    SET next_race_index = ?, processed_races = processed_races + 1,
        reused_races = reused_races + ?, consecutive_errors = 0,
        last_error = NULL, last_run_at = ?, lease_token = NULL, lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?
  `).bind(nextIndex, Number(reused), new Date().toISOString(), job.id, leaseToken).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('X-Labs backfill lease was lost before checkpoint update');
  return nextIndex;
}

export async function runXlabsBackfillStep(env, jobId = null, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  const job = jobId
    ? await loadJob(env, jobId)
    : await env.DB.prepare(`
        SELECT * FROM xlabs_backfill_jobs
        WHERE status = 'running'
        ORDER BY CASE WHEN start_date = end_date THEN 0 ELSE 1 END, created_at
        LIMIT 1
      `).first();
  if (!job) return { status: 'idle', done: true };
  if (job.status !== 'running') return { jobId: job.id, status: job.status, done: job.status === 'completed', reused: true };
  const leaseToken = await acquireLease(env, job);
  if (!leaseToken) return { jobId: job.id, status: 'busy', done: false, reused: true };

  const run = await startImportRun(env, 'xlabs_historical_backfill_step', {
    jobId: job.id, date: job.next_date, raceIndex: job.next_race_index, direction: 'newest_first', version: BACKFILL_VERSION
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const races = await racesForDate(env, job.next_date);
    if (races.length === 0 || job.next_race_index >= races.length) {
      const completed = await advanceDate(env, job, leaseToken);
      await finishImportRun(env, run.id, counts);
      return {
        importRunId: run.id,
        jobId: job.id,
        status: completed ? 'completed' : 'running',
        advancedDate: job.next_date,
        done: completed
      };
    }

    const context = await ensureDateContext(env, job.next_date, options, counts);
    if (context.unavailable) {
      const completed = await advanceDate(env, job, leaseToken, { unavailableDate: true });
      await finishImportRun(env, run.id, counts);
      return {
        importRunId: run.id,
        jobId: job.id,
        status: completed ? 'completed' : 'running',
        unavailableDate: job.next_date,
        done: completed
      };
    }

    const race = races[job.next_race_index];
    const trackId = Number(race.track_id);
    const raceNumber = Number(race.race_number);
    let source = await sourceForRace(env, job.next_date, trackId, raceNumber);
    let reused = Boolean(source?.quality_status === NORMALIZED_QUALITY);

    if (!source) {
      try {
        const captured = await captureXlabsRaceJson(env, context.calculateSourceRecordId, trackId, raceNumber, {
          fetchImpl: options.raceFetchImpl ?? options.fetchImpl,
          timeoutMs: options.timeoutMs
        });
        source = { id: captured.sourceRecordId, quality_status: captured.qualityStatus };
        counts.inserted += Number(!captured.reused);
        counts.skipped += Number(captured.reused);
      } catch (error) {
        if (error?.code === 'XLABS_NOT_FOUND') {
          const nextIndex = await recordUnavailableRace(env, job, leaseToken);
          await finishImportRun(env, run.id, counts);
          return {
            importRunId: run.id,
            jobId: job.id,
            status: 'running',
            checkpoint: { date: job.next_date, nextRaceIndex: nextIndex },
            raceId: race.race_id,
            unavailableRace: true,
            done: false
          };
        }
        throw error;
      }
    }

    if (source.quality_status !== NORMALIZED_QUALITY) {
      const normalized = await normalizeCapturedXlabsRace(env, source.id);
      counts.updated += 1;
      reused = normalized.counts.inserted === 0;
    } else counts.skipped += 1;

    const nextIndex = await recordCompletedRace(env, job, leaseToken, reused);
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      jobId: job.id,
      status: 'running',
      checkpoint: { date: job.next_date, nextRaceIndex: nextIndex },
      raceId: race.race_id,
      sourceRecordId: source.id,
      reused,
      done: false
    };
  } catch (error) {
    counts.errors = 1;
    await env.DB.prepare(`
      UPDATE xlabs_backfill_jobs
      SET consecutive_errors = consecutive_errors + 1,
          status = CASE WHEN consecutive_errors + 1 >= 3 THEN 'failed' ELSE 'running' END,
          last_error = ?, last_run_at = ?, lease_token = NULL, lease_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND lease_token = ?
    `).bind(String(error.message).slice(0, 1000), new Date().toISOString(), job.id, leaseToken).run();
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
