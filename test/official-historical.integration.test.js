import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/index.js';
import { normalizeCapturedOfficialRace, officialRaceHasFinalResults, validateOfficialRacePayload } from '../src/import/official-historical-race.js';
import { runHistoricalBackfillBatch, runHistoricalBackfillStep, startHistoricalBackfill, swedishTrottingRaceIds } from '../src/import/official-historical-backfill.js';

const DATE = '2099-04-10';
const RACE_ID = `${DATE}_7_5`;

function person(id, firstName, lastName) {
  return { id, firstName, lastName, homeTrack: { id: 7, name: 'Synthetic Park' } };
}

function racePayload(date = DATE, raceNumber = 5) {
  const raceId = `${date}_7_${raceNumber}`;
  return {
    id: raceId,
    name: 'Synthetic ordinary race',
    date,
    number: raceNumber,
    distance: 2140,
    startMethod: 'auto',
    startTime: `${date}T15:00:20`,
    scheduledStartTime: `${date}T15:00:00`,
    status: 'results',
    track: { id: 7, name: 'Synthetic Park', countryCode: 'SE', sportSystemCode: 'S' },
    starts: [
      {
        id: `${raceId}_1`,
        number: 1,
        postPosition: 1,
        distance: 2140,
        horse: {
          id: 7001,
          name: 'Synthetic Winner',
          age: 5,
          sex: 'mare',
          money: 123400,
          trainer: person(9001, 'Tina', 'Trainer'),
          homeTrack: { id: 7, name: 'Synthetic Park' },
          shoes: { reported: true, front: { hasShoe: false, changed: false }, back: { hasShoe: true, changed: false } },
          sulky: { reported: true, type: { code: 'AM', text: 'American', changed: false } }
        },
        driver: person(8001, 'Dora', 'Driver'),
        result: {
          place: 1,
          finishOrder: 1,
          kmTime: { minutes: 1, seconds: 11, tenths: 2 },
          prizeMoney: 100000,
          finalOdds: 2.07,
          startNumber: 1
        }
      },
      {
        id: `${raceId}_8`,
        number: 8,
        scratched: true,
        postPosition: 8,
        distance: 2140,
        horse: { id: 7008, name: 'Synthetic Scratched', trainer: person(9002, 'Sam', 'Trainer') },
        driver: person(8002, 'Dana', 'Driver'),
        result: { finalOdds: 0, finishOrder: 58, startNumber: 8 }
      }
    ]
  };
}

