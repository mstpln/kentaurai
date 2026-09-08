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
    .run(parentKey, JSON.stringify({ kind: 'date_page', date: '2026-09-06' }));

  const calcKey = 'raw/xlabs_script/calculate.js';
  objects.set(calcKey, { body: `function parseData(path) { const fileName = '1' + monthString + dayString + trackNumber + raceNumberString + '.json'; $.getJSON(path + fileName); }`, options: {} });
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

function seedOfficialTrack(db, { externalTrackId = 7, trackName = 'Synthetic Park' } = {}) {
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_synthetic', ?)`).run(trackName);
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_synthetic', 'official', ?)`).run(String(externalTrackId));
}

function telemetryPayload(trackId = 7, raceNumber = 5, extra = {}) {
  return JSON.stringify([{
    trackId,
    raceNumber,
    timestamp: '2026-09-06T12:00:00.000Z',
    targets: [{ number: 1, posX: 0, posY: 0, distanceToFinish: 100 }],
    ...extra
  }]);
}

test('builds the browser-verified X-Labs race filename deterministically', () => {
  assert.equal(buildXlabsRaceFileName('2026-09-06', 7, 5), '109060705.json');
  assert.equal(buildXlabsRaceFileName('2026-12-31', 12, 14), '112311214.json');
  assert.throws(() => buildXlabsRaceFileName('2026-02-30', 7, 5), /valid calendar date/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 0, 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 7, 100), /race_number/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', '7abc', 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', '', 5), /track_id/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 7, '5abc'), /race_number/);
  assert.throws(() => buildXlabsRaceFileName('2026-09-06', 100, 5), /track_id/);
});

test('requires verified official track identity before capture', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response(telemetryPayload()) }),
    /official track id is not mapped/
  );
});

test('captures the exact browser-verified object and validates payload identity', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  const payload = telemetryPayload();
  const seen = [];
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906/json/109060705.json');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(result.fileName, '109060705.json');
  assert.equal(result.xlabsTrackId, 7);
  assert.equal(result.trackMappingStatus, 'observed_official_track_id_with_payload_guard');
  assert.equal(result.normalizationStatus, 'available_verified_subset');
  assert.equal(result.schemaSample.type, 'array');

  const source = db.prepare(`SELECT external_id, source_url, metadata_json FROM source_records WHERE source_type = 'xlabs_race_json'`).get();
  assert.equal(source.external_id, '2026-09-06:7:5');
  assert.equal(source.source_url, 'https://kmtid.atgx.se/260906/json/109060705.json');
  assert.equal(JSON.parse(source.metadata_json).acquisitionRecipe, '1MMDDTTRR.json');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);
  assert.equal([...objects.values()].find((item) => item.body === payload)?.body, payload);
});

test('does not use a non-official external-id mapping as track identity', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track_other', 'Synthetic Park')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_other', 'other_source', '7')`).run();
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response(telemetryPayload()) }),
    /official track id is not mapped/
  );
});

test('rejects payloads for another track or race before archiving', async () => {
  for (const [payload, message] of [[telemetryPayload(8, 5), /trackId/], [telemetryPayload(7, 6), /raceNumber/]]) {
    const { env, db, objects } = createTestEnv();
    seedContext(db, objects);
    seedOfficialTrack(db);
    await assert.rejects(
      () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response(payload) }),
      message
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
  }
});

test('bounds the returned schema sample across nested objects', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  const wide = {};
  for (let i = 0; i < 50; i += 1) wide[`field_${String(i).padStart(2, '0')}`] = i;
  const result = await captureXlabsRaceJson(env, 'src_calc', 7, 5, {
    fetchImpl: async () => new Response(telemetryPayload(7, 5, wide), { headers: { 'content-type': 'application/json' } })
  });

  function countKeys(node) {
    if (!node || typeof node !== 'object') return 0;
    let count = Array.isArray(node.keys) ? node.keys.length : 0;
    if (node.fields) for (const child of Object.values(node.fields)) count += countKeys(child);
    if (node.sample) count += countKeys(node.sample);
    return count;
  }

  assert.ok(countKeys(result.schemaSample) <= 20);
});

test('rejects a resolved base path outside the captured date json directory', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects, '/other-date/json/');
  seedOfficialTrack(db);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, { fetchImpl: async () => new Response(telemetryPayload()) }),
    /must use \/260906\/json\//
  );
});

test('rejects unexpected content type without archiving a race payload', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } })
    }),
    /unexpected content type/
  );
  const run = db.prepare(`SELECT status, error_count FROM import_runs WHERE source_type = 'xlabs_race_capture'`).get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('rejects invalid JSON even with an accepted content type', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response('not-json', { headers: { 'content-type': 'text/plain' } })
    }),
    /was not valid JSON/
  );
});

test('times out slow X-Labs race capture with a clear error and archives nothing', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      })
    }),
    /timed out after 5ms/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_race_json'`).get().n, 0);
  const run = db.prepare(`SELECT status, error_count FROM import_runs WHERE source_type = 'xlabs_race_capture'`).get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('rejects same-host redirects that change the verified race file path', async () => {
  const { env, db, objects } = createTestEnv();
  seedContext(db, objects);
  seedOfficialTrack(db);
  await assert.rejects(
    () => captureXlabsRaceJson(env, 'src_calc', 7, 5, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/260906/json/different.json' } })
    }),
    /must preserve the verified race file path/
  );
});
