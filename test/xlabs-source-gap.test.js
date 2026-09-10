import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { runXlabsBackfillStep, startXlabsBackfill } from '../src/import/xlabs-backfill.js';
import { XLABS_SOURCE_GAP_QUALITY, xlabsTelemetrySourceGap } from '../src/import/xlabs-source-gap.js';

const DATE = '2099-06-02';

function seedOfficialRace(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method)
    VALUES ('race_5','track_7',?,5,1000,'auto')`).run(DATE);
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Synthetic One'),('horse_2','Synthetic Two')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m)
    VALUES ('entry_1','race_5','horse_1',1,1000),('entry_2','race_5','horse_2',2,1000)`).run();
  db.prepare(`INSERT INTO historical_backfill_jobs
    (id,start_date,end_date,next_date,status)
    VALUES ('official_gate',?,?,?,'completed')`).run(DATE, DATE, DATE);
}

function seedXlabsContext(db, objects) {
  const compact = DATE.slice(2).replaceAll('-', '');
  const parentKey = `raw/xlabs/${compact}/page.html`;
  objects.set(parentKey, { body: '<html></html>', options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs',?,?,'2099-06-03T00:00:00Z',?,'hash_parent','captured_unmapped','unknown',?)`)
    .run(`date:${DATE}`, `https://kmtid.atgx.se/${compact}/`, parentKey, JSON.stringify({ kind: 'date_page', date: DATE }));

  const calcKey = `raw/xlabs_script/${compact}/calculate.js`;
  objects.set(calcKey, { body: `function parseData(path) { const fileName = '1' + monthString + dayString + trackNumber + raceNumberString + '.json'; $.getJSON(path + fileName); }`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_calc','xlabs_script','src_parent:calculate.js',?,'2099-06-03T00:00:02Z',?,'hash_calc','captured_unmapped','unknown',?)`)
    .run(`https://kmtid.atgx.se/${compact}/js/calculate.js`, calcKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'calculate.js' }));

  const mainKey = `raw/xlabs_script/${compact}/main.js`;
  objects.set(mainKey, { body: `parseData('json/');`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_main','xlabs_script','src_parent:main.js',?,'2099-06-03T00:00:01Z',?,'hash_main','captured_unmapped','unknown',?)`)
    .run(`https://kmtid.atgx.se/${compact}/js/main.js`, mainKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'main.js' }));
}

function duplicateTelemetryPayload() {
  return Array.from({ length: 12 }, (_, index) => ({
    trackId: 7,
    raceNumber: 5,
    timestamp: new Date(Date.UTC(2099, 5, 2, 12, 0, index * 10)).toISOString(),
    targets: index === 0
      ? [
          { number: 1, posX: 0, posY: 0, distanceToFinish: 1000 },
          { number: 1, posX: 0, posY: 0, distanceToFinish: 1000 },
          { number: 2, posX: 0, posY: 0, distanceToFinish: 1000 }
        ]
      : [
          { number: 1, posX: index * 100, posY: 0, distanceToFinish: Math.max(0, 1000 - index * 100) },
          { number: 2, posX: index * 100, posY: 0, distanceToFinish: Math.max(0, 1000 - index * 100) }
        ]
  }));
}

test('X-Labs duplicate-target source-gap classification is narrow', () => {
  assert.deepEqual(
    xlabsTelemetrySourceGap(new Error('X-Labs telemetry frame 0 contains duplicate target 9')),
    { code: 'duplicate_target', frameIndex: 0, startNumber: 9 }
  );
  assert.equal(xlabsTelemetrySourceGap(new Error('X-Labs telemetry frame 0 has an unexpected trackId')), null);
});

test('historical X-Labs backfill quarantines duplicate-target telemetry and advances exactly one checkpoint', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedXlabsContext(db, objects);
  await startXlabsBackfill(env, DATE, DATE);

  const result = await runXlabsBackfillStep(env, null, {
    raceFetchImpl: async () => new Response(JSON.stringify(duplicateTelemetryPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  assert.equal(result.unavailableRace, true);
  assert.equal(result.checkpoint.nextRaceIndex, 1);
  assert.equal(result.sourceGap.qualityStatus, XLABS_SOURCE_GAP_QUALITY);
  assert.deepEqual(result.sourceGap.gap, { code: 'duplicate_target', frameIndex: 0, startNumber: 1 });

  const source = db.prepare(`SELECT quality_status, metadata_json FROM source_records WHERE source_type='xlabs_race_json'`).get();
  assert.equal(source.quality_status, XLABS_SOURCE_GAP_QUALITY);
  const metadata = JSON.parse(source.metadata_json);
  assert.equal(metadata.normalizationStatus, 'source_gap');
  assert.deepEqual(metadata.sourceGap, { code: 'duplicate_target', frameIndex: 0, startNumber: 1 });

  const job = db.prepare(`SELECT next_race_index,processed_races,unavailable_races,consecutive_errors,last_error FROM xlabs_backfill_jobs`).get();
  assert.deepEqual({ ...job }, {
    next_race_index: 1,
    processed_races: 1,
    unavailable_races: 1,
    consecutive_errors: 0,
    last_error: null
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_data`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type='xlabs_telemetry_normalize' AND status='failed'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type='xlabs_historical_backfill_step' AND status='success'`).get().n, 1);
});

test('a pre-existing X-Labs source gap is not normalized or fetched again', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedXlabsContext(db, objects);
  const rawKey = 'raw/xlabs_race_json/source-gap.json';
  objects.set(rawKey, { body: JSON.stringify(duplicateTelemetryPayload()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_gap','xlabs_race_json',?,?,'2099-06-03T00:01:00Z',?,'gap-hash',?,'unknown',?)`)
    .run(`${DATE}:7:5`, `https://kmtid.atgx.se/990602/json/106020705.json`, rawKey, XLABS_SOURCE_GAP_QUALITY,
      JSON.stringify({ kind: 'race_json', date: DATE, requestedTrackId: 7, xlabsTrackId: 7, raceNumber: 5, normalizationStatus: 'source_gap', sourceGap: { code: 'duplicate_target', frameIndex: 0, startNumber: 1 } }));
  await startXlabsBackfill(env, DATE, DATE);

  let fetches = 0;
  const result = await runXlabsBackfillStep(env, null, {
    raceFetchImpl: async () => {
      fetches += 1;
      throw new Error('unexpected fetch');
    }
  });

  assert.equal(fetches, 0);
  assert.equal(result.unavailableRace, true);
  assert.equal(result.checkpoint.nextRaceIndex, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type='xlabs_telemetry_normalize'`).get().n, 0);
  const job = db.prepare(`SELECT processed_races,unavailable_races,consecutive_errors FROM xlabs_backfill_jobs`).get();
  assert.equal(job.processed_races, 1);
  assert.equal(job.unavailable_races, 1);
  assert.equal(job.consecutive_errors, 0);
});
