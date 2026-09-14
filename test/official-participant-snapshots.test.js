import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  extractOfficialParticipantSnapshots,
  getOfficialHorseSnapshotAsOf,
  syncOfficialParticipantSnapshotsFromSource
} from '../src/import/official-participant-snapshots.js';

function putMappedParticipants(db) {
  db.prepare("INSERT INTO horses (id, canonical_name) VALUES ('horse-a','Synthetic Horse')").run();
  db.prepare("INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES ('horse-a','official','101')").run();
  db.prepare("INSERT INTO drivers (id, canonical_name) VALUES ('driver-a','Synthetic Driver')").run();
  db.prepare("INSERT INTO driver_external_ids (driver_id, source_type, external_id) VALUES ('driver-a','official','201')").run();
  db.prepare("INSERT INTO trainers (id, canonical_name) VALUES ('trainer-a','Synthetic Trainer')").run();
  db.prepare("INSERT INTO trainer_external_ids (trainer_id, source_type, external_id) VALUES ('trainer-a','official','301')").run();
}

function source(db, id, fetchedAt, key) {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, raw_object_key, quality_status)
    VALUES (?, 'official_provider', ?, ?, ?, 'normalized_verified_subset')`).run(id, `game:${id}`, fetchedAt, key);
}

function payload({ age = 5, starts = 12, earnings = 123400, winPct = 2500, recordSeconds = 13, includeLife = true } = {}) {
  const statistics = {
    years: {
      2099: {
        starts,
        earnings,
        placement: { 1: 3, 2: 2, 3: 1 },
        records: [{ code: 'aM', startMethod: 'auto', distance: 'medium', time: { minutes: 1, seconds: recordSeconds, tenths: 4 } }]
      }
    }
  };
  if (includeLife) {
    statistics.life = {
      starts,
      earnings,
      placement: { 1: 3, 2: 2, 3: 1 },
      records: [],
      winPercentage: winPct,
      placePercentage: 5000,
      earningsPerStart: 10283,
      startPoints: 0
    };
  }
  return {
    races: [{
      id: '2099-01-15_1_1',
      starts: [{
        horse: {
          id: 101,
          name: 'Synthetic Horse',
          age,
          record: { code: 'aK', startMethod: 'auto', distance: 'short', time: { minutes: 1, seconds: recordSeconds, tenths: 1 } },
          statistics,
          trainer: {
            id: 301,
            firstName: 'Synthetic',
            lastName: 'Trainer',
            statistics: { years: { 2099: { starts: 40, earnings: 700000, placement: { 1: 7, 2: 6, 3: 5 }, winPercentage: 1750 } } }
          }
        },
        driver: {
          id: 201,
          firstName: 'Synthetic',
          lastName: 'Driver',
          statistics: { years: { 2099: { starts: 60, earnings: 900000, placement: { 1: 9, 2: 8, 3: 7 }, winPercentage: 1500 } } }
        }
      }]
    }]
  };
}

async function putRaw(env, key, value) {
  await env.RAW_BUCKET.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

test('extractor preserves explicit zero, source-native scales and structured records', () => {
  const extracted = extractOfficialParticipantSnapshots(payload({ winPct: 0 }));
  const horse = extracted.horses.get('101');
  assert.equal(horse.ageYears, 5);
  assert.equal(horse.life.winPercentageHundredths, 0);
  assert.equal(horse.life.earningsRaw, 123400);
  assert.deepEqual(horse.currentRecord, {
    code: 'aK', startMethod: 'auto', distanceGroup: 'short', minutes: 1, seconds: 13, tenths: 1
  });
  assert.equal(horse.years[0].records[0].distanceGroup, 'medium');
  assert.equal(extracted.drivers.get('201').years[0].stats.starts, 60);
  assert.equal(extracted.trainers.get('301').years[0].stats.firsts, 7);
});

test('source sync stores provenance-backed snapshots and exact retry is idempotent', async () => {
  const { db, env } = createTestEnv();
  putMappedParticipants(db);
  source(db, 'source-a', '2099-01-14T08:00:00Z', 'raw-a');
  await putRaw(env, 'raw-a', payload());

  let result = await syncOfficialParticipantSnapshotsFromSource(env, 'source-a');
  assert.equal(result.reused, false);
  assert.equal(result.horseSnapshotCount, 1);
  assert.equal(result.horseYearSnapshotCount, 1);
  assert.equal(result.horseRecordSnapshotCount, 2);
  assert.equal(result.driverYearSnapshotCount, 1);
  assert.equal(result.trainerYearSnapshotCount, 1);

  result = await syncOfficialParticipantSnapshotsFromSource(env, 'source-a');
  assert.equal(result.reused, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_official_snapshots').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_official_record_snapshots').get().n, 2);
  const row = db.prepare('SELECT observed_at, source_record_id, life_earnings_raw FROM horse_official_snapshots').get();
  assert.equal(row.observed_at, '2099-01-14T08:00:00Z');
  assert.equal(row.source_record_id, 'source-a');
  assert.equal(row.life_earnings_raw, 123400);
});

test('as-of selection excludes later observations from a past view', async () => {
  const { db, env } = createTestEnv();
  putMappedParticipants(db);
  source(db, 'source-old', '2099-01-10T08:00:00Z', 'old');
  source(db, 'source-new', '2099-01-14T08:00:00Z', 'new');
  await putRaw(env, 'old', payload({ age: 4, starts: 8, recordSeconds: 15 }));
  await putRaw(env, 'new', payload({ age: 5, starts: 12, recordSeconds: 13 }));
  await syncOfficialParticipantSnapshotsFromSource(env, 'source-new');
  await syncOfficialParticipantSnapshotsFromSource(env, 'source-old');

  let view = await getOfficialHorseSnapshotAsOf(env, 'horse-a', '2099-01-12T00:00:00Z');
  assert.equal(view.horse.age_years, 4);
  assert.equal(view.horse.life_starts, 8);
  assert.equal(view.records.find((row) => row.record_scope === 'current').seconds, 15);

  view = await getOfficialHorseSnapshotAsOf(env, 'horse-a', '2099-01-15T00:00:00Z');
  assert.equal(view.horse.age_years, 5);
  assert.equal(view.horse.life_starts, 12);
  assert.equal(view.records.find((row) => row.record_scope === 'current').seconds, 13);
});

test('partial source blocks remain null rather than becoming invented zeros', async () => {
  const { db, env } = createTestEnv();
  putMappedParticipants(db);
  const partial = payload({ includeLife: false });
  delete partial.races[0].starts[0].horse.age;
  delete partial.races[0].starts[0].horse.record;
  source(db, 'source-partial', '2099-01-14T08:00:00Z', 'partial');
  await putRaw(env, 'partial', partial);
  await syncOfficialParticipantSnapshotsFromSource(env, 'source-partial');
  const row = db.prepare('SELECT age_years, life_starts, record_code FROM horse_official_snapshots').get();
  assert.equal(row.age_years, null);
  assert.equal(row.life_starts, null);
  assert.equal(row.record_code, null);
});

test('conflicting duplicate participant facts in one source fail closed before writes', async () => {
  const { db, env } = createTestEnv();
  putMappedParticipants(db);
  const conflicting = payload();
  const duplicate = structuredClone(conflicting.races[0].starts[0]);
  duplicate.horse.age = 6;
  conflicting.races[0].starts.push(duplicate);
  source(db, 'source-conflict', '2099-01-14T08:00:00Z', 'conflict');
  await putRaw(env, 'conflict', conflicting);
  await assert.rejects(() => syncOfficialParticipantSnapshotsFromSource(env, 'source-conflict'), /conflicting horse snapshot/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_official_snapshots').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM official_participant_snapshot_source_sync WHERE source_record_id='source-conflict'").get().status, 'failed');
});

test('invalid numeric semantics and unknown participant identities are not guessed', async () => {
  const invalid = payload();
  invalid.races[0].starts[0].horse.age = '5';
  assert.throws(() => extractOfficialParticipantSnapshots(invalid), /horse.age must be a non-negative integer/);

  const unknown = payload();
  unknown.races[0].starts[0].horse.id = 0;
  unknown.races[0].starts[0].driver.id = 0;
  unknown.races[0].starts[0].horse.trainer.id = 0;
  const extracted = extractOfficialParticipantSnapshots(unknown);
  assert.equal(extracted.horses.size, 0);
  assert.equal(extracted.drivers.size, 0);
  assert.equal(extracted.trainers.size, 0);
});
