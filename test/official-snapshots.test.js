import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  collectOfficialSnapshotFacts,
  getOfficialHorseSnapshotsAsOf,
  getOfficialPersonAnnualSnapshotsAsOf,
  parseOfficialRecord,
  syncOfficialSnapshotsFromSource
} from '../src/import/official-snapshots.js';

function seedEntities(db) {
  db.prepare("INSERT INTO horses (id, canonical_name) VALUES ('horse-a','Synthetic Horse')").run();
  db.prepare("INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES ('horse-a','official','100')").run();
  db.prepare("INSERT INTO drivers (id, canonical_name) VALUES ('driver-a','Synthetic Driver')").run();
  db.prepare("INSERT INTO driver_external_ids (driver_id, source_type, external_id) VALUES ('driver-a','official','200')").run();
  db.prepare("INSERT INTO trainers (id, canonical_name) VALUES ('trainer-a','Synthetic Trainer')").run();
  db.prepare("INSERT INTO trainer_external_ids (trainer_id, source_type, external_id) VALUES ('trainer-a','official','300')").run();
}

function addSource(db, id, fetchedAt, key) {
  db.prepare("INSERT INTO source_records (id, source_type, external_id, fetched_at, raw_object_key, quality_status) VALUES (?, 'official_provider', ?, ?, ?, 'normalized_verified_subset')")
    .run(id, `game:${id}`, fetchedAt, key);
}

async function putPayload(env, key, payload) {
  await env.RAW_BUCKET.put(key, JSON.stringify(payload), { httpMetadata: { contentType: 'application/json' } });
}

function payload({ age = 4, lifeStarts = 10, yearStarts = 6, recordSeconds = 14 } = {}) {
  return {
    races: [{
      id: 'synthetic-race',
      starts: [{
        horse: {
          id: 100,
          name: 'Synthetic Horse',
          age,
          record: { code: 'aM', startMethod: 'auto', distance: 'medium', time: { minutes: 1, seconds: recordSeconds, tenths: 5 } },
          trainer: {
            id: 300,
            firstName: 'Synthetic',
            lastName: 'Trainer',
            statistics: { years: { 2026: { starts: 80, earnings: 900000, placement: { 1: 12, 2: 9, 3: 8 }, winPercentage: 1500 } } }
          },
          statistics: {
            years: {
              2026: {
                starts: yearStarts,
                earnings: 123400,
                placement: { 1: 2, 2: 1, 3: 0 },
                records: [{ code: 'aM', startMethod: 'auto', distance: 'medium', time: { minutes: 1, seconds: recordSeconds, tenths: 5 }, place: 1 }]
              }
            },
            life: {
              starts: lifeStarts,
              earnings: 456700,
              placement: { 1: 3, 2: 2, 3: 1 },
              records: [],
              winPercentage: 3000,
              placePercentage: 6000,
              earningsPerStart: 45670,
              startPoints: 1200
            }
          }
        },
        driver: {
          id: 200,
          firstName: 'Synthetic',
          lastName: 'Driver',
          statistics: { years: { 2026: { starts: 100, earnings: 1000000, placement: { 1: 20, 2: 15, 3: 10 }, winPercentage: 2000 } } }
        }
      }]
    }]
  };
}

test('A4 parser preserves partial records and null separately from zero', () => {
  const record = parseOfficialRecord({ startMethod: 'auto', time: { minutes: 1 } });
  assert.deepEqual(record, {
    code: null,
    startMethod: 'auto',
    distanceGroup: null,
    timeMinutes: 1,
    timeSeconds: null,
    timeTenths: null,
    place: null
  });
  const facts = collectOfficialSnapshotFacts({
    races: [{ starts: [{ horse: { id: 100, statistics: { life: { starts: 0, placement: { 1: 0 } } } } }] }]
  });
  const life = facts.horseStats.get('100|life');
  assert.equal(life.starts, 0);
  assert.equal(life.wins, 0);
  assert.equal(life.seconds, null);
  assert.equal(life.earningsRaw, null);
});

test('A4 source replay is idempotent and never infers horse birth year from observed age', async () => {
  const { db, env } = createTestEnv();
  seedEntities(db);
  addSource(db, 'source-old', '2026-09-10T10:00:00Z', 'old');
  await putPayload(env, 'old', payload());

  const first = await syncOfficialSnapshotsFromSource(env, 'source-old');
  assert.equal(first.status, 'complete');
  assert.equal(first.reused, false);
  const counts = {
    profile: db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n,
    stats: db.prepare('SELECT COUNT(*) AS n FROM horse_stat_snapshots').get().n,
    records: db.prepare('SELECT COUNT(*) AS n FROM horse_record_snapshots').get().n,
    persons: db.prepare('SELECT COUNT(*) AS n FROM person_stat_snapshots').get().n
  };
  const second = await syncOfficialSnapshotsFromSource(env, 'source-old');
  assert.equal(second.reused, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, counts.profile);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_stat_snapshots').get().n, counts.stats);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_record_snapshots').get().n, counts.records);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM person_stat_snapshots').get().n, counts.persons);
  assert.equal(db.prepare("SELECT birth_year FROM horses WHERE id='horse-a'").get().birth_year, null);
});

