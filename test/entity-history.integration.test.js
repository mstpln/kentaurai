import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getEntityStartHistory } from '../src/routes/entity-history.js';
import { getLinkedHorses } from '../src/routes/entity-links.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_1','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_1','Ada Trainer','SE')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name, country_code) VALUES ('driver_1','Bertil Driver','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name, country_code) VALUES ('horse_1','Alpha Horse','SE'),('horse_2','Beta Horse','SE')`).run();
  for (const [i, date, horse] of [[1,'2099-01-01','horse_1'],[2,'2099-01-02','horse_2'],[3,'2099-01-03','horse_1']]) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES (?, 'track_1', ?, ?, 2140, 'auto')`).run(`race_${i}`, date, i);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_start_distance_m) VALUES (?, ?, ?, 'driver_1', 'trainer_1', ?, 2140)`).run(`entry_${i}`, `race_${i}`, horse, i);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, km_time, gallop, disqualified, result_status) VALUES (?, ?, ?, '14,0', 0, 0, 'official')`).run(`entry_${i}`, i, String(i));
  }
  db.prepare(`INSERT INTO source_records (id, source_type, fetched_at, quality_status) VALUES ('src_x','synthetic','2099-01-02T12:00:00Z','verified')`).run();
  db.prepare(`INSERT INTO xlabs_data (id, race_entry_id, last_200_time, actual_distance_m, extra_distance_m, converted_km_time, slipstream_m, quality_status, source_record_id) VALUES ('xl_1','entry_2','10.7',2152,12,'13,8',700,'verified','src_x')`).run();
}

test('entity start history pages through the complete linked history newest first', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const first = await getEntityStartHistory(env, 'trainers', 'trainer_1', { limit: 2, offset: 0 });
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].race_date, '2099-01-03');
  assert.equal(first.items[1].race_date, '2099-01-02');
  assert.equal(first.items[1].xlabs.last200Time, '10.7');
  assert.equal(first.items[1].xlabs.actualDistanceM, 2152);
  assert.equal('entry_id' in first.items[0], false);
  assert.equal('race_id' in first.items[0], false);

  const second = await getEntityStartHistory(env, 'trainers', 'trainer_1', { limit: 2, offset: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].race_date, '2099-01-01');
  assert.equal(second.hasMore, false);
});

test('linked horse history is complete and paginated independently of start page size', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const first = await getLinkedHorses(env, 'trainers', 'trainer_1', { limit: 1, offset: 0 });
  assert.equal(first.total, 2);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].name, 'Alpha Horse');
  assert.equal(first.items[0].starts, 2);
  assert.equal(first.items[0].latestStartDate, '2099-01-03');
  assert.equal(first.hasMore, true);

  const second = await getLinkedHorses(env, 'trainers', 'trainer_1', { limit: 1, offset: 1 });
  assert.equal(second.items[0].name, 'Beta Horse');
  assert.equal(second.hasMore, false);
});
