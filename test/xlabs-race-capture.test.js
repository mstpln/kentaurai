import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildXlabsRaceFileName, captureXlabsRaceJson } from '../src/provider/xlabs-race.js';

function seedContext(db, objects, path = 'json/') {
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
  objects.set(mainKey, { body: `parseData('${path}');`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_main','xlabs_script','src_parent:main.js','https://kmtid.atgx.se/260906/js/main.js','2099-01-01T00:00:01Z',?,'hash_main','captured_unmapped','unknown',?)`)
    .run(mainKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'main.js' }));
}

test('builds the verified X-Labs race filename deterministically', () => {
  assert.equal(buildXlabsRaceFileName('2026-09-06', 7, 5), '09067105.json');
  assert.equal(buildXlabsRaceFileName('2026-12-31', 12, 14), '123112114.json');
  assert.throws(() => buildXlabsRaceFileName('2026-02-30', 7, 5), /valid calendar date/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 0, 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 7, 100), /race_number/);
});

test('captures one resolved race JSON exactly and writes no normalized X-Labs rows', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  const payload = JSON.stringify({ race: { number: 5 }, horses: [{ number: 1, syntheticMetric: 12.3 }] });
  const seen = [];

  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906/json/09067105.json');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(result.fileName, '09067105.json');
  assert.equal(result.qualityStatus, 'captured_unmapped');
  assert.equal(result.normalizationStatus, 'not_implemented');
  assert.equal(result.normalizedRowsWritten, 0);
  assert.equal(result.schemaSample.type, 'object');
  assert.ok(result.schemaSample.keys.includes('horses'));

  const source = db.prepare(`SELECT source_type, external_id, source_url, quality_status, metadata_json FROM source_records WHERE source_type = 'xlabs_race_json'`).get();
  assert.equal(source.source_type, 'xlabs_race_json');
  assert.equal(source.external_id, '2026-09-06:7:5');
  assert.equal(source.source_url, 'https://kmtid.atgx.se/260906/json/09067105.json');
  assert.equal(source.quality_status, 'captured_unmapped');
  assert.equal(JSON.parse(source.metadata_json).fileName, '09067105.json');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);

  const stored = [...objects.entries()].find(([key]) => key.includes('/xlabs_race_json/'));
  assert.ok(stored);
  assert.equal(stored[1].body, payload);
});

test('rejects a resolved base path outside the captured date json directory', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects, '/other-date/json/');
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /must use \/260906\/json\//
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
});

test('rejects unexpected content type without archiving a race payload', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }),
    /unexpected content type/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
  const run = db.prepare(`SELECT status, error_count FROM import_runs WHERE source_type = 'xlabs_race_capture'`).get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('rejects invalid JSON even with an accepted content type', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })
    }),
    /was not valid JSON/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
});

test('rejects same-host redirects that change the verified race file path', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: '/260906/json/different.json' }
      })
    }),
    /must preserve the verified race file path/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
});
