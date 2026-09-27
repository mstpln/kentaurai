import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('morning official budget is shared across all recent daily jobs', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function runDailyOfficialIncremental');
  const end = source.indexOf('async function runDailyXlabsIncremental', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /const active = new Set/);
  assert.match(body, /while \(remaining > 0 && active\.size > 0\)/);
  assert.match(body, /for \(const job of jobs\.jobs \|\| \[\]\)/);
  assert.doesNotMatch(body, /for \(const job of jobs\.jobs \|\| \[\]\) \{\s*while \(remaining > 0\)/);
});

test('morning scheduler pins official and X-Labs work to daily job ids only', () => {
  const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(wrangler.triggers?.crons, ['15 5 * * *']);

  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const officialIndex = source.indexOf("official_daily_incremental");
  const settlementIndex = source.indexOf("post_race_settlement");
  const xlabsIndex = source.indexOf("xlabs_daily_incremental");
  assert.ok(officialIndex >= 0);
  assert.ok(settlementIndex > officialIndex);
  assert.ok(xlabsIndex > settlementIndex);
  assert.match(source, /runHistoricalBackfillBatch\(env, job\.id\)/);
  assert.match(source, /runXlabsBackfillBatch\(env, job\.id\)/);
  assert.doesNotMatch(source, /30 4 \* \* \*/);
});
