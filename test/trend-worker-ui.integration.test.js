import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { enhanceTrendHtml } from '../src/trend-ui.js';

function seedTrend(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-trend','Synthetic Track')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('trainer-trend','Synthetic Trainer')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name) VALUES ('driver-trend','Synthetic Driver')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name, breed) VALUES ('horse-trend','Synthetic Horse','varmblodig travare')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, race_name, status)
    VALUES ('race-trend','track-trend','2026-09-11',1,2140,'auto',50000,'Synthetic race','results')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, scratched)
    VALUES ('entry-trend','race-trend','horse-trend','driver-trend','trainer-trend',1,0)`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, result_status, gallop, prize_sek)
    VALUES ('entry-trend',1,'official',0,50000)`).run();
}

async function authenticatedCookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('Trend API is private and is served through the actual Worker entrypoint', async () => {
  const { env, db } = createTestEnv();
  seedTrend(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const url = 'https://example.test/app/api/trend?category=horses&period=2w&race_scope=all&race_type=all&breed_type=all&start_method=all';

  let response = await worker.fetch(new Request(url), env);
  assert.equal(response.status, 401);

  response = await worker.fetch(new Request(url, { headers: { cookie: await authenticatedCookie(env) } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.category, 'horses');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, 'horse-trend');
  assert.equal(data.items[0].winRate, 1);
});

test('Trend API returns 400 for invalid filters through the actual Worker', async () => {
  const { env, db } = createTestEnv();
  seedTrend(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await authenticatedCookie(env);
  const response = await worker.fetch(new Request('https://example.test/app/api/trend?category=horses&period=bogus', { headers: { cookie } }), env);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.message, /period must be/);
});

test('actual Worker app HTML contains the canonical Trend Build A enhancement', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie: await authenticatedCookie(env) } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /id="kentaurai-trend-build-a"/);
  assert.match(html, /id="kentaurai-trend-build-a-script"/);
  assert.match(html, /Högst segerprocent/);
  assert.match(html, /Topp 3%/);
  assert.match(html, /Galopp%/);
  assert.match(html, /Prispengar/);
  assert.match(html, /data-trend-id/);
  assert.match(html, /aria-label="Detaljfilter"/);
  assert.match(html, /id="trendPeriodSelect"/);
  assert.match(html, /class="trend-period-chevron"/);
  assert.match(html, /state\.trendRange='2w'/);
  assert.match(html, /state\.trendRaceScope=state\.trendRaceScope\|\|'high_prize'/);
  assert.match(html, /minStarts:'10'/);
  assert.match(html, /function activeFilterCount\(\)/);
  assert.match(html, /M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6/);
  assert.match(html, /@media\(max-width:430px\)/);
  assert.match(html, /@media\(max-width:340px\)/);
  assert.match(html, /\.trend-win-block\{[^}]*align-items:center[^}]*padding:0 10px/);
  assert.match(html, /\.trend-metric-pill:last-child strong\{[^}]*overflow:visible[^}]*text-overflow:clip/);
  assert.doesNotMatch(html, /trend-win-label/);
});

test('Trend enhancer preserves existing final app HTML and injects valid JavaScript', () => {
  const source = '<!doctype html><html><head><title>x</title></head><body><main id="keep">keep</main></body></html>';
  const html = enhanceTrendHtml(source);
  assert.match(html, /id="keep">keep/);
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
