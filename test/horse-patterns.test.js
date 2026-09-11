import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareAnalysisContext } from '../src/analysis-api.js';
import { enhanceHorsePatternsHtml } from '../src/horse-patterns-ui.js';
import { getHorseRelevantPatterns, getHorseRelevantPatternsBatch } from '../src/statistics/horse-patterns.js';
import { createTestEnv } from './helpers/d1.js';

function source(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES (?, 'xlabs_race_json', ?, 'normalized_verified_subset')`).run(id, fetchedAt);
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
  source(db, 'x1', '2026-08-01T20:00:00Z');
  source(db, 'x2', '2026-08-10T20:00:00Z');
  db.prepare(`INSERT INTO xlabs_data
    (id, race_entry_id, first_200_time, last_400_time, extra_distance_m, quality_status, source_record_id)
    VALUES ('xrow1', ?, '1.12,0', '1.11,0', 8, 'xlabs-telemetry-v1', 'x1')`).run(entry1);
  db.prepare(`INSERT INTO xlabs_data
    (id, race_entry_id, first_200_time, last_400_time, extra_distance_m, quality_status, source_record_id)
    VALUES ('xrow2', ?, '1.10,0', '1.09,0', 12, 'xlabs-telemetry-v1', 'x2')`).run(entry2);

  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('p1','h1',900,'2026-08-01T08:00:00Z','x1')`).run();
  db.prepare(`INSERT INTO horse_start_points
    (id, horse_id, points, observed_at, source_record_id)
    VALUES ('p2','h1',1100,'2026-08-10T08:00:00Z','x2')`).run();
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES ('future-source','official_provider','2026-09-20T08:00:00Z','normalized_verified_subset')`).run();
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

test('field-relative Start Points rank uses only horses with verified observations', async () => {
  const { env, db } = createTestEnv();
  for (const id of ['h1', 'h2', 'h3']) horse(db, id, id.toUpperCase());
  db.prepare(`INSERT INTO source_records (id, source_type, fetched_at, quality_status)
    VALUES ('points-source','official_provider','2026-09-01T08:00:00Z','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO horse_start_points (id,horse_id,points,observed_at,source_record_id)
    VALUES ('p1','h1',1200,'2026-09-01T08:00:00Z','points-source')`).run();
  db.prepare(`INSERT INTO horse_start_points (id,horse_id,points,observed_at,source_record_id)
    VALUES ('p2','h2',900,'2026-09-01T08:00:00Z','points-source')`).run();

  const patterns = await getHorseRelevantPatternsBatch(env, ['h1', 'h2', 'h3'], '2026-09-02', { includeFieldRank: true });
  assert.equal(patterns.get('h1').startPoints.fieldRank, 1);
  assert.equal(patterns.get('h2').startPoints.fieldRank, 2);
  assert.equal(patterns.get('h1').startPoints.fieldObserved, 2);
  assert.equal(patterns.get('h3').startPoints.current, null);
  assert.equal(patterns.get('h3').startPoints.fieldRank, undefined);
});

test('market-blind AI context receives factual horse patterns without market fields', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('round-track','Testbanan','SE')`).run();
  db.prepare(`INSERT INTO game_rounds
    (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES ('round-pattern','V85','2099-01-01','2099-01-01T12:00:00Z','2099-01-01T11:55:00Z','upcoming')`).run();
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES ('points-round','official_provider','2098-12-31T08:00:00Z','normalized_verified_subset')`).run();

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

  const context = await prepareAnalysisContext(env, 'round-pattern', 'pre_market');
  const first = context.legs[0].entries[0];
  assert.equal(first.relevantPatterns.startPoints.current.points, 990);
  assert.equal(first.relevantPatterns.startPoints.fieldRank, 1);
  assert.equal(first.relevantPatterns.startPoints.fieldObserved, 8);
  assert.equal(context.round.turnoverSek, undefined);
  assert.equal(context.round.jackpotSek, undefined);
  assert.equal(context.market, undefined);
});

test('horse pattern UI uses natural Swedish labels and separates facts from AI judgement', () => {
  const html = enhanceHorsePatternsHtml('<html><head></head><body><div id="app"></div></body></html>');
  for (const text of ['Utveckling & löpstyrka', 'Startpoäng', 'Starttempo', 'Avslutning', 'Extra väg', 'Visar mönster – inte en AI-bedömning.']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, />openingPace</);
  assert.doesNotMatch(html, />closingPace</);
  assert.doesNotMatch(html, />extraDistance</);
});
