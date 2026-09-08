import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { captureXlabsRaceJson } from '../src/provider/xlabs-race.js';

function seedBase(db, objects, racesScript) {
  const parentKey = 'raw/xlabs/parent.html';
  objects.set(parentKey, { body: '<html></html>', options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:2026-09-06','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown',?)`)
    .run(parentKey, JSON.stringify({ kind: 'date_page', date: '2026-09-06', normalizationStatus: 'not_implemented' }));

  const calcKey = 'raw/xlabs_script/calculate.js';
  objects.set(calcKey, { body: `function parseData(path) { const fileName = monthString + dayString + trackNumber + '1' + raceNumberString + '.json'; $.getJSON(path + fileName); }`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_calc','xlabs_script','src_parent:calculate.js','https://kmtid.atgx.se/260906/js/calculate.js','2099-01-01T00:00:02Z',?,'hash_calc','captured_unmapped','unknown',?)`)
    .run(calcKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'calculate.js' }));

  const mainKey = 'raw/xlabs_script/main.js';
  objects.set(mainKey, { body: `parseData('json/');`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_main','xlabs_script','src_parent:main.js','https://kmtid.atgx.se/260906/js/main.js','2099-01-01T00:00:01Z',?,'hash_main','captured_unmapped','unknown',?)`)
    .run(mainKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'main.js' }));

  const racesKey = 'raw/xlabs_script/races.js';
  objects.set(racesKey, { body: racesScript, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_races','xlabs_script','src_parent:races.js','https://kmtid.atgx.se/260906/js/races.js','2099-01-01T00:00:03Z',?,'hash_races','captured_unmapped','unknown',?)`)
    .run(racesKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'races.js' }));

  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_official', 'Jägersro')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_official', 'official', '7')`).run();
}

test('uses requested race number to disambiguate repeated track names in races.js', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [
    { number: 4, trackId: 41, trackName: 'Jägersro' },
    { number: 5, trackId: 42, trackName: 'Jägersro' },
    { number: 6, trackId: 43, trackName: 'Jägersro' }
  ];`);
  const seen = [];
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  assert.equal(result.xlabsTrackId, 42);
  assert.equal(result.trackMappingStatus, 'resolved_from_races_script');
  assert.deepEqual(seen, ['https://kmtid.atgx.se/260906/json/090642105.json']);
});

test('supports quoted JavaScript object keys when resolving the requested race', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [{ "number": 5, "trackId": 42, "trackName": "Jägersro" }];`);
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.xlabsTrackId, 42);
});

test('does not mistake homeTrackId or startNumber for the exact race properties', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [{ number: 5, trackId: 42, trackName: 'Jägersro', homeTrackId: 99, startNumber: 8 }];`);
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.xlabsTrackId, 42);
});

test('ignores nested starter numbers when resolving the race number', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [
    { number: 4, track: { trackId: 41, trackName: 'Jägersro' }, starts: [{ number: 5 }] },
    { number: 5, track: { trackId: 42, trackName: 'Jägersro' }, starts: [{ number: 1 }] }
  ];`);
  const seen = [];
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(result.xlabsTrackId, 42);
  assert.deepEqual(seen, ['https://kmtid.atgx.se/260906/json/090642105.json']);
});

test('ignores misleading property-looking text in comments and string values', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [{
    number: 5,
    trackId: 42,
    trackName: 'Jägersro',
    note: 'trackId: 99 number: 8',
    /* trackId: 77, number: 9 */
    other: true
  }];`);
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.xlabsTrackId, 42);
});

test('decodes escaped unicode in captured track-name literals', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, String.raw`const races = [{ number: 5, trackId: 42, trackName: 'J\u00e4gersro' }];`);
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.xlabsTrackId, 42);
});

test('still fails closed when the requested race itself maps to multiple track ids', async () => {
  const { env, db, objects } = createTestEnv();
  seedBase(db, objects, `const races = [
    { number: 5, trackId: 42, trackName: 'Jägersro' },
    { number: 5, trackId: 43, trackName: 'Jägersro' }
  ];`);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /for the requested race/
  );
});
