import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  assessTrendReadiness,
  TREND_MIN_ELIGIBLE_ENTITIES,
  TREND_MIN_STARTS,
  TREND_READINESS_VERSION
} from '../src/trend-readiness.js';

function seedHorseWindow(db, { firstDate = '2099-01-01', lastDate = '2099-01-14', scratchedHorse = null } = {}) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('trend_track','Trend Park','SE')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('trend_race_1','trend_track',?,1)`).run(firstDate);
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('trend_race_2','trend_track',?,2)`).run(lastDate);
  for (let index = 1; index <= 10; index += 1) {
    const horseId = `trend_horse_${index}`;
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?,?)`).run(horseId, `Synthetic Trend Horse ${index}`);
    for (const raceNumber of [1, 2]) {
      const entryId = `trend_entry_${raceNumber}_${index}`;
      const scratched = scratchedHorse === index && raceNumber === 2 ? 1 : 0;
      db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?,?,?,?,?)`)
        .run(entryId, `trend_race_${raceNumber}`, horseId, index, scratched);
      db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, result_status) VALUES (?,?,?,'finished')`)
        .run(entryId, index, String(index));
    }
  }
}

test('Trend readiness opens only after the full window and minimum eligible population exist', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db);

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.version, TREND_READINESS_VERSION);
  assert.equal(result.windowStart, '2099-01-01');
  assert.equal(result.minStartsPerEntity, TREND_MIN_STARTS.horses['2w']);
  assert.equal(result.minEligibleEntities, TREND_MIN_ELIGIBLE_ENTITIES);
  assert.equal(result.coverage.fullWindowCovered, true);
  assert.equal(result.entities.eligible, 10);
  assert.equal(result.entities.enough, true);
  assert.equal(result.ready, true);
  assert.equal(result.reason, null);
});

test('Trend readiness fails closed when the requested history window is incomplete', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db, { firstDate: '2099-01-02' });

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.coverage.earliestDate, '2099-01-02');
  assert.equal(result.coverage.fullWindowCovered, false);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'insufficient_history_window');
});

test('scratched declarations do not count toward Trend eligibility denominators', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db, { scratchedHorse: 10 });

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.entities.withResults, 10);
  assert.equal(result.entities.eligible, 9);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'insufficient_eligible_entities');
});

test('Trend readiness contract uses category-specific minimum starts and rejects unsupported inputs', async () => {
  const { env } = createTestEnv();
  assert.equal(TREND_MIN_STARTS.horses['1y'], 12);
  assert.equal(TREND_MIN_STARTS.trainers['1y'], 60);
  assert.equal(TREND_MIN_STARTS.drivers['1y'], 90);
  await assert.rejects(assessTrendReadiness(env, 'owners', '2w', { asOf: '2099-01-14' }), /entityType/);
  await assert.rejects(assessTrendReadiness(env, 'horses', '2y', { asOf: '2099-01-14' }), /period/);
});
