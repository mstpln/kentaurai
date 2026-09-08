import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

test('private app APIs fail closed without APP_PASSWORD or a valid session', async () => {
  const { env } = createTestEnv();
  let response = await worker.fetch(new Request('https://example.test/app/api/summary'), env);
  assert.equal(response.status, 503);

  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  response = await worker.fetch(new Request('https://example.test/app/api/summary'), env);
  assert.equal(response.status, 401);
});

test('valid app session can read summary without exposing ADMIN_TOKEN', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/api/summary', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.counts.horses, 0);
  assert.equal(data.trends.available, false);
});

test('entity list route threads limit and offset into paginated response', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_a','Alpha Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_b','Beta Trainer','SE')`).run();
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/api/entities/trainers?limit=1&offset=1', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 2);
  assert.equal(data.limit, 1);
  assert.equal(data.offset, 1);
  assert.equal(data.hasMore, false);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].name, 'Beta Trainer');
});

test('historical entity routes are session-private and paginate starts and linked horses', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_h','History Track','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_h','History Trainer','SE')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name, country_code) VALUES ('driver_h','History Driver','SE')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name, country_code) VALUES ('horse_h1','History Horse One','SE'),('horse_h2','History Horse Two','SE')`).run();
  for (const [i, horse] of [[1,'horse_h1'],[2,'horse_h2']]) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES (?, 'track_h', ?, ?, 2140, 'auto')`).run(`race_h${i}`, `2099-02-0${i}`, i);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_start_distance_m) VALUES (?, ?, ?, 'driver_h', 'trainer_h', ?, 2140)`).run(`entry_h${i}`, `race_h${i}`, horse, i);
  }
  const cookie = (await createAppSessionCookie(env)).split(';')[0];

  let response = await worker.fetch(new Request('https://example.test/app/api/entities/trainers/trainer_h/starts?limit=1&offset=1', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.total, 2);
  assert.equal(data.limit, 1);
  assert.equal(data.offset, 1);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].horse_name, 'History Horse One');
  assert.equal('entry_id' in data.items[0], false);

  response = await worker.fetch(new Request('https://example.test/app/api/entities/trainers/trainer_h/horses?limit=1&offset=0', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.total, 2);
  assert.equal(data.items.length, 1);
  assert.equal(data.hasMore, true);

  response = await worker.fetch(new Request('https://example.test/app/api/entities/trainers/trainer_h/starts?limit=1&offset=0'), env);
  assert.equal(response.status, 401);
});

test('game history routes are private and return round-based structures', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_x','V85','2099-01-03','upcoming')`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_x','round_x','main',200,120,3,'2099-01-03T10:00:00Z')`).run();
  const cookie = (await createAppSessionCookie(env)).split(';')[0];

  let response = await worker.fetch(new Request('https://example.test/app/api/games?type=V85&sort=latest', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].id, 'round_x');
  assert.equal(data.items[0].gameType, 'V85');

  response = await worker.fetch(new Request('https://example.test/app/api/games/summary', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.all.rounds, 1);
  assert.equal(data.savedSystems, 1);

  response = await worker.fetch(new Request('https://example.test/app/api/games/round_x', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.round.id, 'round_x');
  assert.equal(data.systems.length, 1);
});
