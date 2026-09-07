import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getEntityDetail, getEntitySummary, listEntities, searchEntities } from '../src/routes/entities.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_1','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_1','Ada Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainer_external_ids (trainer_id, source_type, external_id) VALUES ('trainer_1','official','tr_001')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name, country_code, home_track_id) VALUES ('driver_1','Bertil Driver','SE','track_1')`).run();
  db.prepare(`INSERT INTO driver_external_ids (driver_id, source_type, external_id) VALUES ('driver_1','official','dr_001')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name, sex, owner, current_trainer_id, home_track_id, country_code, career_earnings_sek) VALUES ('horse_1','Comet Horse','gelding','Synthetic Owner','trainer_1','track_1','SE',123456)`).run();
  db.prepare(`INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES ('horse_1','official','ho_001')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_1','track_1','2099-01-02',1,2140,'auto')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, actual_start_distance_m) VALUES ('entry_1','race_1','horse_1','driver_1','trainer_1',3,3,2140)`).run();
}

test('entity summary and search expose normalized read-only data', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const summary = await getEntitySummary(env);
  assert.deepEqual(summary.counts, { horses: 1, trainers: 1, drivers: 1, races: 1, entries: 1, results: 0 });
  assert.equal(summary.trends.available, false);

  const matches = await searchEntities(env, 'Trainer');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'trainer');
  assert.equal(matches[0].name, 'Ada Trainer');
});

test('entity lists and details preserve factual nulls when results are unavailable', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const horses = await listEntities(env, 'horses');
  assert.equal(horses.items.length, 1);
  assert.equal(horses.items[0].external_id, 'ho_001');

  const horse = await getEntityDetail(env, 'horses', 'horse_1');
  assert.equal(horse.entity.name, 'Comet Horse');
  assert.equal(horse.entity.trainer_name, 'Ada Trainer');
  assert.equal(horse.entity.career_earnings_sek, 123456);
  assert.equal(horse.starts[0].placing, null);

  const trainer = await getEntityDetail(env, 'trainers', 'trainer_1');
  assert.equal(trainer.stats.starts, 0);
  assert.equal(trainer.stats.winRate, null);
  assert.equal(trainer.starts[0].horse_name, 'Comet Horse');
});
