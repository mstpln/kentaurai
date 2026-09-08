import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  ensureDailyXlabsJob,
  runXlabsBackfillStep,
  startXlabsBackfill
} from '../src/import/xlabs-backfill.js';

const DATE = '2099-01-02';

function seedOfficialRace(db, date = DATE) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method)
    VALUES ('race_5','track_7',?,5,1000,'auto')`).run(date);
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Synthetic One'),('horse_2','Synthetic Two')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m)
    VALUES ('entry_1','race_5','horse_1',1,1000),('entry_2','race_5','horse_2',2,1000)`).run();
}

function seedOfficialCoverage(db, { start = DATE, end = DATE, next = '2099-01-01', status = 'running' } = {}) {
  db.prepare(`INSERT INTO historical_backfill_jobs
    (id,start_date,end_date,next_date,status)
    VALUES ('official_gate',?,?,?,?)`).run(start, end, next, status);
}

function seedXlabsContext(db, objects, date = DATE) {
  const compact = date.slice(2).replaceAll('-', '');
  const parentKey = `raw/xlabs/${compact}/page.html`;
  objects.set(parentKey, { body: '<html></html>', options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs',?,?,'2099-01-03T00:00:00Z',?,'hash_parent','captured_unmapped','unknown',?)`)
    .run(`date:${date}`, `https://kmtid.atgx.se/${compact}/`, parentKey, JSON.stringify({ kind: 'date_page', date }));

  const calcKey = `raw/xlabs_script/${compact}/calculate.js`;
  objects.set(calcKey, { body: `function parseData(path) { const fileName = '1' + monthString + dayString + trackNumber + raceNumberString + '.json'; $.getJSON(path + fileName); }`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_calc','xlabs_script','src_parent:calculate.js',?,'2099-01-03T00:00:02Z',?,'hash_calc','captured_unmapped','unknown',?)`)
    .run(`https://kmtid.atgx.se/${compact}/js/calculate.js`, calcKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'calculate.js' }));

  const mainKey = `raw/xlabs_script/${compact}/main.js`;
  objects.set(mainKey, { body: `parseData('json/');`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_main','xlabs_script','src_parent:main.js',?,'2099-01-03T00:00:01Z',?,'hash_main','captured_unmapped','unknown',?)`)
    .run(`https://kmtid.atgx.se/${compact}/js/main.js`, mainKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'main.js' }));
}

function telemetryPayload() {
  return Array.from({ length: 12 }, (_, index) => ({
    trackId: 7,
    raceNumber: 5,
    timestamp: new Date(Date.UTC(2099, 0, 2, 12, 0, index * 10)).toISOString(),
    targets: [
      { number: 1, posX: index * 100, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) },
      { number: 2, posX: index * 101, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) }
    ]
  }));
}

test('daily X-Labs scheduling creates a stable job for yesterday', async () => {
  const { env } = createTestEnv();
  const first = await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');
  const second = await ensureDailyXlabsJob(env, '2099-01-03T04:30:30.000Z');
  assert.equal(first.id, second.id);
  assert.equal(first.start_date, DATE);
  assert.equal(first.end_date, DATE);
  assert.equal(first.status, 'running');
});

test('multi-day X-Labs history waits until official backfill has completed the checkpoint date', async () => {
  const { env, db } = createTestEnv();
  await startXlabsBackfill(env, '2099-01-01', DATE);
  seedOfficialRace(db);
  seedOfficialCoverage(db, { start: '2099-01-01', end: DATE, next: DATE, status: 'running' });

  const result = await runXlabsBackfillStep(env);
  assert.equal(result.status, 'waiting_for_official');
  const job = db.prepare(`SELECT next_date,next_race_index,processed_races,consecutive_errors,lease_token FROM xlabs_backfill_jobs`).get();
  assert.equal(job.next_date, DATE);
  assert.equal(job.next_race_index, 0);
  assert.equal(job.processed_races, 0);
  assert.equal(job.consecutive_errors, 0);
  assert.equal(job.lease_token, null);
});

test('captures and normalizes one available X-Labs race from a verified official checkpoint', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedOfficialCoverage(db);
  seedXlabsContext(db, objects);
  await startXlabsBackfill(env, DATE, DATE);

  const result = await runXlabsBackfillStep(env, null, {
    raceFetchImpl: async () => new Response(JSON.stringify(telemetryPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  assert.equal(result.raceId, 'race_5');
  assert.equal(result.checkpoint.nextRaceIndex, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 2);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE source_type='xlabs_race_json'`).get().quality_status, 'normalized_verified_subset');
  const job = db.prepare(`SELECT processed_races,unavailable_races,consecutive_errors FROM xlabs_backfill_jobs`).get();
  assert.equal(job.processed_races, 1);
  assert.equal(job.unavailable_races, 0);
  assert.equal(job.consecutive_errors, 0);
});

test('404 race objects are neutral missing coverage and advance the checkpoint', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedOfficialCoverage(db);
  seedXlabsContext(db, objects);
  await startXlabsBackfill(env, DATE, DATE);

  const result = await runXlabsBackfillStep(env, null, {
    raceFetchImpl: async () => new Response('missing', { status: 404 })
  });

  assert.equal(result.unavailableRace, true);
  assert.equal(result.checkpoint.nextRaceIndex, 1);
  const job = db.prepare(`SELECT processed_races,unavailable_races,consecutive_errors,status FROM xlabs_backfill_jobs`).get();
  assert.equal(job.processed_races, 1);
  assert.equal(job.unavailable_races, 1);
  assert.equal(job.consecutive_errors, 0);
  assert.equal(job.status, 'running');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 0);
});

test('404 date pages are neutral missing coverage and complete a single-day job', async () => {
  const { env, db } = createTestEnv();
  seedOfficialRace(db);
  await startXlabsBackfill(env, DATE, DATE);

  const result = await runXlabsBackfillStep(env, null, {
    dateFetchImpl: async () => new Response('missing', { status: 404 })
  });

  assert.equal(result.unavailableDate, DATE);
  assert.equal(result.status, 'completed');
  assert.equal(result.done, true);
  const job = db.prepare(`SELECT status,processed_dates,unavailable_dates,consecutive_errors FROM xlabs_backfill_jobs`).get();
  assert.equal(job.status, 'completed');
  assert.equal(job.processed_dates, 1);
  assert.equal(job.unavailable_dates, 1);
  assert.equal(job.consecutive_errors, 0);
});

test('X-Labs backfill admin routes require ADMIN_TOKEN and expose stable status', async () => {
  const { env } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  const body = JSON.stringify({ start_date: DATE, end_date: DATE });
  const request = (token = null) => new Request('https://example.test/v1/xlabs/backfill/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body
  });

  let response = await worker.fetch(request(), env);
  assert.equal(response.status, 401);
  response = await worker.fetch(request(env.ADMIN_TOKEN), env);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.start_date, DATE);
  assert.equal(created.end_date, DATE);

  response = await worker.fetch(new Request(`https://example.test/v1/xlabs/backfill/status?job_id=${encodeURIComponent(created.id)}`, {
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` }
  }), env);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.id, created.id);
  assert.equal(status.status, 'running');
});