function calendarPayload(date = DATE, raceNumbers = [5]) {
  return {
    date,
    tracks: [
      {
        id: 7,
        name: 'Synthetic Park',
        countryCode: 'SE',
        sport: 'trot',
        races: raceNumbers.map((raceNumber) => ({ id: `${date}_7_${raceNumber}`, number: raceNumber }))
      },
      { id: 45, name: 'Synthetic Gallop', countryCode: 'SE', sport: 'gallop', races: [{ id: `${date}_45_1` }] },
      { id: 96, name: 'Synthetic Foreign', countryCode: 'NO', sport: 'trot', races: [{ id: `${date}_96_1` }] }
    ],
    games: {}
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function seedRaceSource(db, objects, id = 'src_historical', payload = racePayload()) {
  const key = `raw/official_provider/${id}.json`;
  objects.set(key, { body: JSON.stringify(payload), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status)
    VALUES (?, 'official_provider', ?, ?, ?, ?, ?, 'captured_unmapped')`)
    .run(id, `race:${payload.id}`, `https://www.atg.se/services/racinginfo/v1/api/races/${payload.id}`, `${payload.date}T18:00:00Z`, key, `synthetic-hash-${id}`);
  return id;
}

test('validates exact official ordinary-race identity and selects only Swedish trot', () => {
  assert.equal(validateOfficialRacePayload(racePayload()).id, RACE_ID);
  assert.equal(officialRaceHasFinalResults(racePayload()), true);
  assert.deepEqual(swedishTrottingRaceIds(calendarPayload()), [RACE_ID]);
  const mismatch = racePayload();
  mismatch.track.id = 8;
  assert.throws(() => validateOfficialRacePayload(mismatch), /identity fields/);
});

test('normalizes ordinary historical results, equipment and verified scratches idempotently', async () => {
  const { env, db, objects } = createTestEnv();
  seedRaceSource(db, objects);
  const first = await normalizeCapturedOfficialRace(env, 'src_historical');
  assert.equal(first.entryCount, 2);
  assert.equal(first.resultCount, 2);
  assert.equal(first.scratchedCount, 1);
  assert.equal(first.reused, false);

  const race = db.prepare('SELECT race_date, distance_m, status, source_quality FROM races WHERE id = ?').get(RACE_ID);
  assert.deepEqual({ ...race }, { race_date: DATE, distance_m: 2140, status: 'results', source_quality: 'normalized_verified_subset' });
  const winner = db.prepare(`SELECT rr.placing, rr.km_time, rr.prize_sek, rr.official_odds, rr.result_status
    FROM race_results rr JOIN race_entries re ON re.id = rr.race_entry_id WHERE re.start_number = 1`).get();
  assert.deepEqual({ ...winner }, { placing: 1, km_time: '1.11,2', prize_sek: 100000, official_odds: 2.07, result_status: 'official' });
  const scratched = db.prepare(`SELECT re.scratched, rr.placing, rr.placing_text, rr.official_odds, rr.result_status
    FROM race_entries re JOIN race_results rr ON rr.race_entry_id = re.id WHERE re.start_number = 8`).get();
  assert.deepEqual({ ...scratched }, { scratched: 1, placing: null, placing_text: 'scratched', official_odds: null, result_status: 'scratched' });
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM equipment').get().n > 0);

  const second = await normalizeCapturedOfficialRace(env, 'src_historical');
  assert.equal(second.reused, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 2);
});

test('incomplete ordinary race capture fails closed before historical facts are normalized', async () => {
  const { env, db, objects } = createTestEnv();
  const incomplete = racePayload();
  incomplete.status = 'ongoing';
  delete incomplete.starts[0].result;
  seedRaceSource(db, objects, 'src_incomplete', incomplete);
  assert.equal(officialRaceHasFinalResults(incomplete), false);
  await assert.rejects(() => normalizeCapturedOfficialRace(env, 'src_incomplete'), /results are not final/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 0);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE id = 'src_incomplete'`).get().quality_status, 'captured_unmapped');
});

test('backfill checkpoint captures one race per step, resumes and completes without duplicates', async () => {
  const { env, db } = createTestEnv();
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.includes('/calendar/day/')) return jsonResponse(calendarPayload());
    if (url.includes('/races/')) return jsonResponse(racePayload());
    throw new Error(`unexpected URL ${url}`);
  };
  const job = await startHistoricalBackfill(env, DATE, DATE);
  assert.equal(job.status, 'running');
  assert.equal(job.next_date, DATE);

  const first = await runHistoricalBackfillStep(env, job.id, { fetchImpl });
  assert.equal(first.raceId, RACE_ID);
  assert.equal(first.checkpoint.nextRaceIndex, 1);
  assert.equal(first.done, false);
  const second = await runHistoricalBackfillStep(env, job.id, { fetchImpl });
  assert.equal(second.status, 'completed');
  assert.equal(second.done, true);
  assert.equal(fetched.filter((url) => url.includes('/calendar/day/')).length, 1);
  assert.equal(fetched.filter((url) => url.includes('/races/')).length, 1);
  const stored = db.prepare('SELECT status, processed_dates, processed_races, consecutive_errors FROM historical_backfill_jobs WHERE id = ?').get(job.id);
  assert.deepEqual({ ...stored }, { status: 'completed', processed_dates: 1, processed_races: 1, consecutive_errors: 0 });
});

test('multi-day backfill starts with the newest date and then moves backward', async () => {
  const { env } = createTestEnv();
  const EARLIER = '2099-04-09';
  const calendarDates = [];
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) {
      const date = url.split('/').pop();
      calendarDates.push(date);
      return jsonResponse(calendarPayload(date));
    }
    if (url.includes('/races/')) {
      const raceId = url.split('/').pop();
      return jsonResponse(racePayload(raceId.slice(0, 10)));
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const job = await startHistoricalBackfill(env, EARLIER, DATE);
  assert.equal(job.next_date, DATE);
  const newest = await runHistoricalBackfillStep(env, job.id, { fetchImpl });
  assert.equal(newest.raceId, RACE_ID);
  const older = await runHistoricalBackfillStep(env, job.id, { fetchImpl });
  assert.equal(older.raceId, `${EARLIER}_7_5`);
  assert.deepEqual(calendarDates, [DATE, EARLIER]);
});

test('backfill refreshes an incomplete cached race before normalizing it', async () => {
  const { env, db, objects } = createTestEnv();
  const incomplete = racePayload();
  delete incomplete.starts[0].result;
  seedRaceSource(db, objects, 'src_stale', incomplete);
  let raceFetches = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) return jsonResponse(calendarPayload());
    if (url.includes('/races/')) {
      raceFetches += 1;
      return jsonResponse(racePayload());
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const job = await startHistoricalBackfill(env, DATE, DATE);
  const result = await runHistoricalBackfillStep(env, job.id, { fetchImpl });
  assert.equal(result.raceId, RACE_ID);
  assert.equal(raceFetches, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 1);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE id = 'src_stale'`).get().quality_status, 'captured_unmapped');
});

test('historical operational routes remain behind ADMIN_TOKEN', async () => {
  const { env } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin';
  const denied = await worker.fetch(new Request('https://example.test/v1/historical/backfill/start', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start_date: DATE, end_date: DATE })
  }), env);
  assert.equal(denied.status, 401);
  const allowed = await worker.fetch(new Request('https://example.test/v1/historical/backfill/start', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-admin' }, body: JSON.stringify({ start_date: DATE, end_date: DATE })
  }), env);
  assert.equal(allowed.status, 201);
});

