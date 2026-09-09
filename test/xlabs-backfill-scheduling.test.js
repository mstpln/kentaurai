import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  ensureDailyXlabsJob,
  runXlabsBackfillStep,
  startXlabsBackfill
} from '../src/import/xlabs-backfill.js';

const DATE = '2099-01-02';

test('a deferred daily X-Labs job does not starve a ready historical job', async () => {
  const { env, db } = createTestEnv();
  const daily = await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');
  const historical = await startXlabsBackfill(env, DATE, DATE);
  db.prepare(`INSERT INTO historical_backfill_jobs
    (id,start_date,end_date,next_date,status)
    VALUES ('official_gate',?,?,?,'running')`).run(DATE, DATE, '2099-01-01');

  const first = await runXlabsBackfillStep(env);
  assert.equal(first.jobId, daily.id);
  assert.equal(first.status, 'waiting_for_official_live');
  assert.equal(first.reason, 'calendar_missing');
  assert.ok(first.retryAfter);

  const second = await runXlabsBackfillStep(env);
  assert.equal(second.jobId, historical.id);
  assert.equal(second.scope, 'historical_all');
  assert.equal(second.status, 'completed');
  assert.equal(second.done, true);
});
