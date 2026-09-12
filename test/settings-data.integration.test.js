import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

const ROUND_ID = 'settings_round';

function seedFutureRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('settings_track','Synthetic Track','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES (?, 'V85', '2099-06-01', '2099-06-01T14:00:00Z', '2099-06-01T13:55:00Z', 'upcoming')
  `).run(ROUND_ID);
  db.prepare(`
    INSERT INTO source_records (id, source_type, fetched_at, quality_status)
    VALUES ('settings-market-source', 'official_provider', '2026-09-01T12:00:00Z', 'verified')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `settings_race_${leg}`;
    const horseId = `settings_horse_${leg}`;
    const entryId = `settings_entry_${leg}`;
    db.prepare(`
      INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status)
      VALUES (?, 'settings_track', '2099-06-01', ?, ?, 2140, 'auto', 'upcoming')
    `).run(raceId, leg, `2099-06-01T${String(13 + leg).padStart(2, '0')}:00:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)`).run(ROUND_ID, leg, raceId);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Synthetic Horse ${leg}`);
    db.prepare(`
      INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched, data_quality)
      VALUES (?, ?, ?, 1, 0, 'normalized_verified_subset')
    `).run(entryId, raceId, horseId);
    db.prepare(`
      INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
      VALUES (?, ?, ?, ?, '2026-09-01T12:00:00Z', 50, 1, 'settings-market-source')
    `).run(`settings_bet_${leg}`, ROUND_ID, leg, entryId);
  }
}

async function sessionCookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('settings routes are private and settings UI includes the three-step AI workflow', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/status'), env);
  assert.equal(response.status, 401);

  const cookie = await sessionCookie(env);
  response = await worker.fetch(new Request('https://example.test/app', { headers: { cookie } }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/');

  response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="settingsButton"/);
  assert.match(html, /Inställningar/);
  assert.match(html, /Analysera omgången utan marknad/);
  assert.match(html, /Värdera marknaden och bygg system/);
  assert.match(html, /Skapa importfil till KentaurAI/);
  assert.match(html, /Datamängd/);
  assert.match(html, /Senaste körningar/);
  assert.match(html, /Datakällor/);
});

test('settings status reports useful data counts, workflow output and source health', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('settings_trainer','Trainer')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name) VALUES ('settings_driver','Driver')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('settings_status_horse','Horse')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date) VALUES ('settings_status_round','V85','2099-01-01')`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('settings_status_system','settings_status_round','main',200,1,3,'2099-01-01T10:00:00Z')`).run();
  db.prepare(`
    INSERT INTO import_runs (id, source_type, started_at, finished_at, status, inserted_count, updated_count, skipped_count, error_count)
    VALUES ('settings_run','official_live','2099-01-01T10:00:00Z','2099-01-01T10:01:00Z','success',12,3,2,0)
  `).run();

  const cookie = await sessionCookie(env);
  const response = await worker.fetch(new Request('https://example.test/app/api/settings/status', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.counts.trainers, 1);
  assert.equal(data.counts.horses, 1);
  assert.equal(data.counts.drivers, 1);
  assert.equal(data.counts.games, 1);
  assert.equal(data.recentRuns[0].inserted, 12);
  assert.equal(data.recentRuns[0].errors, 0);
  assert.equal(data.sources.find((source) => source.id === 'official').status, 'working');
});

test('workflow exports keep step 1 market-blind and expose market only in step 2', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedFutureRound(db);
  const cookie = await sessionCookie(env);

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/export?provider=openai&stage=pre_market', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /kentaurai-analysis-input_openai_pre_market_/);
  let exported = await response.json();
  assert.equal(exported.metadata.contract_version, 'kentaurai-analysis-input-v2');
  assert.equal(exported.metadata.workflow_stage, 'pre_market');
  assert.equal(exported.metadata.target_provider, 'openai');
  assert.equal(exported.metadata.round_id, ROUND_ID);
  assert.equal(exported.tables.horses.length, 8);
  assert.equal(exported.tables.betting_snapshots.length, 0);
  assert.equal(exported.metadata.analysis_context.market, null);
  assert.equal(JSON.stringify(exported.metadata.analysis_context).includes('betPercent'), false);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/export?provider=openai&stage=market', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /kentaurai-analysis-input_openai_market_/);
  exported = await response.json();
  assert.equal(exported.metadata.contract_version, 'kentaurai-analysis-input-v2');
  assert.equal(exported.metadata.workflow_stage, 'market');
  assert.equal(exported.tables.betting_snapshots.length, 8);
  assert.equal(exported.metadata.analysis_context.market.betting.length, 8);
  assert.equal(exported.metadata.analysis_context.market.definitionVersion, 'verified-market-at-stop-v1');
});

test('analysis upload rejects non-JSON files and logout clears the private session', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await sessionCookie(env);

  const form = new FormData();
  form.append('analysis_file', new Blob(['not-json'], { type: 'text/plain' }), 'analysis.txt');
  let response = await worker.fetch(new Request('https://example.test/app/api/settings/import-analysis', {
    method: 'POST',
    headers: { cookie },
    body: form
  }), env);
  assert.equal(response.status, 400);
  const error = await response.json();
  assert.match(error.message, /\.json-fil/);

  response = await worker.fetch(new Request('https://example.test/app/logout', { method: 'POST', headers: { cookie } }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/login');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
