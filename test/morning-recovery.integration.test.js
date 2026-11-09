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

test('recovery runs official results and X-Labs before repeating heavy normalization', async () => {
  const { env, db } = createTestEnv();
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0,10);
  const scheduledTime = Date.parse(day+'T05:45:00.000Z');
  const id = 'cron_'+day.replaceAll('-','');
  const primaryStarted = day+'T05:15:00.000Z';
  db.prepare(`
    INSERT INTO import_runs (id,source_type,started_at,status,metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, 'running', ?)
  `).run(id, primaryStarted, JSON.stringify({
    cron:PRIMARY.cron,
    scheduledAt:primaryStarted,
    checkpointAt:primaryStarted,
    parts:[{name:'live_capture_morning',ok:true,skipped:false,cost:{rowsRead:10,rowsWritten:1,durationMs:100}}]
  }));
  const seen = [];
  const actions = Object.fromEntries(ESSENTIAL_MORNING_STAGES.map(name => [
    name,
    async () => { seen.push(name); return {status:'complete'}; }
  ]));
  const result = await handleScheduled({cron:RECOVERY.cron,scheduledTime},env,{stageActions:actions});
  assert.equal(result.skipped,false);
  assert.equal(result.recovery,true);
  assert.deepEqual(seen, [
    'official_daily_incremental',
    'post_race_settlement',
    'manual_system_settlement',
    'xlabs_daily_incremental',
    'live_normalize_morning'
  ]);
  const saved = db.prepare("SELECT status, metadata_json FROM import_runs WHERE id=?").get(id);
  assert.equal(saved.status,'success');
  const metadata = JSON.parse(saved.metadata_json);
  assert.equal(metadata.recoveryAttempted,true);
  assert.equal(metadata.parts.filter(x=>ESSENTIAL_MORNING_STAGES.includes(x.name) && x.ok && !x.skipped).length,6);
  assert.equal(metadata.parts.filter(x=>x.name.startsWith('recent_')).every(x=>x.skipped),true);
  assert.equal(metadata.parts.filter(x=>x.name.startsWith('recent_')).length,2);
});

test('repeated recovery Cron delivery never repeats failed work', async () => {
  const { env, db } = createTestEnv();
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0,10);
  const scheduledTime = Date.parse(day+'T05:45:00.000Z');
  const id = 'cron_'+day.replaceAll('-','');
  const started = day+'T05:15:00.000Z';
  db.prepare(`
    INSERT INTO import_runs (id,source_type,started_at,status,metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, 'running', ?)
  `).run(id, started, JSON.stringify({scheduledAt:started,checkpointAt:started,parts:[]}));
  let attempts=0;
  const actions=Object.fromEntries(ESSENTIAL_MORNING_STAGES.map(name=>[
    name,async()=>{attempts++;if(name==='xlabs_daily_incremental')throw new Error('Synthetic X-Labs blocked');return {done:true}}
  ]));
  const controller={cron:RECOVERY.cron,scheduledTime};
  const first=await handleScheduled(controller,env,{stageActions:actions});
  assert.equal(first.skipped,false);
  assert.equal(first.parts.find(x=>x.name==='xlabs_daily_incremental').ok,false);
  const after=attempts;
  const second=await handleScheduled(controller,env,{stageActions:actions});
  assert.deepEqual(second,{skipped:true,reason:'recovery_already_attempted'});
  assert.equal(attempts,after);
  const saved=db.prepare("SELECT status,error_count,metadata_json FROM import_runs WHERE id=?").get(id);
  assert.equal(saved.status,'failed');
  assert.equal(saved.error_count,1);
  assert.equal(JSON.parse(saved.metadata_json).recoveryAttempted,true);
});
