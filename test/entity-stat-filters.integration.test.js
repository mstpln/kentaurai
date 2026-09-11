import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-settings.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { getFilteredEntityStatBreakdowns } from '../src/routes/entity-stat-breakdowns.js';
import { renderAppPage } from '../src/app-page-stat-filters.js';
import { createTestEnv } from './helpers/d1.js';

function seed(db) {
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-filter','Synthetic Trainer')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse-filter','Synthetic Horse')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name) VALUES ('driver-filter','Synthetic Driver')`).run();
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-a','Track A'),('track-b','Track B')`).run();

  const starts = [
    { id: 'e1', race: 'r1', date: '2026-01-10', distance: 2140, method: 'auto', track: 'track-a', placing: 1, gallop: 0, mainClass: 'Silverdivisionen', firstPrize: 135000 },
    { id: 'e2', race: 'r2', date: '2026-02-10', distance: 2148, method: 'volt', track: 'track-a', placing: 2, gallop: 1, mainClass: null, firstPrize: 40000 },
    { id: 'e3', race: 'r3', date: '2026-03-10', distance: 1640, method: 'volte', track: 'track-b', placing: 4, gallop: 1, mainClass: null, firstPrize: 35000 },
    { id: 'e4', race: 'r4', date: '2025-05-10', distance: 2140, method: 'autostart', track: 'track-b', placing: 1, gallop: 1, mainClass: 'Bronsdivisionen', firstPrize: 125000 },
    { id: 'e5', race: 'r5', date: '2025-06-10', distance: 2640, method: 'voltstart', track: 'track-a', placing: 3, gallop: 0, mainClass: null, firstPrize: 30000 }
  ];

  for (const start of starts) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, main_class, status) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'results')`)
      .run(start.race, start.track, start.date, start.distance, start.method, start.firstPrize, start.mainClass);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, scratched) VALUES (?, ?, 'horse-filter', 'driver-filter', 'trainer-filter', 1, 0)`)
      .run(start.id, start.race);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, result_status, gallop) VALUES (?, ?, 'official', ?)`)
      .run(start.id, start.placing, start.gallop);
  }
}

test('year filter applies across start method, distance and track tables', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const data = await getFilteredEntityStatBreakdowns(env, 'trainers', 'trainer-filter', { year: '2026' });

  assert.equal(data.startMethods.reduce((sum, row) => sum + row.starts, 0), 3);
  assert.equal(data.distances.reduce((sum, row) => sum + row.starts, 0), 3);
  assert.equal(data.tracks.reduce((sum, row) => sum + row.starts, 0), 3);
  assert.deepEqual(data.startMethods.map((row) => row.label).sort(), ['auto', 'volt']);
});

test('race level applies globally and separates higher-prize from weekday racing', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const higherPrize = await getFilteredEntityStatBreakdowns(env, 'trainers', 'trainer-filter', { year: '2026', raceScope: 'high_prize' });
  assert.equal(higherPrize.startMethods.reduce((sum, row) => sum + row.starts, 0), 1);
  assert.equal(higherPrize.distances.reduce((sum, row) => sum + row.starts, 0), 1);
  assert.equal(higherPrize.tracks.reduce((sum, row) => sum + row.starts, 0), 1);
  assert.equal(higherPrize.filters.raceScope, 'high_prize');

  const weekday = await getFilteredEntityStatBreakdowns(env, 'trainers', 'trainer-filter', { year: '2026', raceScope: 'weekday' });
  assert.equal(weekday.startMethods.reduce((sum, row) => sum + row.starts, 0), 2);
  assert.equal(weekday.distances.reduce((sum, row) => sum + row.starts, 0), 2);
  assert.equal(weekday.tracks.reduce((sum, row) => sum + row.starts, 0), 2);
  assert.equal(weekday.filters.raceScope, 'weekday');
});

test('distance start-method filter keeps method-specific gallop rates', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const data = await getFilteredEntityStatBreakdowns(env, 'trainers', 'trainer-filter', {
    year: '2026',
    distanceStartMethod: 'volt'
  });

  assert.equal(data.distances.reduce((sum, row) => sum + row.starts, 0), 2);
  const raw2148 = data.distances.find((row) => row.label === '2148');
  assert.equal(raw2148.starts, 1);
  assert.equal(raw2148.gallops, 1);
  assert.equal(raw2148.gallopRate, 1);
  assert.equal(data.startMethods.reduce((sum, row) => sum + row.starts, 0), 3, 'distance toggle must not alter start-method table');
});

test('track start-method filter is independent from distance filter', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const data = await getFilteredEntityStatBreakdowns(env, 'trainers', 'trainer-filter', {
    year: '2026',
    distanceStartMethod: 'volt',
    trackStartMethod: 'auto'
  });

  assert.equal(data.distances.reduce((sum, row) => sum + row.starts, 0), 2);
  assert.equal(data.tracks.reduce((sum, row) => sum + row.starts, 0), 1);
  assert.equal(data.tracks[0].label, 'Track A');
  assert.equal(data.tracks[0].gallopRate, 0);
});

test('filtered statistics route is private and returns requested filters', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const url = 'https://example.test/app/api/entities/trainers/trainer-filter/stat-breakdowns?year=2026&race_scope=weekday&distance_start_method=volt&track_start_method=auto';

  let response = await worker.fetch(new Request(url), env);
  assert.equal(response.status, 401);

  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request(url, { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.filters, { year: 2026, raceScope: 'weekday', distanceStartMethod: 'volt', trackStartMethod: 'auto' });
  assert.equal(data.distances.reduce((sum, row) => sum + row.starts, 0), 2);
  assert.equal(data.tracks.reduce((sum, row) => sum + row.starts, 0), 0);
});

test('statistics UI uses period and race-level controls plus correct method wording', () => {
  const html = renderAppPage();
  assert.match(html, /new Date\(\)\.getFullYear\(\)/);
  assert.match(html, /\(i år\)/);
  assert.match(html, /\(förra året\)/);
  assert.match(html, /Loppnivå/);
  assert.match(html, /Högre prissumma/);
  assert.match(html, /Vardagstrav/);
  assert.doesNotMatch(html, /STL-lopp/);
  assert.match(html, /high_prize/);
  assert.match(html, /data-race-scope/);
  assert.match(html, /race_scope:filters\.raceScope/);
  assert.match(html, /Voltstart/);
  assert.match(html, /Galopp %/);
  assert.match(html, /data-distance-method/);
  assert.match(html, /data-track-method/);
  assert.match(html, /stat-table-scroll/);
});

test('all embedded scripts in the final statistics-filter app are valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.some((script) => script.includes('kentaurai') || script.includes('entityStatState')));
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
