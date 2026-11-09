import test from 'node:test';
import assert from 'node:assert/strict';
import { handleScheduled } from '../src/index.js';
import { ESSENTIAL_MORNING_STAGES } from '../src/workflow-health.js';
import { createTestEnv } from './helpers/d1.js';

const DAY = '2099-01-15';
const PRIMARY = { cron:'15 5 * * *', scheduledTime:Date.parse(DAY+'T05:15:00.000Z') };
const RECOVERY = { cron:'45 5 * * *', scheduledTime:Date.parse(DAY+'T05:45:00.000Z') };

test('recovery without a primary checkpoint is read-only and does not invent a run', async () => {
  const { env, db } = createTestEnv();
  const result = await handleScheduled(RECOVERY, env);
  assert.deepEqual(result, { skipped:true, reason:'no_morning_checkpoint' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_runs WHERE source_type='scheduled_orchestrator'").get().n, 0);
});

test('recovery of a completed primary run never starts provider or D1 import work', async () => {
  const { env, db } = createTestEnv();
  const parts = ESSENTIAL_MORNING_STAGES.map(name => ({ name, ok:true, skipped:false }));
  db.prepare(`
    INSERT INTO import_runs (id,source_type,started_at,finished_at,status,metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, ?, 'success', ?)
  `).run('cron_20990115',DAY+'T05:15:00.000Z',DAY+'T05:20:00.000Z',JSON.stringify({
    cron:PRIMARY.cron,scheduledAt:DAY+'T05:15:00.000Z',
    checkpointAt:DAY+'T05:20:00.000Z',parts
  }));

  const retry = await handleScheduled(RECOVERY, env);
  assert.deepEqual(retry, { skipped:true, reason:'morning_essentials_complete' });
  const duplicate = await handleScheduled(PRIMARY, env);
  assert.deepEqual(duplicate, { skipped:true, reason:'morning_already_started' });
  const rows = db.prepare("SELECT status,metadata_json FROM import_runs WHERE id='cron_20990115'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status,'success');
  assert.equal(JSON.parse(rows[0].metadata_json).parts.length, ESSENTIAL_MORNING_STAGES.length);
});
