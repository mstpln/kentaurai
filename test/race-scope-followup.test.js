import test from 'node:test';
import assert from 'node:assert/strict';

import { getTrackLaneStatsV064 } from '../src/routes/tracks-v064.js';
import { normalizeRaceScope, raceScopeCondition, stlRaceEvidenceCondition } from '../src/race-scope.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrack(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, country_code) VALUES ('scope-track','Scope Track','SE')").run();
  const races = [
    { id: 'scope-stl-class', method: 'auto', mainClass: 'Silverdivisionen', raceName: 'Synthetic class race', firstPrize: 135000 },
    { id: 'scope-stl-text', method: 'volt', mainClass: null, raceName: 'STL Speciallopp', firstPrize: 90000 },
    { id: 'scope-league-text', method: 'auto', mainClass: null, raceName: 'Svenska Travligans syntetiska lopp', firstPrize: 80000 },
    { id: 'scope-v85-feature', method: 'volt', mainClass: null, raceName: 'Synthetic feature race', firstPrize: 250000 },
    { id: 'scope-hastlopp', method: 'auto', mainClass: null, raceName: 'Hästloppet', firstPrize: 20000 }
  ];
  let index = 0;
  for (const race of races) {
    db.prepare(`INSERT INTO races
      (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, race_name, main_class, status)
      VALUES (?, 'scope-track', '2026-08-01', ?, 2140, ?, ?, ?, ?, 'results')`)
      .run(race.id, ++index, race.method, race.firstPrize, race.raceName, race.mainClass);
    const horseId = `scope-horse-${index}`;
    const entryId = `scope-entry-${index}`;
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Scope Horse ${index}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_lane, scratched)
      VALUES (?, ?, ?, 1, 1, 0)`).run(entryId, race.id, horseId);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, gallop, result_status)
      VALUES (?, 1, 0, 'official')`).run(entryId);
  }

  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, primary_track_id, status)
    VALUES ('scope-v85-round', 'V85', '2026-08-01', 'scope-track', 'results')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id)
    VALUES ('scope-v85-round', 1, 'scope-v85-feature')`).run();
}

test('race scope uses persisted STL class or explicit official STL text, never prize or game identity', () => {
  assert.equal(normalizeRaceScope('all'), 'all');
  assert.equal(normalizeRaceScope('stl'), 'stl');
  assert.equal(normalizeRaceScope('weekday'), 'weekday');
  const evidence = stlRaceEvidenceCondition('r');
  assert.match(evidence, /race_stl_classifications/);
  assert.match(evidence, /race_name/);
  assert.match(evidence, /main_class/);
  assert.match(evidence, /class_flags_json/);
  assert.match(evidence, /SVENSKA TRAVLIGAN/);
  assert.match(evidence, / STL /);
  assert.doesNotMatch(evidence, /first_prize|game_round|game_leg/i);
  assert.match(raceScopeCondition('weekday'), /^NOT /);
  assert.throws(() => normalizeRaceScope('v85'), /race scope/);
});

test('Bana race scope recognizes explicit STL facts without treating every V85 or high-prize race as STL', async () => {
  const { env, db } = createTestEnv();
  seedTrack(db);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM race_stl_classifications WHERE race_id = 'scope-stl-class'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM race_stl_classifications WHERE race_id = 'scope-stl-text'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM race_stl_classifications WHERE race_id = 'scope-league-text'").get().n, 0);

  const all = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'all'
  });
  assert.equal(all.totals.starts, 5);
  assert.equal(all.filters.startMethod, 'all');

  const stl = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'stl'
  });
  assert.equal(stl.totals.starts, 3);

  const weekday = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekday.totals.starts, 2, 'high-prize V85 race and ordinary Hästlopp remain non-STL without explicit STL evidence');

  const weekdayVolt = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'volt', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekdayVolt.totals.starts, 1, 'V85 game identity alone must not classify the feature race as STL');
});
