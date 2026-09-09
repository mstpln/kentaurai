import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { calculateClassExposureFeatures, persistClassExposureFeatures } from '../src/features/class-exposure.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('class_track','Class Park','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('class_horse','Synthetic Class Horse')`).run();
  const history = [
    ['2099-01-01', 20000, 1, 20000],
    ['2099-01-05', 30000, 4, 4000],
    ['2099-01-10', 40000, 2, 20000],
    ['2099-01-15', 50000, 6, 3000],
    ['2099-01-20', 60000, 3, 15000],
    ['2099-01-25', 80000, 1, 80000]
  ];
  history.forEach(([date, firstPrize, placing, earned], index) => {
    const n = index + 1;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, first_prize_sek) VALUES (?, 'class_track', ?, ?, ?, ?)`).run(`class_race_${n}`, date, n, `${date}T12:00:00Z`, firstPrize);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES (?, ?, 'class_horse', 1)`).run(`class_entry_${n}`, `class_race_${n}`);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, prize_sek, result_status) VALUES (?, ?, ?, ?, 'finished')`).run(`class_entry_${n}`, placing, String(placing), earned);
  });
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, first_prize_sek) VALUES ('class_target_race','class_track','2099-02-01',1,'2099-02-01T18:00:00Z',100000)`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('class_target','class_target_race','class_horse',4)`).run();
}

test('class exposure uses factual advertised first prizes and actual prior earnings', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const result = await calculateClassExposureFeatures(env, 'class_target');
  assert.equal(result.sampleSize, 6);
  assert.equal(result.knownClassPrizeCount, 6);
  assert.equal(result.dataQuality, 'sufficient');
  assert.equal(result.features.class_starts_10, 6);
  assert.equal(result.features.class_wins_10, 2);
  assert.equal(result.features.class_max_first_prize_10, 80000);
  assert.equal(result.features.class_avg_first_prize_10, 46666.666666666664);
  assert.equal(result.features.class_prize_earnings_10, 142000);
  assert.equal(result.features.class_target_first_prize, 100000);
  assert.equal(result.features.class_target_vs_max_prize_ratio, 1.25);
});

test('unknown first-prize facts remain null rather than being inferred', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`UPDATE races SET first_prize_sek = NULL WHERE id LIKE 'class_race_%' OR id='class_target_race'`).run();
  const result = await calculateClassExposureFeatures(env, 'class_target');
  assert.equal(result.knownClassPrizeCount, 0);
  assert.equal(result.dataQuality, 'limited');
  assert.equal(result.features.class_max_first_prize_10, null);
  assert.equal(result.features.class_avg_first_prize_10, null);
  assert.equal(result.features.class_target_first_prize, null);
  assert.equal(result.features.class_target_vs_max_prize_ratio, null);
});

test('class snapshots are pre-race, immutable and idempotent', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  await assert.rejects(calculateClassExposureFeatures(env, 'class_target', { asOf: '2099-02-01T19:00:00Z' }), /cannot be after/);
  const first = await persistClassExposureFeatures(env, 'class_target');
  const second = await persistClassExposureFeatures(env, 'class_target');
  assert.equal(first.writes, 7);
  assert.equal(second.writes, 0);
  const rows = db.prepare(`SELECT * FROM analysis_features WHERE race_entry_id='class_target' AND feature_version='class-exposure-v1'`).all();
  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => JSON.parse(row.provenance_json).knownClassPrizeCount === 6));
});
