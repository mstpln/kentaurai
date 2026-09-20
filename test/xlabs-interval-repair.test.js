import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestEnv } from './helpers/d1.js';
import {
  ensureXlabsIntervalsForSource,
  runXlabsIntervalRepairBatch
} from '../src/import/xlabs-interval-repair.js';
import { normalizeCapturedXlabsIntervalsV2, XLABS_INTERVALS_V2_VERSION } from '../src/xlabs-intervals-v2.js';
import worker from '../src/index.js';

const DATE = '2099-01-02';

function telemetryPayload() {
  const frames = [];
  const started = Date.parse(DATE + 'T12:00:00Z');
  for (let i = 0; i <= 220; i += 1) {
    const distance = Math.max(0, 2140 - i * 10);
    frames.push({
      trackId: 7,
      raceNumber: 5,
      timestamp: new Date(started + i * 700).toISOString(),
      targets: [
        { number: 1, posX: i * 10, posY: 0, distanceToFinish: distance },
        { number: 2, posX: i * 10, posY: 1, distanceToFinish: distance }
      ]
    });
  }
  return frames;
}

function seedSource(db, objects, { id = 'src_x', fetchedAt = DATE + 'T13:00:00Z' } = {}) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track','Test','SE')").run();
  db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES ('track','official','7')").run();
  db.prepare(`INSERT INTO races
    (id,track_id,race_date,race_number,distance_m,start_method,status)
    VALUES ('race','track',?,5,2140,'auto','results')`).run(DATE);
  for (const [horse,entry,start] of [['h1','e1',1],['h2','e2',2]]) {
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(horse,horse);
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_start_distance_m,scratched)
      VALUES (?,'race',?,?,2140,0)`).run(entry,horse,start);
  }
  const key='raw/x.json';
  objects.set(key, { body: JSON.stringify(telemetryPayload()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id,source_type,external_id,raw_object_key,fetched_at,quality_status,metadata_json)
    VALUES (?, 'xlabs_race_json', 'race:test', ?, ?, 'normalized_verified_subset', ?)`)
    .run(id,key,fetchedAt,JSON.stringify({date:DATE,xlabsTrackId:7,requestedTrackId:7,raceNumber:5}));
  for (const entry of ['e1','e2']) {
    db.prepare(`INSERT INTO xlabs_data
      (id,race_entry_id,last_400_time,last_1000_time,quality_status,source_record_id)
      VALUES (?,?,?,?, 'xlabs-telemetry-v1', ?)`)
      .run('x_'+entry,entry,'1.10,0 min/km','1.12,0 min/km',id);
  }
}

test('interval repair derives missing v2 rows from already captured normalized X-Labs raw telemetry', async () => {
  const { env, db, objects } = createTestEnv();
  seedSource(db, objects);

  const before = db.prepare('SELECT COUNT(*) n FROM xlabs_intervals').get().n;
  assert.equal(before, 0);

  const result = await ensureXlabsIntervalsForSource(env, 'src_x');
  assert.equal(result.reused, false);
  assert.ok(result.intervalRows > 0);
  assert.ok(result.validIntervals > 0);

  const rows = db.prepare(`SELECT COUNT(*) n FROM xlabs_intervals
    WHERE source_record_id='src_x' AND mapper_version=?`).get(XLABS_INTERVALS_V2_VERSION).n;
  assert.equal(rows, result.intervalRows);
  const state = db.prepare(`SELECT status,mapper_version,interval_rows,valid_intervals
    FROM xlabs_interval_source_state WHERE source_record_id='src_x'`).get();
  assert.equal(state.status, 'success');
  assert.equal(state.mapper_version, XLABS_INTERVALS_V2_VERSION);
  assert.equal(state.interval_rows, result.intervalRows);
});

test('interval repair completes a partially written source instead of falsely marking it complete', async () => {
  const { env, db, objects } = createTestEnv();
  seedSource(db, objects);
  const normalized = await normalizeCapturedXlabsIntervalsV2(env, 'src_x');
  assert.ok(normalized.intervalRows > 1);

  const row = db.prepare(`SELECT id FROM xlabs_intervals
    WHERE source_record_id='src_x' AND mapper_version=? ORDER BY id LIMIT 1`).get(XLABS_INTERVALS_V2_VERSION);
  db.prepare('DELETE FROM xlabs_intervals WHERE id=?').run(row.id);
  const partial = db.prepare(`SELECT COUNT(*) n FROM xlabs_intervals
    WHERE source_record_id='src_x' AND mapper_version=?`).get(XLABS_INTERVALS_V2_VERSION).n;
  assert.equal(partial, normalized.intervalRows - 1);

  const repaired = await ensureXlabsIntervalsForSource(env, 'src_x');
  assert.equal(repaired.intervalRows, normalized.intervalRows);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM xlabs_intervals
    WHERE source_record_id='src_x' AND mapper_version=?`).get(XLABS_INTERVALS_V2_VERSION).n, normalized.intervalRows);
});

test('interval repair is idempotent and marks existing v2 rows as reused', async () => {
  const { env, db, objects } = createTestEnv();
  seedSource(db, objects);
  const first = await ensureXlabsIntervalsForSource(env, 'src_x');
  const second = await ensureXlabsIntervalsForSource(env, 'src_x');
  assert.equal(second.reused, true);
  assert.equal(second.intervalRows, first.intervalRows);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM xlabs_intervals').get().n, first.intervalRows);
});

test('bounded repair batch prioritizes newest normalized sources and reports remaining work', async () => {
  const { env, db, objects } = createTestEnv();
  seedSource(db, objects, { id:'src_old', fetchedAt:DATE+'T12:00:00Z' });

  const key='raw/new.json';
  objects.set(key, { body: JSON.stringify(telemetryPayload()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id,source_type,external_id,raw_object_key,fetched_at,quality_status,metadata_json)
    VALUES ('src_new','xlabs_race_json','race:new',?,?,'normalized_verified_subset',?)`)
    .run(key,DATE+'T14:00:00Z',JSON.stringify({date:DATE,xlabsTrackId:7,requestedTrackId:7,raceNumber:5}));
  for (const entry of ['e1','e2']) {
    db.prepare(`INSERT INTO xlabs_data
      (id,race_entry_id,last_400_time,last_1000_time,quality_status,source_record_id)
      VALUES (?,?,?,?, 'xlabs-telemetry-v1','src_new')`)
      .run('new_'+entry,entry,'1.09,0 min/km','1.11,0 min/km');
  }

  const result = await runXlabsIntervalRepairBatch(env, { limit: 1 });
  assert.equal(result.attempted, 1);
  assert.equal(result.successCount, 1);
  assert.equal(result.items[0].sourceRecordId, 'src_new');
  assert.ok(result.remaining >= 1);
});


test('interval repair admin route is private before database work', async () => {
  const env = { ADMIN_TOKEN: 'synthetic-admin-token' };
  const response = await worker.fetch(new Request('https://example.test/v1/xlabs/interval-repair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 1 })
  }), env);
  assert.equal(response.status, 401);
});
