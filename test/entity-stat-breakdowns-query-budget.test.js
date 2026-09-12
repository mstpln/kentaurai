import test from 'node:test';
import assert from 'node:assert/strict';

import { getFilteredEntityStatBreakdowns } from '../src/routes/entity-stat-breakdowns.js';
import { createTestEnv } from './helpers/d1.js';

function seed(db) {
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse-budget','Budget Horse')`).run();
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-budget','Budget Track')`).run();
  for (let i = 1; i <= 6; i += 1) {
    const raceId = `budget-race-${i}`;
    const entryId = `budget-entry-${i}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, status) VALUES (?, 'track-budget', ?, ?, ?, ?, ?, 'results')`)
      .run(raceId, `2026-01-${String(i).padStart(2, '0')}`, i, i % 2 ? 1640 : 2140, i % 2 ? 'auto' : 'volt', i % 3 ? 40000 : 120000);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?, ?, 'horse-budget', 1, 0)`)
      .run(entryId, raceId);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, result_status, gallop, prize_sek) VALUES (?, ?, 'official', ?, ?)`)
      .run(entryId, i <= 2 ? i : 4, i === 4 ? 1 : 0, i === 1 ? 50000 : 5000);
  }
}

test('entity breakdowns use one grouped D1 read after the entity lookup', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  let allCalls = 0;
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    const originalAll = statement.all.bind(statement);
    statement.all = async () => {
      allCalls += 1;
      return originalAll();
    };
    return statement;
  };

  const data = await getFilteredEntityStatBreakdowns(env, 'horses', 'horse-budget', {
    year: '2026',
    raceScope: 'all',
    distanceStartMethod: 'all',
    trackStartMethod: 'all'
  });

  assert.equal(allCalls, 1, 'summary, start method, distance and track breakdowns must share one D1 grouped read');
  assert.equal(data.summary.starts, 6);
  assert.equal(data.startMethods.reduce((sum, row) => sum + row.starts, 0), 6);
  assert.equal(data.distances.reduce((sum, row) => sum + row.starts, 0), 6);
  assert.equal(data.tracks.reduce((sum, row) => sum + row.starts, 0), 6);
});
