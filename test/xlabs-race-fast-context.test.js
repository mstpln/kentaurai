import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { captureXlabsRaceJson } from '../src/provider/xlabs-race.js';

function seedContext(db, objects) {
  const parentKey = 'raw/xlabs/parent-fast.html';
  objects.set(parentKey, { body: '<html></html>', options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_fast_parent','xlabs','date:2026-09-06','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_fast_parent','captured_unmapped','unknown',?)`)
    .run(parentKey, JSON.stringify({ kind: 'date_page', date: '2026-09-06' }));

  const calcKey = 'raw/xlabs_script/calculate-fast.js';
  objects.set(calcKey, {
    body: `function parseData(path) { const fileName = '1' + monthString + dayString + trackNumber + raceNumberString + '.json'; $.getJSON(path + fileName); }`,
    options: {}
  });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_fast_calc','xlabs_script','src_fast_parent:calculate.js','https://kmtid.atgx.se/260906/js/calculate.js','2099-01-01T00:00:02Z',?,'hash_fast_calc','captured_unmapped','unknown',?)`)
    .run(calcKey, JSON.stringify({ parentSourceRecordId: 'src_fast_parent', scriptName: 'calculate.js' }));

  const mainKey = 'raw/xlabs_script/main-fast.js';
  objects.set(mainKey, { body: `parseData('json/');`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_fast_main','xlabs_script','src_fast_parent:main.js','https://kmtid.atgx.se/260906/js/main.js','2099-01-01T00:00:01Z',?,'hash_fast_main','captured_unmapped','unknown',?)`)
    .run(mainKey, JSON.stringify({ parentSourceRecordId: 'src_fast_parent', scriptName: 'main.js' }));

  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_fast', 'Synthetic Park')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_fast', 'official', '7')`).run();
}

function telemetryPayload() {
  return JSON.stringify([{
    trackId: 7,
    raceNumber: 5,
    timestamp: '2026-09-06T12:00:00.000Z',
    targets: [{ number: 1, posX: 0, posY: 0, distanceToFinish: 100 }]
  }]);
}

test('uses the bounded verified calculate/main context before the full script resolver', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  const seen = [];
  const result = await captureXlabsRaceJson(env, 'src_fast_calc', 7, 5, {
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response(telemetryPayload(), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.equal(result.pathResolution, 'verified_captured_context');
  assert.deepEqual(seen, ['https://kmtid.atgx.se/260906/json/109060705.json']);
  const source = db.prepare(`SELECT metadata_json FROM source_records WHERE source_type = 'xlabs_race_json'`).get();
  assert.equal(JSON.parse(source.metadata_json).pathResolution, 'verified_captured_context');
});
