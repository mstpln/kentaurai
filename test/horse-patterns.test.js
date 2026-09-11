import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareAnalysisContext } from '../src/analysis-api.js';
import { enhanceHorsePatternsHtml } from '../src/horse-patterns-ui.js';
import { getHorseRelevantPatterns, getHorseRelevantPatternsBatch } from '../src/statistics/horse-patterns.js';
import { createTestEnv } from './helpers/d1.js';

function xlabsSource(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES (?, 'xlabs_race_json', ?, 'normalized_verified_subset')`).run(id, fetchedAt);
}

function officialSource(db, id, fetchedAt, quality = 'normalized_verified_subset') {
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES (?, 'official_provider', ?, ?)`).run(id, fetchedAt, quality);
}

function horse(db, id, name) {
  db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(id, name);
}

function raceWithResult(db, { raceId, horseId, date, number, placing = 2 }) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code)
    VALUES ('pattern-track', 'Testbanan', 'SE') ON CONFLICT(id) DO NOTHING`).run();
  db.prepare(`INSERT INTO races
    (id, track_id, race_date, race_number, distance_m, start_method, status)
    VALUES (?, 'pattern-track', ?, ?, 2140, 'auto', 'results')`).run(raceId, date, number);
  const entryId = `entry-${raceId}-${horseId}`;
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, start_number, actual_lane, scratched)
    VALUES (?, ?, ?, 1, 1, 0)`).run(entryId, raceId, horseId);
  db.prepare(`INSERT INTO race_results
    (race_entry_id, placing, result_status)
    VALUES (?, ?, 'official')`).run(entryId, placing);
  return entryId;
}

test('horse patterns summarize only relevant verified facts with an as-of cutoff', async () => {
  const { env, db } = createTestEnv();
  horse(db, 'h1', 'Testhästen');
  const entry1 = raceWithResult(db, { raceId: 'r1', horseId: 'h1', date: '2026-08-01', number: 1 });
  const entry2 = raceWithResult(db, { raceId: 'r2', horseId: 'h1', date: '2026-08-10', number: 2 });
  xlabsSource(db, 'x1', '2026-08-01T20:00:00Z');
  xlabsSource(db, 'x2', '2026-08-10T20:00:00Z');
  officialSource(db, 'p-source-1', '2026-08-01T08:00:00Z');
  officialSource(db, 'p-source-2', '2026-08-10T08:00:00Z');
  db.prepare(`INSERT INTO xlabs_data
    (id, race_entry_id, first_200_time, last_400_time, extra_distance_m, quality_status, source_record_id)
    VALUES ('xrow1', ?, '1.12,0', '1.11,0', 8, 'xlabs-telemetry-v1', 'x1')`).run(entry1);
  db.prepare(`INSERT INTO xlabs_data
    (id, race_entry_id, first_200_time, last_400_time, extra_distance_m, quality_status, source_record_id)
    VALUES ('xrow2', ?, '1.10,0', '1.09,0', 12, 'xlabs-telemetry-v1', 'x2')`).run(entry2);

  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('p1','h1',900,'2026-08-01T08:00:00Z','p-source-1')`).run();
  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('p2','h1',1100,'2026-08-10T08:00:00Z','p-source-2')`).run();
  officialSource(db, 'future-source', '2026-09-20T08:00:00Z');
  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('p3','h1',1500,'2026-09-20T08:00:00Z','future-source')`).run();

  const pattern = await getHorseRelevantPatterns(env, 'h1', '2026-09-01');
  assert.equal(pattern.startPoints.current.points, 1100);
  assert.equal(pattern.startPoints.latestChange.points, 200);
  assert.equal(pattern.startPoints.latestChange.direction, 'up');
  assert.equal(pattern.xlabs.measuredStarts, 2);
  assert.equal(pattern.xlabs.openingPace.averageSecondsPerKm, 71);
  assert.equal(pattern.xlabs.closingPace.averageSecondsPerKm, 70);
  assert.equal(pattern.xlabs.extraDistance.averageMeters, 10);
});

test('horse patterns ignore unverified or wrong-source observations', async () => {
  const { env, db } = createTestEnv();
  horse(db, 'h1', 'Testhästen');
  officialSource(db, 'verified', '2026-08-01T08:00:00Z');
  officialSource(db, 'captured-only', '2026-08-02T08:00:00Z', 'captured_unmapped');
  xlabsSource(db, 'wrong-source-for-points', '2026-08-03T08:00:00Z');
  for (const [id, points, sourceId, observedAt] of [
    ['p1', 800, 'verified', '2026-08-01T08:00:00Z'],
    ['p2', 1200, 'captured-only', '2026-08-02T08:00:00Z'],
    ['p3', 1500, 'wrong-source-for-points', '2026-08-03T08:00:00Z']
  ]) {
    db.prepare(`INSERT INTO horse_start_points (id,horse_id,points,observed_at,source_record_id)
      VALUES (?, 'h1', ?, ?, ?)`).run(id, points, observedAt, sourceId);
  }
  const pattern = await getHorseRelevantPatterns(env, 'h1', '2026-09-01');
  assert.equal(pattern.startPoints.current.points, 800);
});

test('market-blind AI context receives factual horse patterns, ranks Start Points within each leg and excludes market fields', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('round-track','Testbanan','SE')`).run();
  db.prepare(`INSERT INTO game_rounds
    (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES ('round-pattern','V85','2099-01-01','2099-01-01T12:00:00Z','2099-01-01T11:55:00Z','upcoming')`).run();
  officialSource(db, 'points-round', '2098-12-31T08:00:00Z');

  for (let leg = 1; leg <= 8; leg += 1) {
    const horseId = `round-h${leg}`;
    const raceId = `round-r${leg}`;
    const entryId = `round-e${leg}`;
    horse(db, horseId, `Häst ${leg}`);
    db.prepare(`INSERT INTO races
      (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status)
      VALUES (?, 'round-track', '2099-01-01', ?, ?, 2140, 'auto', 'upcoming')`)
      .run(raceId, leg, `2099-01-01T${String(12 + Math.floor((leg - 1) / 2)).padStart(2, '0')}:${leg % 2 ? '00' : '30'}:00Z`);
    db.prepare('INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?,?,?)').run('round-pattern', leg, raceId);
    db.prepare(`INSERT INTO race_entries
      (id, race_id, horse_id, start_number, actual_lane, scratched)
      VALUES (?, ?, ?, 1, 1, 0)`).run(entryId, raceId, horseId);
    db.prepare(`INSERT INTO horse_start_points
      (id, horse_id, points, observed_at, source_record_id)
      VALUES (?, ?, ?, '2098-12-31T08:00:00Z', 'points-round')`).run(`round-p${leg}`, horseId, 1000 - leg * 10);
  }

  horse(db, 'round-h1b', 'Häst 1B');
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, start_number, actual_lane, scratched)
    VALUES ('round-e1b', 'round-r1', 'round-h1b', 2, 2, 0)`).run();
  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('round-p1b', 'round-h1b', 700, '2098-12-31T08:00:00Z', 'points-round')`).run();

  horse(db, 'round-h1scr', 'Stryken häst');
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, start_number, actual_lane, scratched)
    VALUES ('round-e1scr', 'round-r1', 'round-h1scr', 3, 3, 1)`).run();
  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('round-p1scr', 'round-h1scr', 2000, '2098-12-31T08:00:00Z', 'points-round')`).run();

  const context = await prepareAnalysisContext(env, 'round-pattern', 'pre_market');
  const firstLeg = context.legs[0].entries;
  const first = firstLeg.find((entry) => entry.horseId === 'round-h1');
  const second = firstLeg.find((entry) => entry.horseId === 'round-h1b');
  const scratched = firstLeg.find((entry) => entry.horseId === 'round-h1scr');
  const secondLegOnlyHorse = context.legs[1].entries[0];
  assert.equal(first.relevantPatterns.startPoints.current.points, 990);
  assert.equal(first.relevantPatterns.startPoints.fieldRank, 1);
  assert.equal(first.relevantPatterns.startPoints.fieldObserved, 2);
  assert.equal(second.relevantPatterns.startPoints.fieldRank, 2);
  assert.equal(scratched.relevantPatterns.startPoints.fieldRank, undefined);
  assert.equal(secondLegOnlyHorse.relevantPatterns.startPoints.fieldRank, 1);
  assert.equal(secondLegOnlyHorse.relevantPatterns.startPoints.fieldObserved, 1);
  assert.equal(context.round.turnoverSek, undefined);
  assert.equal(context.round.jackpotSek, undefined);
  assert.equal(context.market, undefined);
});

