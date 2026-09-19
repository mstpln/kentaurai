import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v077.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { getEntityDetail } from '../src/routes/entities.js';
import { getTrackDetail } from '../src/routes/tracks.js';

test('performance Worker injects cache, prefetch and immediate loading UI into private app', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /kentaurai-performance-v1-script/);
  assert.match(html, /kentaurai-performance-v1-style/);
  assert.match(html, /requestIdleCallback/);
  assert.match(html, /inflight\.has\(path\)/);
  assert.match(html, /Öppnar profil/);
  assert.doesNotMatch(html, /kentaurai-external-analysis-ui-script/);
  assert.match(html, /canonicalAnalysisWorkflow/);
  assert.doesNotMatch(html, /kentaurai-analysis-export-download-fix/);
  assert.doesNotMatch(html, /kentaurai-step1-lock-v3-overlay/);
  assert.doesNotMatch(html, /kentaurai-entity-detail-ui-runtime/);
  assert.match(html, /kentaurai-entity-detail-statistics-v2-script/);
  assert.match(html, /kentaurai-external-evidence-ui-style/);
  assert.match(html, /\['external_stats','Extern statistik'\]/);
  assert.match(html, /\['interviews','Intervjuer'\]/);
  assert.doesNotMatch(html, /\/app\/api\/settings\/analysis-rounds/);
  const match = html.match(/<script id="kentaurai-performance-v1-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
});

test('production Worker exposes the v3 round picker endpoint and keeps the legacy picker disabled', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('picker_track','Picker Track','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,status)
    VALUES ('picker_round','V85','2099-09-18','2099-09-18T12:00:00Z','upcoming')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`
      INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status)
      VALUES (?, 'picker_track','2099-09-18',?,?, 'upcoming')
    `).run(`picker_race_${leg}`, leg, `2099-09-18T${String(11 + leg).padStart(2,'0')}:00:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('picker_round',?,?)`)
      .run(leg, `picker_race_${leg}`);
  }
  const cookie = (await createAppSessionCookie(env)).split(';')[0];

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/f3-rounds', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.rounds[0].id, 'picker_round');
  assert.equal(body.rounds[0].gameType, 'V85');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-rounds', { headers: { cookie } }), env, {});
  assert.equal(response.status, 410);
  body = await response.json();
  assert.equal(body.error, 'legacy_analysis_creation_disabled');
});

test('lightweight entity detail omits expensive start enrichment while preserving summary data', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('perf_track','Perf Track','SE')`).run();
  db.prepare(`INSERT INTO horses (id,canonical_name,country_code) VALUES ('perf_horse','Perf Horse','SE')`).run();
  db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method) VALUES ('perf_race','perf_track','2099-01-01',1,2140,'auto')`).run();
  db.prepare(`INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES ('perf_entry','perf_race','perf_horse',1)`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id,placing,placing_text,result_status) VALUES ('perf_entry',1,'1','official')`).run();

  const full = await getEntityDetail(env, 'horses', 'perf_horse');
  assert.equal(full.starts.length, 1);

  const light = await getEntityDetail(env, 'horses', 'perf_horse', { includeStarts: false });
  assert.equal(light.entity.name, 'Perf Horse');
  assert.equal(light.stats.databaseStarts, 1);
  assert.equal(light.starts.length, 0);
});

test('track overview can defer home-trainer scan without losing factual track summary', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('perf_track','Perf Track','SE')`).run();
  db.prepare(`INSERT INTO horses (id,canonical_name,country_code) VALUES ('perf_horse','Perf Horse','SE')`).run();
  db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method) VALUES ('perf_race','perf_track','2099-01-01',1,2140,'auto')`).run();
  db.prepare(`INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES ('perf_entry','perf_race','perf_horse',1)`).run();

  const detail = await getTrackDetail(env, 'perf_track', { includeHomeTrainerCount: false });
  assert.equal(detail.name, 'Perf Track');
  assert.equal(detail.coverage.races, 1);
  assert.equal(detail.coverage.homeTrainers, null);
});

test('performance migration creates indexes used by hot app read paths', () => {
  const { db } = createTestEnv();
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
  for (const name of [
    'idx_races_track_date',
    'idx_entries_horse_race',
    'idx_game_legs_race',
    'idx_odds_entry_time',
    'idx_equipment_entry',
    'idx_xlabs_entry',
    'idx_editorial_items_entry',
    'idx_ai_predictions_entry'
  ]) assert.ok(names.has(name), name);
});
