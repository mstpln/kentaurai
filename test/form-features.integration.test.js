import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { calculateHorseFormFeatures, persistHorseFormFeatures } from '../src/features/form.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('form_track','Form Park','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('form_horse','Synthetic Form Horse')`).run();
  const history = [
    ['2099-01-01', 1, 0, 0],
    ['2099-01-05', 4, 1, 0],
    ['2099-01-10', 2, 0, 0],
    ['2099-01-15', 7, 0, 1],
    ['2099-01-20', 3, 0, 0],
    ['2099-01-25', 1, 0, 0]
  ];
  history.forEach(([date, placing, gallop, disqualified], index) => {
    const n = index + 1;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at) VALUES (?, 'form_track', ?, ?, ?)`).run(`form_race_${n}`, date, n, `${date}T12:00:00Z`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES (?, ?, 'form_horse', 1)`).run(`form_entry_${n}`, `form_race_${n}`);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, gallop, disqualified, result_status) VALUES (?, ?, ?, ?, ?, 'finished')`).run(`form_entry_${n}`, placing, String(placing), gallop, disqualified);
  });
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at) VALUES ('form_target_race','form_track','2099-02-01',1,'2099-02-01T18:00:00Z')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('form_target','form_target_race','form_horse',4)`).run();
}

test('horse form uses only the five latest factual prior starts', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const result = await calculateHorseFormFeatures(env, 'form_target');
  assert.equal(result.sampleSize, 5);
  assert.equal(result.dataQuality, 'sufficient');
  assert.equal(result.features.form_starts_5, 5);
  assert.equal(result.features.form_wins_5, 1);
  assert.equal(result.features.form_top3_5, 3);
  assert.equal(result.features.form_avg_placing_5, 3.4);
  assert.equal(result.features.form_gallops_5, 1);
  assert.equal(result.features.form_disqualifications_5, 1);
  assert.equal(result.features.form_days_since_last_start, 7);
});

test('future results cannot leak into an earlier as-of calculation', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at) VALUES ('form_future_race','form_track','2099-02-02',2,'2099-02-02T12:00:00Z')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('form_future_entry','form_future_race','form_horse',2)`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, result_status) VALUES ('form_future_entry',1,'1','finished')`).run();
  const result = await calculateHorseFormFeatures(env, 'form_target');
  assert.equal(result.features.form_wins_5, 1);
  assert.equal(result.features.form_days_since_last_start, 7);
});

test('persisted form features are immutable and idempotent for the same snapshot', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const first = await persistHorseFormFeatures(env, 'form_target');
  const second = await persistHorseFormFeatures(env, 'form_target');
  assert.equal(first.writes, 7);
  assert.equal(second.writes, 0);
  const rows = db.prepare(`SELECT feature_name, numeric_value, data_quality, provenance_json FROM analysis_features WHERE race_entry_id='form_target' ORDER BY feature_name`).all();
  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.data_quality === 'sufficient'));
  assert.ok(rows.every((row) => JSON.parse(row.provenance_json).sampleSize === 5));
});

test('missing history stays factual and unavailable instead of being invented', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('empty_track','Empty Park','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('empty_horse','No History Horse')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('empty_race','empty_track','2099-03-01',1)`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('empty_entry','empty_race','empty_horse',1)`).run();
  const result = await calculateHorseFormFeatures(env, 'empty_entry');
  assert.equal(result.sampleSize, 0);
  assert.equal(result.dataQuality, 'unavailable');
  assert.equal(result.features.form_starts_5, 0);
  assert.equal(result.features.form_avg_placing_5, null);
  assert.equal(result.features.form_days_since_last_start, null);
});
