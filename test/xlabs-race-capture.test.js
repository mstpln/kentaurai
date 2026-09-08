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

function seedTrackMapping(db, objects, { externalTrackId = 7, xlabsTrackId = 42, trackName = 'Synthetic Park' } = {}) {
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_synthetic', ?)`).run(trackName);
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_synthetic', 'official', ?)`).run(String(externalTrackId));
  const key = 'raw/xlabs_script/races.js';
  objects.set(key, {
    body: `const races = [{ trackId: ${xlabsTrackId}, trackName: '${trackName}', number: 5 }];`,
    options: {}
  });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_races','xlabs_script','src_parent:races.js','https://kmtid.atgx.se/260906/js/races.js','2099-01-01T00:00:03Z',?,'hash_races','captured_unmapped','unknown',?)`)
    .run(key, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'races.js' }));
}

test('builds the verified X-Labs race filename deterministically', () => {
  assert.equal(buildXlabsRaceFileName('2026-09-06', 7, 5), '09067105.json');
  assert.equal(buildXlabsRaceFileName('2026-12-31', 12, 14), '123112114.json');
  assert.throws(() => buildXlabsRaceFileName('2026-02-30', 7, 5), /valid calendar date/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 0, 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 7, 100), /race_number/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', '7abc', 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', '', 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 7, '5abc'), /race_number/);
});

test('requires verified track mapping before capture', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /official track id is not mapped/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
});

test('maps an official track id to the exact X-Labs object containing the canonical track name', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedTrackMapping(db, objects, { externalTrackId: 7, xlabsTrackId: 42, trackName: 'Synthetic Park' });
  const payload = JSON.stringify({ race: { number: 5 }, horses: [{ number: 1, syntheticMetric: 12.3 }] });
  const seen = [];

  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906/json/090642105.json');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(result.fileName, '090642105.json');
  assert.equal(result.requestedTrackId, 7);
  assert.equal(result.xlabsTrackId, 42);
  assert.equal(result.trackMappingStatus, 'resolved_from_races_script');
  assert.equal(result.qualityStatus, 'captured_unmapped');
  assert.equal(result.normalizationStatus, 'not_implemented');
  assert.equal(result.normalizedRowsWritten, 0);
  assert.equal(result.schemaSample.type, 'object');
  assert.ok(result.schemaSample.keys.includes('horses'));
  assert.equal(result.schemaSampleFieldLimit, 20);

  const source = db.prepare(`SELECT source_type, external_id, source_url, quality_status, metadata_json FROM source_records WHERE source_type = 'xlabs_race_json'`).get();
  assert.equal(source.source_type, 'xlabs_race_json');
  assert.equal(source.external_id, '2026-09-06:42:5');
  assert.equal(source.source_url, 'https://kmtid.atgx.se/260906/json/090642105.json');
  assert.equal(source.quality_status, 'captured_unmapped');
  const metadata = JSON.parse(source.metadata_json);
  assert.equal(metadata.fileName, '090642105.json');
  assert.equal(metadata.requestedTrackId, 7);
  assert.equal(metadata.xlabsTrackId, 42);
  assert.equal(metadata.canonicalTrackName, 'Synthetic Park');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);

  const stored = [...objects.entries()].find(([key]) => key.includes('/xlabs_race_json/'));
  assert.ok(stored);
  assert.equal(stored[1].body, payload);
});

test('does not use a non-official external-id mapping as track identity', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_other', 'Synthetic Park')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_other', 'other_source', '7')`).run();
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /official track id is not mapped/
  );
});

test('fails closed when captured races.js is missing', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_synthetic', 'Synthetic Park')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_synthetic', 'official', '7')`).run();
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /races\.js is required/
  );
});

test('does not associate a nearby different object track id with the matching track name', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedTrackMapping(db, objects, { externalTrackId: 7, xlabsTrackId: 42, trackName: 'Synthetic Park' });
  objects.set('raw/xlabs_script/races.js', {
    body: `const races=[{trackId:99,trackName:'Other Track'},{trackId:42,trackName:'Synthetic Park'}];`,
    options: {}
  });
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

test('fails closed when the exact canonical track name maps to multiple X-Labs track ids', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedTrackMapping(db, objects, { externalTrackId: 7, xlabsTrackId: 42, trackName: 'Synthetic Park' });
  const racesKey = 'raw/xlabs_script/races.js';
  objects.set(racesKey, { body: `const a={trackId:42,trackName:'Synthetic Park'}; const b={trackId:43,trackName:'Synthetic Park'};`, options: {} });

  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /could not be uniquely resolved/
  );
});

test('bounds the returned schema sample across nested objects', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedTrackMapping(db, objects);
  const wide = {};
  for (let i = 0; i < 50; i += 1) wide[`field_${String(i).padStart(2, '0')}`] = i;
  const payload = JSON.stringify({ race: wide, horse: wide, extra: wide });
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } })
  });

  function countKeys(node) {
    if (!node || typeof node !== 'object') return 0;
    let count = Array.isArray(node.keys) ? node.keys.length : 0;
    if (node.fields) for (const child of Object.values(node.fields)) count += countKeys(child);
    if (node.sample) count += countKeys(node.sample);
    return count;
  }

  assert.ok(countKeys(result.schemaSample) <= 20);
  assert.equal(result.schemaSampleFieldLimit, 20);
});

test('rejects a resolved base path outside the captured date json directory', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects, '/other-date/json/');
  seedTrackMapping(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response('{}') }),
    /must use \/260906\/json\//
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
});

test('rejects unexpected content type without archiving a race payload', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedTrackMapping(db, objects);
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
  seedTrackMapping(db, objects);
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
  seedTrackMapping(db, objects);
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
