import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {
  formatXlabsKilometerTime,
  mapXlabsTelemetryMeasurements,
  normalizeCapturedXlabsRace
} from '../src/import/xlabs-telemetry.js';
import { verifyCapturedXlabsNormalization } from '../src/routes/xlabs-verification.js';
import { createTestEnv } from './helpers/d1.js';

function syntheticTelemetry({ frames = 12, includeSecond = true } = {}) {
  return Array.from({ length: frames }, (_, index) => ({
    trackId: 7,
    raceNumber: 5,
    timestamp: new Date(Date.UTC(2099, 0, 2, 12, 0, index * 10)).toISOString(),
    targets: [
      { number: 1, posX: index * 100, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) },
      ...(includeSecond ? [{ number: 2, posX: index * 101, posY: 0, distanceToFinish: Math.max(0, 1100 - index * 100) }] : [])
    ]
  }));
}

function seedOfficialRace(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_5','track_7','2099-01-02',5,1000,'auto')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Synthetic One'),('horse_2','Synthetic Two')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m) VALUES ('entry_1','race_5','horse_1',1,1000),('entry_2','race_5','horse_2',2,1000)`).run();
}

function seedCapturedTelemetry(db, objects, payload = syntheticTelemetry()) {
  const key = 'raw/xlabs_race_json/2099-01-02/synthetic.json';
  objects.set(key, { body: JSON.stringify(payload), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_xlabs_race','xlabs_race_json','2099-01-02:7:5','https://kmtid.atgx.se/990102/json/101020705.json',
      '2099-01-02T13:00:00Z',?,'synthetic_hash','captured_unmapped','unknown',?)`)
    .run(key, JSON.stringify({ date: '2099-01-02', requestedTrackId: 7, xlabsTrackId: 7, raceNumber: 5 }));
}

test('formats X-Labs kilometer timings with the verified minute, second and tenth semantics', () => {
  assert.equal(formatXlabsKilometerTime(62_218.98), '1.02,2 min/km');
  assert.equal(formatXlabsKilometerTime(100_000), '1.40,0 min/km');
  assert.equal(formatXlabsKilometerTime(Number.NaN), null);
});

test('maps only entries with sufficient telemetry coverage and leaves unverified slipstream null', () => {
  const result = mapXlabsTelemetryMeasurements(syntheticTelemetry({ includeSecond: false }), {
    trackId: 7,
    raceNumber: 5,
    entries: [
      { race_entry_id: 'entry_1', start_number: 1, actual_start_distance_m: 1000, race_distance_m: 1000 },
      { race_entry_id: 'entry_2', start_number: 2, actual_start_distance_m: 1000, race_distance_m: 1000 }
    ]
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.rows[0].first200Time, '1.40,0 min/km');
  assert.equal(result.rows[0].last200Time, '1.40,0 min/km');
  assert.equal(result.rows[0].actualDistanceM, 1000);
  assert.equal(result.rows[0].extraDistanceM, 0);
  assert.equal(result.rows[0].convertedKmTime, '1.40,0 min/km');
  assert.equal(result.rows[0].slipstreamM, null);
});

test('normalizes captured telemetry idempotently and verifies raw against every accepted field', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedCapturedTelemetry(db, objects);

  const first = await normalizeCapturedXlabsRace(env, 'src_xlabs_race');
  assert.equal(first.normalizedRows, 2);
  assert.equal(first.counts.inserted, 2);
  assert.deepEqual(first.unmappedSemantics, ['slipstream_m']);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE id = 'src_xlabs_race'`).get().quality_status, 'normalized_verified_subset');

  const second = await normalizeCapturedXlabsRace(env, 'src_xlabs_race');
  assert.equal(second.counts.inserted, 0);
  assert.equal(second.counts.skipped, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data WHERE source_record_id = 'src_xlabs_race'`).get().n, 2);

  const verification = await verifyCapturedXlabsNormalization(env, 'src_xlabs_race');
  assert.equal(verification.passed, true);
  assert.equal(verification.fieldMismatchCount, 0);
  assert.equal(verification.representativeFieldCheckCount, 10);
  assert.equal(verification.mismatchCount, 0);
});

test('X-Labs normalize and verification routes remain admin-only', async () => {
  const { env, db, objects } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  seedOfficialRace(db);
  seedCapturedTelemetry(db, objects);
  const request = (path, token = null) => new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ source_record_id: 'src_xlabs_race' })
  });

  let response = await worker.fetch(request('/v1/xlabs/normalize'), env);
  assert.equal(response.status, 401);
  response = await worker.fetch(request('/v1/xlabs/normalize', env.ADMIN_TOKEN), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(request('/v1/xlabs/verify-normalization', env.ADMIN_TOKEN), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).passed, true);
});

test('normalization fails closed when telemetry identity does not match captured provenance', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  const payload = syntheticTelemetry();
  payload[3].raceNumber = 6;
  seedCapturedTelemetry(db, objects, payload);
  await assert.rejects(() => normalizeCapturedXlabsRace(env, 'src_xlabs_race'), /unexpected raceNumber/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 0);
  assert.equal(db.prepare(`SELECT status FROM import_runs WHERE source_type = 'xlabs_telemetry_normalize'`).get().status, 'failed');
});
