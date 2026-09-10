import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { ensureDailyXlabsJob, getXlabsBackfill, runXlabsBackfillStep } from '../src/import/xlabs-backfill.js';

test('daily X-Labs waits for a missing official calendar while its target is still yesterday', async () => {
  const { env } = createTestEnv();
  const job = await ensureDailyXlabsJob(env, '2099-01-03T04:30:00Z');
  const result = await runXlabsBackfillStep(env, job.id, { now: '2099-01-03T12:00:00Z' });

  assert.equal(result.status, 'waiting_for_official_live');
  assert.equal(result.reason, 'calendar_missing');
  assert.equal(result.done, false);

  const stored = await getXlabsBackfill(env, job.id);
  assert.equal(stored.status, 'running');
  assert.equal(stored.next_date, '2099-01-02');
  assert.equal(stored.processed_dates, 0);
  assert.equal(stored.unavailable_dates, 0);
});

test('stale daily X-Labs closes without claiming telemetry unavailability when its official prerequisite never arrived', async () => {
  const { env } = createTestEnv();
  const job = await ensureDailyXlabsJob(env, '2099-01-03T04:30:00Z');
  const result = await runXlabsBackfillStep(env, job.id, { now: '2099-01-04T00:01:00Z' });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'calendar_missing');
  assert.equal(result.prerequisiteExpired, true);
  assert.equal(result.done, true);

  const stored = await getXlabsBackfill(env, job.id);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.next_date, '2099-01-01');
  assert.equal(stored.processed_dates, 0);
  assert.equal(stored.processed_races, 0);
  assert.equal(stored.unavailable_dates, 0);
  assert.equal(stored.unavailable_races, 0);
  assert.equal(stored.consecutive_errors, 0);
  assert.equal(stored.last_error, null);
  assert.equal(stored.retry_after, null);
});
