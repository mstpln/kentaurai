import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  assessTrendReadiness,
  TREND_MIN_ELIGIBLE_ENTITIES,
  TREND_MIN_STARTS,
  TREND_READINESS_VERSION
} from '../src/trend-readiness.js';

function seedHorseWindow(db, { scratchedHorse = null, coveredThroughStart = true } = {}) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('trend_track','Trend Park','SE')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('trend_race_1','trend_track','2099-01-01',1)`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('trend_race_2','trend_track','2099-01-14',2)`).run();
  for (let index = 1; index <= 10; index += 1) {
    const horseId = `trend_horse_${index}`;
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?,?)`).run(horseId, `Synthetic Trend Horse ${index}`);
    for (const raceNumber of [1, 2]) {
      const entryId = `trend_entry_${raceNumber}_${index}`;
      const scratched = scratchedHorse === index && raceNumber === 2 ? 1 : 0;
      db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?,?,?,?,?)`)
        .run(entryId, `trend_race_${raceNumber}`, horseId, index, scratched);
      db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, result_status) VALUES (?,?,?,'official')`)
        .run(entryId, index, String(index));
    }
  }
  db.prepare(`
    INSERT INTO historical_backfill_jobs (id,start_date,end_date,next_date,status)
    VALUES ('trend_coverage','2099-01-01','2099-01-14',?, 'running')
  `).run(coveredThroughStart ? '2098-12-31' : '2099-01-05');
}

test('Trend readiness opens only after every requested date and the minimum eligible population are verified', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db);

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.version, TREND_READINESS_VERSION);
  assert.equal(result.windowStart, '2099-01-01');
  assert.equal(result.minStartsPerEntity, TREND_MIN_STARTS.horses['2w']);
  assert.equal(result.minEligibleEntities, TREND_MIN_ELIGIBLE_ENTITIES);
  assert.equal(result.coverage.requiredDays, 14);
  assert.equal(result.coverage.coveredDays, 14);
  assert.equal(result.coverage.fullWindowCovered, true);
  assert.equal(result.coverage.earliestResultDate, '2099-01-01');
  assert.equal(result.coverage.latestResultDate, '2099-01-14');
  assert.equal(result.entities.eligible, 10);
  assert.equal(result.entities.enough, true);
  assert.equal(result.ready, true);
  assert.equal(result.reason, null);
});

test('Trend readiness fails closed when stored results exist but verified import coverage has not reached the full window', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db, { coveredThroughStart: false });

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.coverage.earliestResultDate, '2099-01-01');
  assert.equal(result.coverage.latestResultDate, '2099-01-14');
  assert.equal(result.coverage.coveredDays, 9);
  assert.equal(result.coverage.fullWindowCovered, false);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'insufficient_verified_date_coverage');
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

test('non-official result rows do not make an entity Trend-eligible', async () => {
  const { env, db } = createTestEnv();
  seedHorseWindow(db);
  db.prepare(`UPDATE race_results SET result_status='synthetic_other' WHERE race_entry_id='trend_entry_2_10'`).run();

  const result = await assessTrendReadiness(env, 'horses', '2w', { asOf: '2099-01-14' });
  assert.equal(result.entities.eligible, 9);
  assert.equal(result.ready, false);
});

test('Trend readiness contract uses category-specific minimum starts and rejects unsupported inputs', async () => {
  const { env } = createTestEnv();
  assert.equal(TREND_MIN_STARTS.horses['1y'], 12);
  assert.equal(TREND_MIN_STARTS.trainers['1y'], 60);
  assert.equal(TREND_MIN_STARTS.drivers['1y'], 90);
  await assert.rejects(assessTrendReadiness(env, 'owners', '2w', { asOf: '2099-01-14' }), /entityType/);
  await assert.rejects(assessTrendReadiness(env, 'horses', '2y', { asOf: '2099-01-14' }), /period/);
});
