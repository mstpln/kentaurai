import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  ensureDailyXlabsJob,
  ensureXlabsDailyDateJob,
  runXlabsBackfillBatch,
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

  const batch = await runXlabsBackfillBatch(env);
  assert.equal(batch.stepCount, 1);
  const first = batch.results[0];
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


test('exact-date X-Labs recovery reopens a completed daily job when a newly settled saved round adds eligible races', async () => {
  const { env, db } = createTestEnv();
  const date='2099-01-05';
  const round='V85_2099-01-05_7_1';
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('xtrack','X Park','SE')").run();
  db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES ('xtrack','official','7')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES (?,'V85',?)").run(round,date);
  db.prepare("INSERT INTO systems (id,game_round_id,system_type,budget_sek,row_count,spike_count,created_at) VALUES ('xsys',?,'main',200,1,3,?)").run(round,date+'T10:00:00Z');
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('xh','X Horse')").run();
  for(let leg=1;leg<=8;leg++){
    const raceId=date+'_7_'+leg;
    const entryId='xe'+leg;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES (?,'xtrack',?,?)").run(raceId,date,leg);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)").run(round,leg,raceId);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES (?,?, 'xh',1)").run(entryId,raceId);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status) VALUES (?,1,'official')").run(entryId);
  }
  const first=await ensureXlabsDailyDateJob(env,date);
  db.prepare("UPDATE xlabs_backfill_jobs SET status='completed',next_date='2099-01-04',processed_races=0 WHERE id=?").run(first.id);
  const reopened=await ensureXlabsDailyDateJob(env,date);
  assert.equal(reopened.status,'running');
  assert.equal(reopened.next_date,date);
  assert.equal(reopened.next_race_index,0);
});
