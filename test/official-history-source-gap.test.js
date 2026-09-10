import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { runHistoricalBackfillBatch, startHistoricalBackfill } from '../src/import/official-historical-backfill.js';
import { OFFICIAL_SOURCE_GAP_QUALITY } from '../src/import/official-source-gap.js';

const DATE = '2099-04-10';

function person(id, firstName, lastName) {
  return { id, firstName, lastName, homeTrack: { id: 7, name: 'Synthetic Park' } };
}

function validRacePayload(raceNumber) {
  const raceId = `${DATE}_7_${raceNumber}`;
  return {
    id: raceId,
    name: 'Synthetic ordinary race',
    date: DATE,
    number: raceNumber,
    distance: 2140,
    startMethod: 'auto',
    scheduledStartTime: `${DATE}T15:00:00`,
    status: 'results',
    track: { id: 7, name: 'Synthetic Park', countryCode: 'SE', sportSystemCode: 'S' },
    starts: [{
      id: `${raceId}_1`,
      number: 1,
      postPosition: 1,
      distance: 2140,
      horse: {
        id: 7000 + raceNumber,
        name: `Synthetic Horse ${raceNumber}`,
        trainer: person(9000 + raceNumber, 'Synthetic', 'Trainer')
      },
      driver: person(8000 + raceNumber, 'Synthetic', 'Driver'),
      result: {
        place: 1,
        finishOrder: 1,
        kmTime: { minutes: 1, seconds: 13, tenths: 0 },
        prizeMoney: 10000,
        finalOdds: 2.5,
        startNumber: 1
      }
    }]
  };
}

function malformedRacePayload() {
  const payload = validRacePayload(5);
  payload.starts[0].horse = { name: 'Identity unavailable in source' };
  return payload;
}

function calendarPayload() {
  return {
    date: DATE,
    tracks: [{
      id: 7,
      name: 'Synthetic Park',
      countryCode: 'SE',
      sport: 'trot',
      races: [5, 6].map((number) => ({ id: `${DATE}_7_${number}`, number }))
    }],
    games: {}
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

test('historical backfill quarantines a source race with missing horse identity and continues', async () => {
  const { env, db } = createTestEnv();
  const requestedRaces = [];
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) return jsonResponse(calendarPayload());
    const raceId = url.split('/').pop();
    requestedRaces.push(raceId);
    if (raceId.endsWith('_5')) return jsonResponse(malformedRacePayload());
    if (raceId.endsWith('_6')) return jsonResponse(validRacePayload(6));
    throw new Error(`unexpected URL ${url}`);
  };

  const job = await startHistoricalBackfill(env, DATE, DATE);
  const batch = await runHistoricalBackfillBatch(env, job.id, { fetchImpl });

  assert.equal(batch.status, 'completed');
  assert.equal(batch.done, true);
  assert.equal(batch.stepCount, 3);
  assert.deepEqual(requestedRaces, [`${DATE}_7_5`, `${DATE}_7_6`]);

  const gapResult = batch.results[0];
  assert.equal(gapResult.raceId, `${DATE}_7_5`);
  assert.equal(gapResult.normalized, null);
  assert.equal(gapResult.sourceGap.qualityStatus, OFFICIAL_SOURCE_GAP_QUALITY);
  assert.deepEqual(gapResult.sourceGap.gap, { code: 'missing_horse_identity', startNumber: 1 });

  const source = db.prepare(`
    SELECT quality_status, metadata_json
    FROM source_records
    WHERE external_id = ?
    ORDER BY fetched_at DESC
    LIMIT 1
  `).get(`race:${DATE}_7_5`);
  assert.equal(source.quality_status, OFFICIAL_SOURCE_GAP_QUALITY);
  const metadata = JSON.parse(source.metadata_json);
  assert.equal(metadata.normalizationStatus, 'source_gap');
  assert.deepEqual(metadata.sourceGap, { code: 'missing_horse_identity', startNumber: 1 });

  const state = db.prepare(`
    SELECT status, processed_dates, processed_races, consecutive_errors, last_error
    FROM historical_backfill_jobs
    WHERE id = ?
  `).get(job.id);
  assert.deepEqual({ ...state }, {
    status: 'completed',
    processed_dates: 1,
    processed_races: 2,
    consecutive_errors: 0,
    last_error: null
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horses').get().n, 1);
  assert.equal(db.prepare('SELECT id FROM races').get().id, `${DATE}_7_6`);
});

test('a previously quarantined source is refreshed rather than trusted on a later run', async () => {
  const { env, db, objects } = createTestEnv();
  const bad = malformedRacePayload();
  const key = 'raw/official_provider/source-gap.json';
  objects.set(key, { body: JSON.stringify(bad), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES ('src_gap','official_provider',?,?,'2099-04-11T00:00:00Z',?,'gap-hash',?,?)`)
    .run(`race:${DATE}_7_5`, `https://www.atg.se/services/racinginfo/v1/api/races/${DATE}_7_5`, key, OFFICIAL_SOURCE_GAP_QUALITY,
      JSON.stringify({ kind: 'race', identity: `${DATE}_7_5`, normalizationStatus: 'source_gap', sourceGap: { code: 'missing_horse_identity', startNumber: 1 } }));

  let raceFetches = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/calendar/day/')) {
      const onlyRace = calendarPayload();
      onlyRace.tracks[0].races = [{ id: `${DATE}_7_5`, number: 5 }];
      return jsonResponse(onlyRace);
    }
    raceFetches += 1;
    return jsonResponse(validRacePayload(5));
  };

  const job = await startHistoricalBackfill(env, DATE, DATE);
  const batch = await runHistoricalBackfillBatch(env, job.id, { fetchImpl });
  assert.equal(batch.done, true);
  assert.equal(raceFetches, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM races').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 1);
});
