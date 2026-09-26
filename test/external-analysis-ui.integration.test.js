import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-v075.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

async function cookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

function seedRound(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('ui-track','UI Track','SE')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('ui-round','V85','2099-10-01','2099-10-01T14:00:00Z','2099-10-01T13:55:00Z','upcoming')").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('ui-source','official_provider','2026-09-18T10:00:00Z','normalized_verified_subset')").run();
  for (let leg=1; leg<=8; leg+=1) {
    const race='ui-race-'+leg;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?, 'ui-track','2099-10-01',?,'2099-10-01T14:00:00Z',2140,'auto','upcoming')").run(race,leg);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('ui-round',?,?)").run(leg,race);
    for (let starter=1; starter<=2; starter+=1) {
      const horse='ui-horse-'+leg+'-'+starter;
      const entry='ui-entry-'+leg+'-'+starter;
      db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horse,'UI Horse '+leg+'-'+starter);
      db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched,data_quality) VALUES (?,?,?,?,0,'normalized_verified_subset')").run(entry,race,horse,starter);
      db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,?,?,?,?,?,?)")
        .run('ui-bet-'+leg+'-'+starter,'ui-round',leg,entry,'2026-09-18T10:00:00Z',starter===1?60:40,starter,'ui-source');
    }
  }
}

test('new external workflow routes fail closed without a private session', async () => {
  const env = {
    APP_PASSWORD: 'synthetic-app-password-with-high-entropy',
    DB: { prepare(){ throw new Error('DB must not be reached before auth'); } }
  };
  for (const request of [
    new Request('https://example.test/app/api/settings/external-rounds?scope=analysis'),
    new Request('https://example.test/app/api/settings/external-step1-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/external-market?round_id=ui-round'),
    new Request('https://example.test/app/api/settings/external-step2-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/external-evidence-context?round_id=ui-round'),
    new Request('https://example.test/app/api/settings/external-step3-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/external-evidence-import-context?round_id=ui-round'),
    new Request('https://example.test/app/api/settings/external-evidence-import-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/external-evidence-import?round_id=ui-round', {method:'POST',headers:{'content-type':'application/json'},body:'{}'}),
    new Request('https://example.test/app/api/settings/system-import-context?round_id=ui-round'),
    new Request('https://example.test/app/api/settings/system-import-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/system-import?round_id=ui-round', {method:'POST',headers:{'content-type':'application/json'},body:'{}'})
  ]) {
    const response = await worker.fetch(request, env, {});
    assert.equal(response.status, 401, request.url);
  }
});

test('authenticated external workflow serves round-scoped analysis and registration exports', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedRound(db);
  const session = await cookie(env);
  const headers = { cookie: session };

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/external-rounds?scope=analysis',{headers}),env,{});
  assert.equal(response.status,200);
  let data = await response.json();
  assert.equal(data.rounds[0].id,'ui-round');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-market?round_id=ui-round',{headers}),env,{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/kentaurai-market_ui-round\.json/);
  data = await response.json();
  assert.equal(data.round.id,'ui-round');
  assert.equal(data.market.betting.length,16);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-evidence-context?round_id=ui-round',{headers}),env,{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/kentaurai-external-context_ui-round\.json/);
  data = await response.json();
  assert.equal(data.round.id,'ui-round');
  assert.equal(data.contract_version,'kentaurai-external-evidence-context-v1');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-step3-prompt?provider=openai',{headers}),env,{});
  assert.equal(response.status,200);
  data = await response.json();
  assert.match(data.prompt,/Intervjuer och extern statistik/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-evidence-import-context?round_id=ui-round',{headers}),env,{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/kentaurai-external-import_ui-round\.json/);
  data = await response.json();
  assert.equal(data.purpose,'import');

  response = await worker.fetch(new Request('https://example.test/app/api/settings/system-import-context?round_id=ui-round',{headers}),env,{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/kentaurai-system-import_ui-round\.json/);
  data = await response.json();
  assert.equal(data.round.id,'ui-round');
  assert.equal(data.legs.length,8);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-step1-prompt?provider=openai',{headers}),env,{});
  assert.equal(response.status,200);
  data = await response.json();
  assert.match(data.prompt,/Marknadsblind sportslig analys/);
  assert.match(data.prompt,/ANTI-FLATTENING-KONTROLL/);
  assert.match(data.prompt,/Trolig positionering när loppet satt sig/);
  assert.match(data.prompt,/Steg 2 får inte skriva om Steg 1/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-step2-prompt?provider=openai',{headers}),env,{});
  assert.equal(response.status,200);
  data = await response.json();
  assert.match(data.prompt,/Bygg inget system/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/external-evidence-import-prompt?provider=anthropic',{headers}),env,{});
  assert.equal(response.status,200);
  data = await response.json();
  assert.match(data.prompt,/kentaurai-external-evidence-import-v1/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/system-import-prompt?provider=anthropic',{headers}),env,{});
  assert.equal(response.status,200);
  data = await response.json();
  assert.match(data.prompt,/kentaurai-recorded-system-v1/);
});


test('authenticated system import requires JSON content type before parsing', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedRound(db);
  const session = await cookie(env);
  const response = await worker.fetch(new Request(
    'https://example.test/app/api/settings/system-import?round_id=ui-round',
    {
      method:'POST',
      headers:{ cookie:session, 'content-type':'text/plain' },
      body:'{}'
    }
  ),env,{});
  assert.equal(response.status,400);
  const data = await response.json();
  assert.match(data.message,/content-type must be application\/json/);
});
