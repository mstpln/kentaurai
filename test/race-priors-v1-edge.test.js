import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildRacePriorsV1ForEntries } from '../src/race-priors-v1.js';

function track(db, id = 'track-a') {
  db.prepare('INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, id);
}

function horse(db, id) {
  db.prepare('INSERT OR IGNORE INTO horses (id, canonical_name) VALUES (?, ?)').run(id, id);
}

function source(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, 'official_provider', ?, ?, 'normalized_verified_subset')`).run(id, id, fetchedAt);
}

function race(db, { id, date, method = 'auto', distance = 2140, trackId = 'track-a' }) {
  track(db, trackId);
  db.prepare(`INSERT INTO races
    (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, field_size,
     race_name, class_flags_json, status, source_quality)
    VALUES (?, ?, ?, 1, ?, ?, ?, 3, 'Synthetic race', '[]', 'official', 'normalized_verified_subset')`)
    .run(id, trackId, date, `${date}T12:00:00Z`, distance, method);
}

function entry(db, { id, raceId, lane, placing = null, fetchedAt = null }) {
  const horseId = `${id}-horse`;
  horse(db, horseId);
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, ?, ?, ?, 0, 2140, 0, 'synthetic')`)
    .run(id, raceId, horseId, lane, lane);
  if (fetchedAt) {
    const sourceId = `${id}-source`;
    source(db, sourceId, fetchedAt);
    db.prepare(`INSERT INTO race_results
      (race_entry_id, placing, gallop, disqualified, result_status, source_record_id)
      VALUES (?, ?, 0, 0, 'official', ?)`)
      .run(id, placing, sourceId);
  }
}

function threeEntries(db, { raceId, placings = [1, 2, 4], fetchedAt = null }) {
  for (let lane = 1; lane <= 3; lane += 1) {
    entry(db, { id: `${raceId}-e${lane}`, raceId, lane, placing: placings[lane - 1], fetchedAt });
  }
}

test('B6 keeps missing start method null and falls directly to the global population', async () => {
  const { db, env } = createTestEnv();
  race(db, { id: 'hist-null', date: '2026-08-01', method: null });
  threeEntries(db, { raceId: 'hist-null', fetchedAt: '2026-08-01T14:00:00Z' });
  race(db, { id: 'hist-auto', date: '2026-08-02', method: 'auto' });
  threeEntries(db, { raceId: 'hist-auto', fetchedAt: '2026-08-02T14:00:00Z' });
  race(db, { id: 'target-null', date: '2026-09-20', method: null });
  threeEntries(db, { raceId: 'target-null' });

  const pack = (await buildRacePriorsV1ForEntries(env, ['target-null-e1'], '2026-09-20T11:00:00Z')).get('target-null-e1');
  assert.equal(pack.target.startMethod, null);
  assert.equal(pack.priors.race_outcome.win_rate.direct_level, 'global');
  assert.equal(pack.priors.race_outcome.win_rate.direct_effective_sample_size, 2);
  assert.equal(pack.priors.race_outcome.win_rate.direct_sample_size, 6);
  assert.deepEqual(pack.provenance.parameters.levelOrder, ['global']);
});

test('B6 counts a dead heat as one effective race in winner-lane shape priors', async () => {
  const { db, env } = createTestEnv();
  race(db, { id: 'hist-dead-heat', date: '2026-08-01', method: 'auto' });
  threeEntries(db, { raceId: 'hist-dead-heat', placings: [1, 1, 3], fetchedAt: '2026-08-01T14:00:00Z' });
  race(db, { id: 'target', date: '2026-09-20', method: 'auto' });
  threeEntries(db, { raceId: 'target' });

  const pack = (await buildRacePriorsV1ForEntries(env, ['target-e1'], '2026-09-20T11:00:00Z')).get('target-e1');
  const shape = pack.priors.shape.winner_lane_hhi;
  assert.equal(shape.direct_level, 'track_method_distance_field');
  assert.equal(shape.direct_sample_size, 2, 'both official winners are retained as winner observations');
  assert.equal(shape.direct_effective_sample_size, 1, 'one race stays one ESS even with two official winners');
  assert.equal(shape.value, 0.5);
});
