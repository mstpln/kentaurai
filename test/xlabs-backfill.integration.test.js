import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  ensureDailyXlabsJob,
  runXlabsBackfillBatch,
  runXlabsBackfillStep,
  startXlabsBackfill
} from '../src/import/xlabs-backfill.js';

const DATE = '2099-01-02';
const GAME_ID = 'V86_2099-01-02_7_1';

function seedOfficialRace(db, date = DATE) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method)
    VALUES ('race_5','track_7',?,5,1000,'auto')`).run(date);
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Synthetic One'),('horse_2','Synthetic Two')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m)
    VALUES ('entry_1','race_5','horse_1',1,1000),('entry_2','race_5','horse_2',2,1000)`).run();
}

function seedAdditionalOfficialRaces(db, raceNumbers, date = DATE) {
  for (const raceNumber of raceNumbers) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method)
      VALUES (?,'track_7',?,?,1000,'auto')`).run(`race_${raceNumber}`, date, raceNumber);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?,?)`).run(`horse_${raceNumber}`, `Synthetic ${raceNumber}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m)
      VALUES (?,?,?,?,1000)`).run(`entry_${raceNumber}`, `race_${raceNumber}`, `horse_${raceNumber}`, raceNumber);
  }
}

function seedDailyV86OfficialState(db, objects, { gameQuality = 'normalized_verified_subset', includeGame = true } = {}) {
  seedOfficialRace(db);
  for (let raceNumber = 6; raceNumber <= 12; raceNumber += 1) {
    const raceId = `race_${raceNumber}`;
    const horseId = `horse_${raceNumber}`;
    const entryId = `entry_${raceNumber}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method)
      VALUES (?,'track_7',?,?,1000,'auto')`).run(raceId, DATE, raceNumber);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?,?)`).run(horseId, `Synthetic ${raceNumber}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m)
      VALUES (?,?,?,1,1000)`).run(entryId, raceId, horseId);
  }

  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date) VALUES (?,'V86',?)`).run(GAME_ID, DATE);
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)`)
      .run(GAME_ID, leg, `race_${leg + 4}`);
  }

  const calendarKey = 'raw/official_provider/calendar.json';
  const calendarPayload = {
    date: DATE,
    games: {
      V86: [{
        id: GAME_ID,
        races: Array.from({ length: 8 }, (_, index) => `${DATE}_7_${index + 5}`)
      }]
    }
  };
  objects.set(calendarKey, { body: JSON.stringify(calendarPayload), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status)
    VALUES ('src_calendar','official_provider',?,?,'2099-01-03T04:00:00Z',?,'hash_calendar','captured_unmapped')`)
    .run(`calendar:${DATE}`, `https://example.test/calendar/${DATE}`, calendarKey);

  if (includeGame) {
    const gameKey = 'raw/official_provider/game.json';
    objects.set(gameKey, { body: '{}', options: {} });
    db.prepare(`INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status)
      VALUES ('src_game','official_provider',?,?,'2099-01-03T04:01:00Z',?,'hash_game',?)`)
      .run(`game:${GAME_ID}`, `https://example.test/games/${GAME_ID}`, gameKey, gameQuality);
  }
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

function telemetryPayload(raceNumber = 5) {
  return Array.from({ length: 12 }, (_, index) => ({
    trackId: 7,
    raceNumber,
    timestamp: new Date(Date.UTC(2099, 0, 2, 12, 0, index * 10)).toISOString(),
    targets: [
      { number: 1, posX: index * 100, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) },
      { number: 2, posX: index * 101, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) }
    ]
  }));
}

test('daily X-Labs scheduling creates a stable V85/V86-only job for yesterday', async () => {
  const { env } = createTestEnv();
  const first = await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');
  const second = await ensureDailyXlabsJob(env, '2099-01-03T04:30:30.000Z');
  assert.equal(first.id, second.id);
  assert.equal(first.scope, 'daily_v85_v86');
  assert.equal(first.start_date, DATE);
  assert.equal(first.end_date, DATE);
  assert.equal(first.status, 'running');
});

