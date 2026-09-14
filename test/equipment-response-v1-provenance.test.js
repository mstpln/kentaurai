import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildEquipmentResponseV1ForEntries } from '../src/equipment-response-v1.js';

function source(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
              VALUES (?, 'official_provider', ?, ?, 'normalized_verified_subset')`).run(id, id, fetchedAt);
}

function entry(db, { key, date, placing = null, target = false }) {
  db.prepare(`INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES ('track-a', 'Track A')`).run();
  db.prepare(`INSERT OR IGNORE INTO horses (id, canonical_name) VALUES ('horse-a', 'Horse A')`).run();
  db.prepare(`INSERT OR IGNORE INTO trainers (id, canonical_name) VALUES ('trainer-a', 'Trainer A')`).run();
  const raceId = `race-${key}`;
  const entryId = `entry-${key}`;
  db.prepare(`INSERT INTO races
    (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status, source_quality)
    VALUES (?, 'track-a', ?, 1, ?, 2140, 'auto', 'scheduled', 'normalized_verified_subset')`)
    .run(raceId, date, `${date}T12:00:00Z`);
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, trainer_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, 'horse-a', 'trainer-a', 1, 1, 0, 2140, 0, 'synthetic')`).run(entryId, raceId);
  if (!target) {
    const resultSource = `result-source-${key}`;
    source(db, resultSource, `${date}T14:00:00Z`);
    db.prepare(`INSERT INTO race_results
      (race_entry_id, placing, gallop, disqualified, result_status, source_record_id)
      VALUES (?, ?, 0, 0, 'official', ?)`).run(entryId, placing, resultSource);
  }
  return entryId;
}

function equipment(db, entryId, key, date, { changed = false, barefoot = false } = {}) {
  const sourceId = `equipment-source-${key}`;
  source(db, sourceId, `${date}T11:00:00Z`);
  const change = changed ? {
    shoesFrontChanged: true,
    shoesRearChanged: false,
    sulkyTypeChanged: false,
    sulkyColourChanged: false
  } : null;
  db.prepare(`INSERT INTO equipment
    (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear,
     sulky_type, change_from_previous_json, verification_status, source_record_id)
    VALUES (?, ?, ?, 'shod', ?, 0, ?, ?, 'reported', ?)`)
    .run(`equipment-${key}`, entryId, barefoot ? 'barefoot' : 'shod', Number(barefoot), barefoot ? 'bike' : 'standard', change ? JSON.stringify(change) : null, sourceId);
}

test('B4 family provenance includes comparison-baseline facts used by deltas and backoff', async () => {
  const { db, env } = createTestEnv();
  const changed = entry(db, { key: 'changed', date: '2026-09-10', placing: 1 });
  equipment(db, changed, 'changed', '2026-09-10', { changed: true, barefoot: true });
  const baseline = entry(db, { key: 'baseline', date: '2026-09-01', placing: 5 });
  equipment(db, baseline, 'baseline', '2026-09-01', { barefoot: false });
  const target = entry(db, { key: 'target', date: '2026-09-20', target: true });
  equipment(db, target, 'target', '2026-09-20', { changed: true, barefoot: true });

  const result = (await buildEquipmentResponseV1ForEntries(env, [target], '2026-09-20T13:00:00Z')).get(target);
  const sourceIds = new Set(result.provenance.source_refs.map((ref) => ref.source_record_id));

  assert.equal(result.samples.sameChangeTypeStarts, 1);
  assert.equal(result.samples.changeBaselineStarts, 1);
  assert.equal(result.samples.changeBaselinePlacingSamples, 1);
  assert.ok(sourceIds.has('result-source-changed'));
  assert.ok(sourceIds.has('equipment-source-changed'));
  assert.ok(sourceIds.has('result-source-baseline'));
  assert.ok(sourceIds.has('equipment-source-baseline'));
  assert.ok(sourceIds.has('equipment-source-target'));
});
