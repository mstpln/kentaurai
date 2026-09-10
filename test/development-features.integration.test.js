import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { calculateDevelopmentFeatures, persistDevelopmentFeatures } from '../src/features/development.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('dev_track','Development Park','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('dev_horse','Synthetic Development Horse')`).run();
  const history = [
    ['2099-01-01', 20000, 7, 1000, 1, 0],
    ['2099-01-05', 30000, 5, 2000, 0, 0],
    ['2099-01-10', 40000, 4, 3000, 0, 0],
    ['2099-01-15', 50000, 3, 10000, 0, 0],
    ['2099-01-20', 60000, 2, 30000, 0, 0],
    ['2099-01-25', 80000, 1, 80000, 0, 0]
  ];
  history.forEach(([date, firstPrize, placing, earned, gallop, disqualified], index) => {
    const n = index + 1;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, first_prize_sek) VALUES (?, 'dev_track', ?, ?, ?, ?)`).run(`dev_race_${n}`, date, n, `${date}T12:00:00Z`, firstPrize);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES (?, ?, 'dev_horse', 1)`).run(`dev_entry_${n}`, `dev_race_${n}`);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, prize_sek, gallop, disqualified, result_status) VALUES (?, ?, ?, ?, ?, ?, 'finished')`).run(`dev_entry_${n}`, placing, String(placing), earned, gallop, disqualified);
  });
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, first_prize_sek) VALUES ('dev_target_race','dev_track','2099-02-01',1,'2099-02-01T18:00:00Z',100000)`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('dev_target','dev_target_race','dev_horse',4)`).run();
}

test('development compares the latest three factual starts with the preceding three', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const result = await calculateDevelopmentFeatures(env, 'dev_target');
  assert.equal(result.sampleSize, 6);
  assert.equal(result.dataQuality, 'sufficient');
  assert.equal(result.features.development_recent_avg_placing_3, 2);
  assert.equal(result.features.development_previous_avg_placing_3, 16 / 3);
  assert.equal(result.features.development_avg_placing_delta, 2 - 16 / 3);
  assert.equal(result.features.development_recent_top3_rate_3, 1);
  assert.equal(result.features.development_previous_top3_rate_3, 0);
  assert.equal(result.features.development_top3_rate_delta, 1);
  assert.equal(result.features.development_recent_avg_first_prize_3, 190000 / 3);
  assert.equal(result.features.development_previous_avg_first_prize_3, 30000);
  assert.equal(result.features.development_class_exposure_ratio, (190000 / 3) / 30000);
  assert.equal(result.features.development_recent_earnings_3, 120000);
  assert.equal(result.features.development_previous_earnings_3, 6000);
  assert.equal(result.features.development_earnings_ratio, 20);
});

test('development refuses post-race as-of snapshots and future results do not leak', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, first_prize_sek) VALUES ('dev_future_race','dev_track','2099-02-02',2,'2099-02-02T12:00:00Z',500000)`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('dev_future_entry','dev_future_race','dev_horse',2)`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, prize_sek, result_status) VALUES ('dev_future_entry',1,'1',500000,'finished')`).run();
  const result = await calculateDevelopmentFeatures(env, 'dev_target');
  assert.equal(result.sampleSize, 6);
  assert.equal(result.features.development_recent_earnings_3, 120000);
  await assert.rejects(calculateDevelopmentFeatures(env, 'dev_target', { asOf: '2099-02-01T19:00:00Z' }), /cannot be after/);
});

test('unknown class facts stay null and partial samples are marked limited', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`UPDATE races SET first_prize_sek = NULL WHERE id IN ('dev_race_4','dev_race_5','dev_race_6')`).run();
  const result = await calculateDevelopmentFeatures(env, 'dev_target', { asOf: '2099-01-18T00:00:00Z' });
  assert.equal(result.dataQuality, 'limited');
  assert.equal(result.sampleSize, 4);
  assert.equal(result.features.development_recent_avg_first_prize_3, 35000);
  assert.equal(result.features.development_previous_avg_first_prize_3, 20000);
  const full = await calculateDevelopmentFeatures(env, 'dev_target');
  assert.equal(full.features.development_recent_avg_first_prize_3, null);
  assert.equal(full.features.development_class_exposure_ratio, null);
});

test('development snapshots persist immutably and idempotently', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const first = await persistDevelopmentFeatures(env, 'dev_target');
  const second = await persistDevelopmentFeatures(env, 'dev_target');
  assert.equal(first.writes, 16);
  assert.equal(second.writes, 0);
  const rows = db.prepare(`SELECT * FROM analysis_features WHERE race_entry_id='dev_target' AND feature_version='development-v1'`).all();
  assert.equal(rows.length, 16);
  assert.ok(rows.every((row) => JSON.parse(row.provenance_json).sampleSize === 6));
});