test('daily X-Labs job processes a fully normalized V86 round without waiting for full ordinary-race history', async () => {
  const { env, db, objects } = createTestEnv();
  seedDailyV86OfficialState(db, objects);
  seedXlabsContext(db, objects);
  await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');

  const result = await runXlabsBackfillStep(env, null, {
    raceFetchImpl: async () => new Response(JSON.stringify(telemetryPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });
  assert.equal(result.scope, 'daily_v85_v86');
  assert.equal(result.raceId, 'race_5');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 2);
});

test('daily X-Labs waits for the official V86 game normalization instead of completing a partial day', async () => {
  const { env, db, objects } = createTestEnv();
  seedDailyV86OfficialState(db, objects, { gameQuality: 'captured_unmapped' });
  await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');

  const result = await runXlabsBackfillStep(env);
  assert.equal(result.scope, 'daily_v85_v86');
  assert.equal(result.status, 'waiting_for_official_live');
  assert.equal(result.reason, 'game_normalization_pending');
  assert.equal(result.pendingGameCount, 1);
  assert.ok(result.retryAfter);
  const job = db.prepare(`SELECT next_date,next_race_index,processed_races,retry_after,lease_token FROM xlabs_backfill_jobs`).get();
  assert.equal(job.next_date, DATE);
  assert.equal(job.next_race_index, 0);
  assert.equal(job.processed_races, 0);
  assert.ok(job.retry_after);
  assert.equal(job.lease_token, null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 0);
});

test('daily X-Labs waits when the official calendar exists but the game capture is missing', async () => {
  const { env, db, objects } = createTestEnv();
  seedDailyV86OfficialState(db, objects, { includeGame: false });
  await ensureDailyXlabsJob(env, '2099-01-03T04:30:00.000Z');

  const result = await runXlabsBackfillStep(env);
  assert.equal(result.status, 'waiting_for_official_live');
  assert.equal(result.pendingGameCount, 1);
  assert.equal(db.prepare(`SELECT processed_races FROM xlabs_backfill_jobs`).get().processed_races, 0);
});

test('multi-day X-Labs history waits until official backfill has completed the checkpoint date', async () => {
  const { env, db } = createTestEnv();
  await startXlabsBackfill(env, '2099-01-01', DATE);
  seedOfficialRace(db);
  seedOfficialCoverage(db, { start: '2099-01-01', end: DATE, next: DATE, status: 'running' });

  const result = await runXlabsBackfillStep(env);
  assert.equal(result.scope, 'historical_all');
  assert.equal(result.status, 'waiting_for_official');
  const job = db.prepare(`SELECT next_date,next_race_index,processed_races,consecutive_errors,lease_token,retry_after FROM xlabs_backfill_jobs`).get();
  assert.equal(job.next_date, DATE);
  assert.equal(job.next_race_index, 0);
  assert.equal(job.processed_races, 0);
  assert.equal(job.consecutive_errors, 0);
  assert.equal(job.lease_token, null);
  assert.ok(job.retry_after);
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
  assert.equal(result.scope, 'historical_all');
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

test('404 date pages are neutral missing coverage and complete a ready single-day historical job', async () => {
  const { env, db } = createTestEnv();
  seedOfficialRace(db);
  seedOfficialCoverage(db);
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
  assert.equal(created.scope, 'historical_all');
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

test('X-Labs batch advances only three neutral 404 race checkpoints and reuses date context', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedAdditionalOfficialRaces(db, [6, 7, 8]);
  seedOfficialCoverage(db);
  seedXlabsContext(db, objects);
  await startXlabsBackfill(env, DATE, DATE);
  const requested = [];

  const result = await runXlabsBackfillBatch(env, null, {
    raceFetchImpl: async (url) => {
      requested.push(url.split('/').pop());
      return new Response('missing', { status: 404 });
    }
  });

  assert.equal(result.stepCount, 3);
  assert.deepEqual(requested, ['101020705.json', '101020706.json', '101020707.json']);
  const state = db.prepare(`
    SELECT next_race_index, processed_races, unavailable_races, consecutive_errors
    FROM xlabs_backfill_jobs
  `).get();
  assert.deepEqual({ ...state }, {
    next_race_index: 3,
    processed_races: 3,
    unavailable_races: 3,
    consecutive_errors: 0
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type='xlabs'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type='xlabs_script'`).get().n, 2);
});

test('X-Labs batch preserves the first checkpoint and stops on a second-race upstream failure', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedAdditionalOfficialRaces(db, [6, 7]);
  seedOfficialCoverage(db);
  seedXlabsContext(db, objects);
  await startXlabsBackfill(env, DATE, DATE);
  const requested = [];

  await assert.rejects(
    () => runXlabsBackfillBatch(env, null, {
      raceFetchImpl: async (url) => {
        const raceNumber = Number(url.slice(-7, -5));
        requested.push(raceNumber);
        if (raceNumber === 6) return new Response('temporary failure', { status: 503 });
        return new Response(JSON.stringify(telemetryPayload(raceNumber)), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }),
    (error) => error.code === 'SOURCE_UPSTREAM_ERROR' && error.httpStatus === 503
  );

  assert.deepEqual(requested, [5, 6]);
  const state = db.prepare(`
    SELECT next_race_index, processed_races, consecutive_errors, retry_after, lease_token
    FROM xlabs_backfill_jobs
  `).get();
  assert.equal(state.next_race_index, 1);
  assert.equal(state.processed_races, 1);
  assert.equal(state.consecutive_errors, 1);
  assert.ok(Date.parse(state.retry_after) > Date.now());
  assert.equal(state.lease_token, null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 2);
});
