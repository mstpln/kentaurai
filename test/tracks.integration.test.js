import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-settings.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import {
  getTrackDetail,
  getTrackHomeTrainers,
  getTrackLaneStats,
  listTracks,
  trackDistanceGroup
} from '../src/routes/tracks.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrackData(db) {
  db.prepare(`INSERT INTO tracks (
    id, canonical_name, city, country_code, lap_length_m, home_stretch_m,
    curve_radius_m, banking_degrees, width_m, surface, open_stretch_lanes,
    angled_mobile_wing, start_notes, track_notes
  ) VALUES (
    'track-a', 'Synthetic Track', 'Teststad', 'SE', 1000, 200,
    85.5, 12.0, 22.0, 'grus', 1, 1, 'Syntetisk startnotering', 'Syntetisk bannotering'
  )`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track-a','official','88')`).run();
  db.prepare(`INSERT INTO tracks (id, canonical_name, city, country_code) VALUES ('track-b','Another Track','Annanstad','SE')`).run();

  for (const [id, date, distance, method] of [
    ['race-1', '2026-06-01', 2140, 'auto'],
    ['race-2', '2026-06-02', 2148, 'autostart'],
    ['race-3', '2025-06-03', 2140, 'auto'],
    ['race-4', '2026-06-04', 2640, 'volte'],
    ['race-5', '2026-06-05', 3000, 'auto']
  ]) db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, status) VALUES (?, 'track-a', ?, 1, ?, ?, 'results')`).run(id, date, distance, method);

  for (let i = 1; i <= 7; i += 1) db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(`horse-${i}`, `Synthetic Horse ${i}`);

  const entries = [
    ['entry-1','race-1','horse-1',1,0,1,0,0],
    ['entry-2','race-1','horse-2',2,0,2,0,1],
    ['entry-3','race-2','horse-3',1,0,1,1,0],
    ['entry-4','race-2','horse-4',2,0,2,0,0],
    ['entry-5','race-2','horse-5',3,1,3,0,0],
    ['entry-6','race-3','horse-6',1,0,1,0,0],
    ['entry-7','race-4','horse-7',1,0,1,0,0]
  ];
  for (const [entryId,raceId,horseId,lane,scratched,placing,gallop,disqualified] of entries) {
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_lane, scratched) VALUES (?, ?, ?, ?, ?, ?)`).run(entryId,raceId,horseId,lane,lane,scratched);
    if (!scratched) db.prepare(`INSERT INTO race_results (race_entry_id, placing, gallop, disqualified, result_status) VALUES (?, ?, ?, ?, 'official')`).run(entryId,placing,gallop,disqualified);
  }

  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-home','Home Trainer')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-old','Old Home Trainer')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-private','Unverified Trainer')`).run();
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at) VALUES ('source-official','official_provider','game:test','2026-09-01T10:00:00Z')`).run();
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at) VALUES ('source-official-old','official_provider','game:test-old','2026-08-01T10:00:00Z')`).run();
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at) VALUES ('source-other','synthetic_other','other:test','2026-09-01T10:00:00Z')`).run();

  db.prepare(`INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs-home','trainer','trainer-home','source-official','2026-09-01T10:00:00Z',?,'normalized_verified_subset')`).run(JSON.stringify({ homeTrackExternalId: '88', homeTrackName: 'Synthetic Track', location: 'Teststad' }));
  db.prepare(`INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs-old-1','trainer','trainer-old','source-official-old','2026-08-01T10:00:00Z',?,'normalized_verified_subset')`).run(JSON.stringify({ homeTrackExternalId: '88', homeTrackName: 'Synthetic Track' }));
  db.prepare(`INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs-old-2','trainer','trainer-old','source-official','2026-09-01T10:00:00Z',?,'normalized_verified_subset')`).run(JSON.stringify({ homeTrackExternalId: '99', homeTrackName: 'Other Track' }));
  db.prepare(`INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs-private','trainer','trainer-private','source-other','2026-09-01T10:00:00Z',?,'normalized_verified_subset')`).run(JSON.stringify({ homeTrackExternalId: '88', homeTrackName: 'Synthetic Track' }));
}

test('track distance grouping mirrors the canonical presentation groups', () => {
  assert.equal(trackDistanceGroup(2140), '2140');
  assert.equal(trackDistanceGroup(2148), '2140');
  assert.equal(trackDistanceGroup(2740), '2640');
  assert.equal(trackDistanceGroup(2800), 'other-long');
  assert.equal(trackDistanceGroup(3040), '3140');
  assert.equal(trackDistanceGroup(4300), 'other-long');
});

test('track list and detail expose verified profile fields and database coverage', async () => {
  const { env, db } = createTestEnv();
  seedTrackData(db);
  const list = await listTracks(env, { limit: 20, offset: 0 });
  assert.equal(list.total, 2);
  assert.equal(list.items[0].name, 'Another Track');
  assert.equal(list.items[1].name, 'Synthetic Track');
  assert.equal(list.items[1].races, 5);

  const detail = await getTrackDetail(env, 'track-a');
  assert.equal(detail.name, 'Synthetic Track');
  assert.equal(detail.city, 'Teststad');
  assert.equal(detail.profile.lapLengthM, 1000);
  assert.equal(detail.profile.homeStretchM, 200);
  assert.equal(detail.profile.curveRadiusM, 85.5);
  assert.equal(detail.profile.openStretchLanes, 1);
  assert.equal(detail.profile.angledMobileWing, true);
  assert.match(detail.description, /Verifierade mått/);
  assert.match(detail.description, /Syntetisk bannotering/);
  assert.equal(detail.coverage.races, 5);
  assert.equal(detail.coverage.homeTrainers, 1);
  assert.ok(detail.distanceGroups.some((row) => row.key === '2140'));
  assert.ok(detail.distanceGroups.some((row) => row.key === 'other-long'));
});

test('lane statistics combine track, canonical distance and start method and exclude scratched entries', async () => {
  const { env, db } = createTestEnv();
  seedTrackData(db);
  const data = await getTrackLaneStats(env, 'track-a', { year: '2026', startMethod: 'auto', distanceGroup: '2140' });
  assert.equal(data.totals.starts, 4);
  assert.equal(data.totals.resultStarts, 4);
  assert.equal(data.rows.length, 2);
  const lane1 = data.rows.find((row) => row.lane === 1);
  const lane2 = data.rows.find((row) => row.lane === 2);
  assert.equal(lane1.starts, 2);
  assert.equal(lane1.wins, 2);
  assert.equal(lane1.winRate, 1);
  assert.equal(lane1.gallopRate, 0.5);
  assert.equal(lane2.starts, 2);
  assert.equal(lane2.wins, 0);
  assert.equal(lane2.top3Rate, 1);
});

test('home trainers use only the latest verified official home-track observation', async () => {
  const { env, db } = createTestEnv();
  seedTrackData(db);
  const data = await getTrackHomeTrainers(env, 'track-a');
  assert.equal(data.total, 1);
  assert.deepEqual(data.items.map((row) => row.name), ['Home Trainer']);
  assert.equal(data.items[0].location, 'Teststad');
});

test('track app routes require a private app session and return track data when authenticated', async () => {
  const { env, db } = createTestEnv();
  seedTrackData(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/tracks/track-a'), env);
  assert.equal(response.status, 401);

  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request('https://example.test/app/api/tracks/track-a', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.name, 'Synthetic Track');

  response = await worker.fetch(new Request('https://example.test/app/api/tracks/track-a/lane-stats?year=2026&start_method=auto&distance_group=2140', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.totals.starts, 4);
}