test('A4 as-of reads exclude future observations and preserve changed source snapshots', async () => {
  const { db, env } = createTestEnv();
  seedEntities(db);
  addSource(db, 'source-old', '2026-09-10T10:00:00Z', 'old');
  addSource(db, 'source-new', '2026-09-12T10:00:00Z', 'new');
  await putPayload(env, 'old', payload({ age: 4, lifeStarts: 10, yearStarts: 6, recordSeconds: 14 }));
  await putPayload(env, 'new', payload({ age: 5, lifeStarts: 12, yearStarts: 8, recordSeconds: 12 }));
  await syncOfficialSnapshotsFromSource(env, 'source-old');
  await syncOfficialSnapshotsFromSource(env, 'source-new');

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 2, 'both source snapshots must be retained');
  let snapshots = await getOfficialHorseSnapshotsAsOf(env, ['horse-a'], '2026-09-11T00:00:00Z');
  let horse = snapshots.get('horse-a');
  assert.equal(horse.age.years, 4);
  assert.equal(horse.officialStatistics.life.starts, 10);
  assert.equal(horse.currentRecord.time.seconds, 14);
  assert.equal(horse.age.sourceRecordId, 'source-old');

  snapshots = await getOfficialHorseSnapshotsAsOf(env, ['horse-a'], '2026-09-13T00:00:00Z');
  horse = snapshots.get('horse-a');
  assert.equal(horse.age.years, 5);
  assert.equal(horse.officialStatistics.life.starts, 12);
  assert.equal(horse.currentRecord.time.seconds, 12);
  assert.equal(horse.age.sourceRecordId, 'source-new');

  let persons = await getOfficialPersonAnnualSnapshotsAsOf(env, 'driver', ['driver-a'], '2026-09-11T00:00:00Z');
  assert.equal(persons.get('driver-a').starts, 100);
  assert.equal(persons.get('driver-a').sourceRecordId, 'source-old');
  persons = await getOfficialPersonAnnualSnapshotsAsOf(env, 'trainer', ['trainer-a'], '2026-09-13T00:00:00Z');
  assert.equal(persons.get('trainer-a').starts, 80);
  assert.equal(persons.get('trainer-a').sourceRecordId, 'source-new');
});

test('A4 coverage comparison counts only granular results known by the selected as-of', async () => {
  const { db, env } = createTestEnv();
  seedEntities(db);
  addSource(db, 'source-old', '2026-09-10T10:00:00Z', 'old');
  await putPayload(env, 'old', payload({ lifeStarts: 10 }));
  await syncOfficialSnapshotsFromSource(env, 'source-old');

  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track-a','Synthetic Track')").run();
  db.prepare("INSERT INTO races (id, track_id, race_date, race_number) VALUES ('race-a','track-a','2026-09-01',1)").run();
  db.prepare("INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES ('entry-a','race-a','horse-a',1,0)").run();
  addSource(db, 'result-source', '2026-09-11T10:00:00Z', 'result');
  db.prepare("INSERT INTO race_results (race_entry_id, placing, result_status, source_record_id) VALUES ('entry-a',1,'official','result-source')").run();

  let snapshots = await getOfficialHorseSnapshotsAsOf(env, ['horse-a'], '2026-09-11T09:00:00Z');
  assert.deepEqual(snapshots.get('horse-a').coverage, {
    ownKnownStarts: 0, officialLifeStarts: 10, gap: 10, ratio: 0, status: 'partial'
  });
  snapshots = await getOfficialHorseSnapshotsAsOf(env, ['horse-a'], '2026-09-11T11:00:00Z');
  assert.deepEqual(snapshots.get('horse-a').coverage, {
    ownKnownStarts: 1, officialLifeStarts: 10, gap: 9, ratio: 0.1, status: 'partial'
  });
});

test('A4 conflicting duplicate facts in one source fail closed and are recorded as failed', async () => {
  const { db, env } = createTestEnv();
  seedEntities(db);
  addSource(db, 'source-conflict', '2026-09-10T10:00:00Z', 'conflict');
  const conflicting = {
    races: [
      { starts: [{ horse: { id: 100, age: 4 } }] },
      { starts: [{ horse: { id: 100, age: 5 } }] }
    ]
  };
  await putPayload(env, 'conflict', conflicting);
  await assert.rejects(() => syncOfficialSnapshotsFromSource(env, 'source-conflict'), /conflicting horse age/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 0);
  const sync = db.prepare("SELECT status, error_message FROM official_snapshot_source_sync WHERE source_record_id='source-conflict'").get();
  assert.equal(sync.status, 'failed');
  assert.match(sync.error_message, /conflicting horse age/);
});