test('an active backfill lease prevents overlapping checkpoint work', async () => {
  const { env, db } = createTestEnv();
  const job = await startHistoricalBackfill(env, DATE, DATE);
  db.prepare(`UPDATE historical_backfill_jobs SET lease_token = 'other-worker', lease_until = '2999-01-01T00:00:00Z' WHERE id = ?`).run(job.id);
  const result = await runHistoricalBackfillStep(env, job.id, {
    fetchImpl: async () => { throw new Error('overlapping worker must not fetch'); }
  });
  assert.equal(result.status, 'busy');
  assert.equal(result.reused, true);
});

test('three failures stop at the same checkpoint and explicit resume continues it', async () => {
  const { env, db } = createTestEnv();
  const job = await startHistoricalBackfill(env, DATE, DATE);
  const failingFetch = async () => new Response('temporarily unavailable', { status: 503 });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(() => runHistoricalBackfillStep(env, job.id, { fetchImpl: failingFetch }), /HTTP 503/);
    const state = db.prepare('SELECT status, next_date, next_race_index, consecutive_errors, lease_until FROM historical_backfill_jobs WHERE id = ?').get(job.id);
    assert.equal(state.next_date, DATE);
    assert.equal(state.next_race_index, 0);
    assert.equal(state.consecutive_errors, attempt);
    assert.equal(state.status, attempt === 3 ? 'failed' : 'running');
    assert.ok(state.lease_until);
    if (attempt < 3) db.prepare(`UPDATE historical_backfill_jobs SET lease_until = '2000-01-01T00:00:00Z' WHERE id = ?`).run(job.id);
  }

  const resumed = await startHistoricalBackfill(env, DATE, DATE, { resume: true });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.next_date, DATE);
  assert.equal(resumed.next_race_index, 0);
  const successfulFetch = async (url) => url.includes('/calendar/day/')
    ? jsonResponse(calendarPayload())
    : jsonResponse(racePayload());
  const result = await runHistoricalBackfillStep(env, job.id, { fetchImpl: successfulFetch });
  assert.equal(result.raceId, RACE_ID);
  assert.equal(result.checkpoint.nextRaceIndex, 1);
});

test('official batch commits the first checkpoint and stops when the second source request fails', async () => {
  const { env, db } = createTestEnv();
  const requestedRaces = [];
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) return jsonResponse(calendarPayload(DATE, [5, 6, 7]));
    const raceId = url.split('/').pop();
    requestedRaces.push(raceId);
    if (raceId.endsWith('_6')) return new Response('pushback', { status: 429, headers: { 'retry-after': '180' } });
    return jsonResponse(racePayload(DATE, Number(raceId.split('_').pop())));
  };
  const job = await startHistoricalBackfill(env, DATE, DATE);

  await assert.rejects(
    () => runHistoricalBackfillBatch(env, job.id, { fetchImpl }),
    (error) => error.code === 'SOURCE_RATE_LIMITED' && error.httpStatus === 429
  );

  assert.deepEqual(requestedRaces, [`${DATE}_7_5`, `${DATE}_7_6`]);
  const state = db.prepare(`
    SELECT next_race_index, processed_races, consecutive_errors, lease_token, lease_until
    FROM historical_backfill_jobs WHERE id = ?
  `).get(job.id);
  assert.equal(state.next_race_index, 1);
  assert.equal(state.processed_races, 1);
  assert.equal(state.consecutive_errors, 1);
  assert.equal(state.lease_token, null);
  assert.ok(Date.parse(state.lease_until) > Date.now());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 1);
});

test('official batch advances exactly three of four eligible races and reuses the calendar capture', async () => {
  const { env, db } = createTestEnv();
  const requested = [];
  let calendarFetches = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) {
      calendarFetches += 1;
      return jsonResponse(calendarPayload(DATE, [5, 6, 7, 8]));
    }
    const raceId = url.split('/').pop();
    requested.push(raceId);
    return jsonResponse(racePayload(DATE, Number(raceId.split('_').pop())));
  };
  const job = await startHistoricalBackfill(env, DATE, DATE);

  const result = await runHistoricalBackfillBatch(env, job.id, { fetchImpl });

  assert.equal(result.stepCount, 3);
  assert.deepEqual(requested, [`${DATE}_7_5`, `${DATE}_7_6`, `${DATE}_7_7`]);
  assert.equal(calendarFetches, 1);
  const state = db.prepare(`
    SELECT next_race_index, processed_races, consecutive_errors
    FROM historical_backfill_jobs WHERE id = ?
  `).get(job.id);
  assert.deepEqual({ ...state }, { next_race_index: 3, processed_races: 3, consecutive_errors: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 3);
});
