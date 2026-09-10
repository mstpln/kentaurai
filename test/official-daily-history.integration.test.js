import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  DAILY_OFFICIAL_LOOKBACK_DAYS,
  ensureDailyOfficialHistoryJobs,
  runHistoricalBackfillStep,
  startHistoricalBackfill
} from '../src/import/official-historical-backfill.js';

function emptyCalendarResponse(url) {
  const date = url.split('/').pop();
  return new Response(JSON.stringify({ date, tracks: [], games: {} }), {
    headers: { 'content-type': 'application/json' }
  });
}

test('daily official history ensures three settled UTC dates idempotently', async () => {
  const { env, db } = createTestEnv();
  const first = await ensureDailyOfficialHistoryJobs(env, '2099-04-11T04:30:00Z');
  const second = await ensureDailyOfficialHistoryJobs(env, '2099-04-11T04:30:00Z');

  assert.equal(DAILY_OFFICIAL_LOOKBACK_DAYS, 3);
  assert.equal(first.lookbackDays, 3);
  assert.deepEqual(first.jobs.map((job) => job.start_date), ['2099-04-10', '2099-04-09', '2099-04-08']);
  assert.deepEqual(second.jobs.map((job) => job.id), first.jobs.map((job) => job.id));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM historical_backfill_jobs`).get().n, 3);
});

test('automatic official history processes recent one-day jobs before the long historical backfill', async () => {
  const { env } = createTestEnv();
  const longJob = await startHistoricalBackfill(env, '2099-04-01', '2099-04-07');
  const daily = await ensureDailyOfficialHistoryJobs(env, '2099-04-11T04:30:00Z');
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) return emptyCalendarResponse(url);
    throw new Error(`unexpected URL ${url}`);
  };

  const first = await runHistoricalBackfillStep(env, null, { fetchImpl });
  const second = await runHistoricalBackfillStep(env, null, { fetchImpl });
  const third = await runHistoricalBackfillStep(env, null, { fetchImpl });
  const fourth = await runHistoricalBackfillStep(env, null, { fetchImpl });

  assert.equal(first.jobId, daily.jobs[0].id);
  assert.equal(second.jobId, daily.jobs[1].id);
  assert.equal(third.jobId, daily.jobs[2].id);
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.equal(third.status, 'completed');
  assert.equal(fourth.jobId, longJob.id);
  assert.equal(fourth.status, 'completed');
});

test('04:30 UTC scheduler creates official rolling jobs before the daily X-Labs job', async () => {
  const { env, db } = createTestEnv();
  const queued = [];
  worker.scheduled({ cron: '30 4 * * *', scheduledTime: Date.parse('2099-04-11T04:30:00Z') }, env, {
    waitUntil(promise) { queued.push(promise); }
  });
  await Promise.all(queued);

  const row = db.prepare(`
    SELECT metadata_json
    FROM import_runs
    WHERE source_type = 'scheduled_orchestrator'
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const metadata = JSON.parse(row.metadata_json);
  assert.deepEqual(metadata.parts.map((part) => part.name), [
    'official_daily_history_jobs',
    'xlabs_daily_job'
  ]);
  assert.equal(metadata.parts[0].ok, true);
  assert.equal(metadata.parts[0].result.lookbackDays, 3);
  assert.deepEqual(metadata.parts[0].result.jobs.map((job) => job.start_date), ['2099-04-10', '2099-04-09', '2099-04-08']);
  assert.equal(metadata.parts[1].ok, true);
  assert.equal(metadata.parts[1].result.start_date, '2099-04-10');
});