test('AI pattern history excludes same-day results from the target round date', async () => {
  const { env, db } = createTestEnv();
  horse(db, 'h1', 'Testhästen');
  const oldEntry = raceWithResult(db, { raceId: 'old-race', horseId: 'h1', date: '2026-08-31', number: 1 });
  const sameDayEntry = raceWithResult(db, { raceId: 'same-day-race', horseId: 'h1', date: '2026-09-01', number: 2 });
  xlabsSource(db, 'old-x', '2026-08-31T20:00:00Z');
  xlabsSource(db, 'same-day-x', '2026-09-01T10:00:00Z');
  db.prepare(`INSERT INTO xlabs_data
    (id,race_entry_id,first_200_time,last_400_time,extra_distance_m,quality_status,source_record_id)
    VALUES ('old-row',?,'1.12,0','1.11,0',8,'xlabs-telemetry-v1','old-x')`).run(oldEntry);
  db.prepare(`INSERT INTO xlabs_data
    (id,race_entry_id,first_200_time,last_400_time,extra_distance_m,quality_status,source_record_id)
    VALUES ('same-day-row',?,'1.05,0','1.04,0',2,'xlabs-telemetry-v1','same-day-x')`).run(sameDayEntry);
  const patterns = await getHorseRelevantPatternsBatch(env, ['h1'], '2026-09-01', { historicalOnly: true });
  assert.equal(patterns.get('h1').xlabs.measuredStarts, 1);
  assert.equal(patterns.get('h1').xlabs.openingPace.averageSecondsPerKm, 72);
});

test('horse pattern UI uses natural Swedish labels and separates facts from AI judgement', () => {
  const html = enhanceHorsePatternsHtml('<html><head></head><body><div id="app"></div></body></html>');
  for (const text of ['Utveckling & löpstyrka', 'Startpoäng', 'Starttempo', 'Avslutning', 'Extra distans', 'Visar mönster – inte en AI-bedömning.']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, />openingPace</);
  assert.doesNotMatch(html, />closingPace</);
  assert.doesNotMatch(html, />extraDistance</);
});