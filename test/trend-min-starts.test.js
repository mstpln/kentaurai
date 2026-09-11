import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestEnv } from './helpers/d1.js';
import { getTrendLeaderboard } from '../src/statistics/trend.js';
import { enhanceTrendHtml } from '../src/trend-ui.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-a','Bana A')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name) VALUES ('driver-a','Kusk A')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-a','Tränare A')`).run();
  for (const [id, name] of [['horse-one','En Start'],['horse-three','Tre Starter']]) {
    db.prepare('INSERT INTO horses (id, canonical_name, breed) VALUES (?, ?, ?)').run(id, name, 'varmblodig travare');
  }
  for (let i = 1; i <= 3; i += 1) {
    const raceId = `race-${i}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, source_quality)
      VALUES (?, 'track-a', '2026-09-10', ?, 2140, 'auto', 50000, 'verified')`).run(raceId, i);
    const horseId = i === 1 ? 'horse-one' : 'horse-three';
    const entryId = `entry-${i}`;
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, scratched, data_quality)
      VALUES (?, ?, ?, 'driver-a', 'trainer-a', 0, 'verified')`).run(entryId, raceId, horseId);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, prize_sek, gallop, disqualified, result_status)
      VALUES (?, 1, 1000, 0, 0, 'official')`).run(entryId);
  }
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, source_quality)
    VALUES ('race-4', 'track-a', '2026-09-09', 4, 2140, 'auto', 50000, 'verified')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, scratched, data_quality)
    VALUES ('entry-4', 'race-4', 'horse-three', 'driver-a', 'trainer-a', 0, 'verified')`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, prize_sek, gallop, disqualified, result_status)
    VALUES ('entry-4', 4, 0, 0, 0, 'official')`).run();
}

test('Trend minimum-starts filter prevents a one-start 100% entity from dominating', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  const base = { category: 'horses', period: '2w', asOfDate: '2026-09-11' };

  const all = await getTrendLeaderboard(env, base);
  assert.equal(all.items[0].id, 'horse-one');
  assert.equal(all.items[0].starts, 1);
  assert.equal(all.items[0].winRate, 1);

  const minimumThree = await getTrendLeaderboard(env, { ...base, minStarts: '3' });
  assert.deepEqual(minimumThree.items.map((item) => item.id), ['horse-three']);
  assert.equal(minimumThree.items[0].starts, 3);
  assert.equal(minimumThree.filters.minStarts, 3);

  const minimumFive = await getTrendLeaderboard(env, { ...base, minStarts: '5' });
  assert.deepEqual(minimumFive.items, []);
});

test('Trend minimum-starts input is a closed enum', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  await assert.rejects(
    () => getTrendLeaderboard(env, { category: 'horses', period: '2w', asOfDate: '2026-09-11', minStarts: '2' }),
    /min_starts must be/
  );
});

test('Trend UI exposes and sends the minimum-starts filter', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  assert.match(html, /Minsta antal starter/);
  assert.match(html, /Minst 3/);
  assert.match(html, /Minst 20/);
  assert.match(html, /min_starts:f\.minStarts/);
  assert.match(html, /minStarts:'all'/);
});
