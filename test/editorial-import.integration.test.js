import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importEditorial } from '../src/import/editorial.js';
import { createTestEnv } from './helpers/d1.js';

const example = JSON.parse(
  readFileSync(new URL('../fixtures/editorial-import.example.json', import.meta.url), 'utf8')
);

function seedKnownRace(db) {
  db.exec(`
    INSERT INTO tracks (id, canonical_name) VALUES ('track-test', 'Testtrack');
    INSERT INTO races (id, track_id, race_date, race_number) VALUES ('race-1', 'track-test', '2026-09-12', 5);
    INSERT INTO race_external_ids (race_id, source_type, external_id) VALUES ('race-1', 'official', '2026-09-12_7_5');
    INSERT INTO horses (id, canonical_name) VALUES ('horse-1', 'Example Horse');
    INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('entry-1', 'race-1', 'horse-1', 1);
  `);
}

test('manual editorial import is idempotent', async () => {
  const { env, db, objects } = createTestEnv();
  seedKnownRace(db);

  const first = await importEditorial(env, structuredClone(example));
  const second = await importEditorial(env, structuredClone(example));

  assert.equal(first.counts.inserted, 1);
  assert.equal(second.counts.inserted, 0);
  assert.equal(second.reusedRawSnapshot, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM editorial_items').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM editorial_signals').get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM source_records WHERE source_type = 'editorial_manual'").get().n, 1);
  assert.equal(objects.size, 1);
});

test('race-scoped matching does not attach an editorial item to a same-name horse in another race', async () => {
  const { env, db } = createTestEnv();
  seedKnownRace(db);
  db.exec(`
    INSERT INTO races (id, track_id, race_date, race_number) VALUES ('race-2', 'track-test', '2026-09-12', 6);
    INSERT INTO race_external_ids (race_id, source_type, external_id) VALUES ('race-2', 'official', '2026-09-12_7_6');
    INSERT INTO horses (id, canonical_name) VALUES ('horse-2', 'Example Horse');
    INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('entry-2', 'race-2', 'horse-2', 2);
  `);

  const result = await importEditorial(env, structuredClone(example));
  assert.equal(result.unresolved.length, 0);
  const row = db.prepare('SELECT horse_id, race_entry_id FROM editorial_items').get();
  assert.equal(row.horse_id, 'horse-1');
  assert.equal(row.race_entry_id, 'entry-1');
});

test('manual editorial import rejects unstable exports without id or timestamp', () => {
  const missingId = structuredClone(example);
  delete missingId.source.export_id;
  assert.rejects(() => importEditorial(createTestEnv().env, missingId), /source\.export_id/);

  const missingTime = structuredClone(example);
  delete missingTime.source.exported_at;
  assert.rejects(() => importEditorial(createTestEnv().env, missingTime), /source\.exported_at/);
});
