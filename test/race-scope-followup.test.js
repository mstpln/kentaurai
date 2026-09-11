import test from 'node:test';
import assert from 'node:assert/strict';

import { getTrackLaneStatsV064 } from '../src/routes/tracks-v064.js';
import { normalizeRaceScope, raceScopeCondition } from '../src/race-scope.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrack(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, country_code) VALUES ('scope-track','Scope Track','SE')").run();
  const races = [
    ['scope-stl-auto', 'auto', 'Silverdivisionen'],
    ['scope-ordinary-volt', 'volt', null]
  ];
  let index = 0;
  for (const [raceId, startMethod, mainClass] of races) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, main_class, status)
      VALUES (?, 'scope-track', '2026-08-01', ?, 2140, ?, ?, 'results')`).run(raceId, ++index, startMethod, mainClass);
    const horseId = `scope-horse-${index}`;
    const entryId = `scope-entry-${index}`;
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Scope Horse ${index}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_lane, scratched)
      VALUES (?, ?, ?, 1, 1, 0)`).run(entryId, raceId, horseId);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, gallop, result_status)
      VALUES (?, 1, 0, 'official')`).run(entryId);
  }
}

test('race scope is explicit STL classification, not prize or game inference', () => {
  assert.equal(normalizeRaceScope('all'), 'all');
  assert.equal(normalizeRaceScope('stl'), 'stl');
  assert.equal(normalizeRaceScope('weekday'), 'weekday');
  assert.match(raceScopeCondition('stl'), /EXISTS/);
  assert.match(raceScopeCondition('weekday'), /NOT EXISTS/);
  assert.throws(() => normalizeRaceScope('v85'), /race scope/);
});

test('Bana All data start method spans auto and volt and combines with race scope', async () => {
  const { env, db } = createTestEnv();
  seedTrack(db);

  const all = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'all'
  });
  assert.equal(all.totals.starts, 2);
  assert.equal(all.filters.startMethod, 'all');

  const stl = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'stl'
  });
  assert.equal(stl.totals.starts, 1);

  const weekday = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekday.totals.starts, 1);

  const weekdayVolt = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'volt', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekdayVolt.totals.starts, 1);
});
