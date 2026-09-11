import test from 'node:test';
import assert from 'node:assert/strict';

import { getTrackLaneStatsV064 } from '../src/routes/tracks-v064.js';
import {
  HIGHER_PRIZE_THRESHOLD_SEK,
  higherPrizeRaceEvidenceCondition,
  normalizeRaceScope,
  raceScopeCondition,
  stlRaceEvidenceCondition
} from '../src/race-scope.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrack(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, country_code) VALUES ('scope-track','Scope Track','SE')").run();
  const races = [
    { id: 'scope-stl-class', method: 'auto', mainClass: 'Silverdivisionen', raceName: 'Synthetic class race', firstPrize: 135000 },
    { id: 'scope-stl-text', method: 'volt', mainClass: null, raceName: 'STL Speciallopp', firstPrize: 90000 },
    { id: 'scope-league-text', method: 'auto', mainClass: null, raceName: 'Svenska Travligans syntetiska lopp', firstPrize: 80000 },
    { id: 'scope-stl-terms', method: 'auto', mainClass: null, raceName: 'Synthetic terms race', firstPrize: 70000 },
    { id: 'scope-v85-feature', method: 'volt', mainClass: null, raceName: 'Synthetic V85 feature race', firstPrize: 80000 },
    { id: 'scope-high-prize', method: 'auto', mainClass: null, raceName: 'Synthetic high-prize race', firstPrize: 100000 },
    { id: 'scope-gs75', method: 'auto', mainClass: null, raceName: 'Synthetic GS75 race', firstPrize: 35000 },
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
    VALUES ('scope-v85-round', 'V85', '2026-08-01', 'scope-track', 'results'),
           ('scope-gs75-round', 'GS75', '2026-08-01', 'scope-track', 'results')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id)
    VALUES ('scope-v85-round', 1, 'scope-v85-feature'),
           ('scope-gs75-round', 1, 'scope-gs75')`).run();

  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, quality_status)
    VALUES ('scope-official-source', 'official_provider', 'race:scope-stl-terms', 'https://example.test/official-race', '2026-08-01T12:00:00Z', 'normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO normalized_observations
    (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES ('scope-stl-terms-observation', 'race', 'scope-stl-terms', 'scope-official-source', '2026-08-01T12:00:00Z', ?, 'normalized_verified_subset')`)
    .run(JSON.stringify({ terms: ['Svenska Travligans särskilda bestämmelser'] }));
}

test('race level uses verified STL, V75/V85/V86 identity or at least 100k first prize', () => {
  assert.equal(HIGHER_PRIZE_THRESHOLD_SEK, 100000);
  assert.equal(normalizeRaceScope('all'), 'all');
  assert.equal(normalizeRaceScope('high_prize'), 'high_prize');
  assert.equal(normalizeRaceScope('weekday'), 'weekday');
  assert.equal(normalizeRaceScope('stl'), 'stl', 'legacy STL API scope remains readable during transition');

  const stlEvidence = stlRaceEvidenceCondition('r');
  assert.match(stlEvidence, /race_stl_classifications/);
  assert.match(stlEvidence, /normalized_observations/);
  assert.match(stlEvidence, /official_provider/);

  const higherPrizeEvidence = higherPrizeRaceEvidenceCondition('r');
  assert.match(higherPrizeEvidence, /first_prize_sek >= 100000/);
  assert.match(higherPrizeEvidence, /game_legs/);
  assert.match(higherPrizeEvidence, /game_rounds/);
  assert.match(higherPrizeEvidence, /'V75', 'V85', 'V86'/);
  assert.doesNotMatch(higherPrizeEvidence, /GS75/);
  assert.match(raceScopeCondition('weekday'), /^NOT /);
  assert.throws(() => normalizeRaceScope('gs75'), /race scope/);
});

test('Bana separates Högre prissumma from Vardagstrav without promoting GS75 by game identity', async () => {
  const { env, db } = createTestEnv();
  seedTrack(db);

  const all = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'all'
  });
  assert.equal(all.totals.starts, 8);

  const higherPrize = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'high_prize'
  });
  assert.equal(higherPrize.totals.starts, 6, 'STL evidence, V85 identity and 100k+ first prize all qualify');
  assert.equal(higherPrize.filters.raceScope, 'high_prize');

  const weekday = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekday.totals.starts, 2, 'GS75 at 35k and ordinary low-prize racing remain Vardagstrav');

  const weekdayVolt = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'volt', distanceGroup: '2140', raceScope: 'weekday'
  });
  assert.equal(weekdayVolt.totals.starts, 0, 'the 80k V85 race qualifies through V85 identity');

  const legacyStl = await getTrackLaneStatsV064(env, 'scope-track', {
    year: '2026', startMethod: 'all', distanceGroup: '2140', raceScope: 'stl'
  });
  assert.equal(legacyStl.totals.starts, 4, 'legacy STL-only API scope keeps its original deterministic meaning');
});
