import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v075.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { enhanceF3PrivateUiHtml } from '../src/app-f3-private-ui.js';
import { buildF3OperationalStatus, buildF3WorkflowState } from '../src/f3-private-ui.js';

function seedEightLegRound(db) {
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('f3_track','F3 Track','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,status)
    VALUES ('f3_round','V85','2099-08-01','2099-08-01T12:00:00Z','upcoming')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`
      INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status)
      VALUES (?, 'f3_track','2099-08-01',?,?, 'upcoming')
    `).run(`f3_race_${leg}`,leg,`2099-08-01T${String(11 + leg).padStart(2,'0')}:00:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('f3_round',?,?)`)
      .run(leg,`f3_race_${leg}`);
  }
}

async function cookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('F3 app routes fail closed before DB access without a valid private session', async () => {
  const env = {
    APP_PASSWORD: 'synthetic-app-password-with-high-entropy',
    DB: { prepare() { throw new Error('DB must not be reached before session auth'); } }
  };
  for (const url of [
    'https://example.test/app/api/settings/f3-rounds',
    'https://example.test/app/api/settings/f3-workflow-state?round_id=f3_round',
    'https://example.test/app/api/settings/f3-analysis-pack?round_id=f3_round',
    'https://example.test/app/api/settings/f3-operational-status'
  ]) {
    const response = await worker.fetch(new Request(url), env, {});
    assert.equal(response.status, 401, url);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('F3 pre-lock workflow exposes only the safe first two steps and blocks market actions', async () => {
  const { env, db } = createTestEnv();
  seedEightLegRound(db);
  const state = await buildF3WorkflowState(env,'f3_round','2099-07-01T10:00:00Z');

  assert.equal(state.round.game_type,'V85');
  assert.equal(state.round.leg_count,8);
  assert.equal(state.steps.analysis_pack.status,'ready');
  assert.equal(state.steps.step1_lock.status,'ready');
  assert.equal(state.steps.market_pack.status,'blocked');
  assert.equal(state.steps.market_pack.reason,'step1_lock_required');
  assert.equal(state.steps.step2_import.status,'blocked');
  assert.equal(state.steps.optimized_system.status,'blocked');
  assert.equal(state.system,null);
});

test('F3 operational status is read-only and contains no raw payload or raw error text', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`
    INSERT INTO historical_backfill_jobs (
      id,start_date,end_date,next_date,next_race_index,status,processed_dates,processed_races,reused_races,
      consecutive_errors,last_error,created_at,updated_at
    ) VALUES (
      'private-job-id','2099-01-01','2099-01-02','2099-01-01',0,'failed',0,0,0,1,
      'HTTP 500 private upstream detail that must not leak','2099-01-01T00:00:00Z','2099-01-01T00:00:00Z'
    )
  `).run();

  const data = await buildF3OperationalStatus(env,'2099-01-03T12:00:00Z');
  assert.equal(data.raw_source_data_included,false);
  assert.equal(data.backfills.read_only,true);
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized,/private-job-id/);
  assert.doesNotMatch(serialized,/private upstream detail/);
  assert.match(serialized,/source_transport_failure/);
});

test('F3 private UI is structurally responsive, guided and contains no raw/admin-token controls', () => {
  const html = enhanceF3PrivateUiHtml('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  assert.match(html,/V3 · Analysflöde/);
  assert.match(html,/Hämta analysdata/);
  assert.match(html,/Försegla Steg 1/);
  assert.match(html,/Hämta Steg 2-underlag/);
  assert.match(html,/Importera och optimera/);
  assert.match(html,/Revidera Steg 1/);
  assert.match(html,/Datatäckning och drift/);
  assert.match(html,/@media\(max-width:760px\)/);
  assert.match(html,/button\.disabled = !enabled/);
  assert.match(html,/analysis-workflow-intro/);
  assert.match(html,/f3LegacyUi/);
  assert.doesNotMatch(html,/ADMIN_TOKEN/);
  assert.doesNotMatch(html,/raw_object_key/);
  assert.doesNotMatch(html,/source_records/);

  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length,1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});

test('actual F3 Worker serves the guided UI and session-private observability routes', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedEightLegRound(db);
  const session = await cookie(env);

  let response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie: session } }), env, {});
  assert.equal(response.status,200);
  const html = await response.text();
  assert.doesNotMatch(html,/kentaurai-external-analysis-ui-script/);
  assert.match(html,/canonicalAnalysisWorkflow/);
  assert.match(html,/Analysera omgång/);
  assert.match(html,/Registrera system/);
  assert.match(html,/Hämta marknadsdata/);
  assert.match(html,/Hämta importunderlag/);
  assert.doesNotMatch(html,/Försegla Steg 1/);
  assert.doesNotMatch(html,/Importera och optimera/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/f3-rounds', { headers: { cookie: session } }), env, {});
  assert.equal(response.status,200);
  let data = await response.json();
  assert.equal(data.rounds[0].id,'f3_round');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/f3-workflow-state?round_id=f3_round', { headers: { cookie: session } }), env, {});
  assert.equal(response.status,200);
  data = await response.json();
  assert.equal(data.steps.market_pack.status,'blocked');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/f3-operational-status', { headers: { cookie: session } }), env, {});
  assert.equal(response.status,200);
  data = await response.json();
  assert.equal(data.raw_source_data_included,false);
});
