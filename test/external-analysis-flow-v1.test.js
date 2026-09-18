import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKET_INPUT_CONTRACT,
  RECORDED_SYSTEM_CONTRACT,
  REGISTRATION_CONTEXT_CONTRACT,
  buildMarketInput,
  buildRegistrationContext,
  getExternalAnalysisStep1Prompt,
  getExternalAnalysisStep2Prompt,
  getRegistrationPrompt,
  importRecordedSystem,
  listExternalAnalysisRounds
} from '../src/external-analysis-flow-v1.js';
import { createTestEnv } from './helpers/d1.js';

const ROUND_ID = 'external-round';

function seedRound(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('external-track','Synthetic Track','SE')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES (?, 'V85','2099-09-20','2099-09-20T14:00:00Z','2099-09-20T13:55:00Z','upcoming')").run(ROUND_ID);
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('external-market-source','official_provider','2099-09-20T10:00:00Z','normalized_verified_subset')").run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = 'external-race-' + leg;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?, 'external-track','2099-09-20',?,'2099-09-20T14:00:00Z',2140,'auto','upcoming')").run(raceId, leg);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)").run(ROUND_ID, leg, raceId);
    for (let starter = 1; starter <= 2; starter += 1) {
      const horseId = 'external-horse-' + leg + '-' + starter;
      const entryId = 'external-entry-' + leg + '-' + starter;
      db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horseId, 'Synthetic Horse ' + leg + '-' + starter);
      db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched,data_quality) VALUES (?,?,?,?,0,'normalized_verified_subset')").run(entryId, raceId, horseId, starter);
      db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,?,?,?,?,?,?)")
        .run('external-bet-' + leg + '-' + starter, ROUND_ID, leg, entryId, '2099-09-20T10:00:00Z', starter === 1 ? 60 : 40, starter, 'external-market-source');
    }
  }
}

function validPayload() {
  const legs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    legs.push({
      leg_number: leg,
      race_id: 'external-race-' + leg,
      scenarios: [{ name: 'synthetic', weight: 1 }],
      race_shape_summary: 'Synthetic race shape.',
      conclusion: 'Synthetic conclusion.',
      data_quality: 'sufficient',
      predictions: [
        { race_entry_id: 'external-entry-' + leg + '-1', win_probability: 0.6, uncertainty_low: 0.5, uncertainty_high: 0.7, raw_rank: 1, abcd_group: 'A', scenario_robustness: 0.8, reasoning: 'Synthetic stronger runner.' },
        { race_entry_id: 'external-entry-' + leg + '-2', win_probability: 0.4, uncertainty_low: 0.3, uncertainty_high: 0.5, raw_rank: 2, abcd_group: 'B', scenario_robustness: 0.6, reasoning: 'Synthetic second runner.' }
      ]
    });
  }
  const selections = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const count = leg <= 3 ? 1 : 2;
    for (let starter = 1; starter <= count; starter += 1) {
      selections.push({
        leg_number: leg,
        race_entry_id: 'external-entry-' + leg + '-' + starter,
        selection_reason: starter === 1 ? 'Synthetic selection.' : null
      });
    }
  }
  return {
    contract_version: RECORDED_SYSTEM_CONTRACT,
    submission_id: 'external-test-1',
    round_id: ROUND_ID,
    producer: { provider: 'openai', model: 'synthetic-model' },
    analysis_as_of: '2099-09-20T09:00:00Z',
    round_summary: 'Synthetic blind summary.',
    recommendations: { summary: 'Synthetic final system.' },
    legs,
    systems: [{
      system_id: 'main',
      system_type: 'main',
      notes: 'Synthetic main system.',
      risk_profile: 'balanced',
      selections
    }]
  };
}

test('external workflow exposes independent Step 1, Step 2 and registration contracts', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  const rounds = await listExternalAnalysisRounds(env, 'analysis');
  assert.equal(rounds[0].id, ROUND_ID);

  const market = await buildMarketInput(env, ROUND_ID, '2099-09-20T10:00:00Z');
  assert.equal(market.contract_version, MARKET_INPUT_CONTRACT);
  assert.equal(market.round.id, ROUND_ID);
  assert.equal(market.system_policy.exact_spike_count, 3);
  assert.equal(market.market.betting.length, 16);

  const registration = await buildRegistrationContext(env, ROUND_ID);
  assert.equal(registration.contract_version, REGISTRATION_CONTEXT_CONTRACT);
  assert.equal(registration.output_contract, RECORDED_SYSTEM_CONTRACT);
  assert.equal(registration.legs.length, 8);
  assert.equal(registration.system_policy.exact_spike_count, 3);

  assert.match(getExternalAnalysisStep1Prompt('openai'), /Marknadsblind analys/);
  assert.match(getExternalAnalysisStep1Prompt('openai'), /Bygg inget system/);
  assert.match(getExternalAnalysisStep2Prompt('anthropic'), /exakt 3 spikar/);
  assert.match(getRegistrationPrompt('openai'), /Gör inte om analysen/);
  assert.match(getRegistrationPrompt('openai'), /KentaurAI räknar/);
});

test('recorded-system import derives spikes, rows and cost instead of trusting AI arithmetic', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = validPayload();

  const result = await importRecordedSystem(env, payload);
  assert.equal(result.reused, false);
  assert.deepEqual(result.writes, { analyses: 8, predictions: 16, systems: 1, selections: 13 });
  assert.equal(result.systems[0].spike_count, 3);
  assert.equal(result.systems[0].row_count, 32);
  assert.equal(result.systems[0].cost_sek, 16);

  const system = db.prepare("SELECT spike_count,row_count,budget_sek,line_price_sek,metrics_json FROM systems WHERE game_round_id=?").get(ROUND_ID);
  assert.equal(system.spike_count, 3);
  assert.equal(system.row_count, 32);
  assert.equal(system.budget_sek, 16);
  assert.equal(system.line_price_sek, 0.5);
  const metrics = JSON.parse(system.metrics_json);
  assert.equal(metrics.row_count_derived, true);
  assert.equal(metrics.cost_derived, true);
  assert.equal(metrics.spike_count_derived, true);

  const spikes = db.prepare("SELECT leg_number FROM system_selections WHERE system_id=(SELECT id FROM systems WHERE game_round_id=?) AND is_spike=1 ORDER BY leg_number").all(ROUND_ID);
  assert.deepEqual(spikes.map((row) => row.leg_number), [1,2,3]);

  const retry = await importRecordedSystem(env, payload);
  assert.equal(retry.reused, true);
  assert.deepEqual(retry.writes, { analyses: 0, predictions: 0, systems: 0, selections: 0 });
});

test('recorded-system import fails closed on not-exactly-three spikes and client-supplied arithmetic', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  let payload = validPayload();
  payload.systems[0].selections = payload.systems[0].selections.filter((row) => !(row.leg_number === 4 && row.race_entry_id.endsWith('-2')));
  await assert.rejects(() => importRecordedSystem(env, payload), /exactly three one-horse spike legs/);

  payload = validPayload();
  payload.submission_id = 'external-test-2';
  payload.systems[0].row_count = 32;
  await assert.rejects(() => importRecordedSystem(env, payload), /row_count is calculated by KentaurAI/);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
});


test('recorded-system import rejects post-deadline analysis and systems above configured max budget', async () => {
  {
    const { env, db } = createTestEnv();
    seedRound(db);
    const payload = validPayload();
    payload.submission_id = 'external-test-late';
    payload.analysis_as_of = '2099-09-20T14:01:00Z';
    await assert.rejects(
      () => importRecordedSystem(env, payload),
      /analysis_as_of must not be after the round market deadline/
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
  }

  {
    const { env, db } = createTestEnv();
    seedRound(db);
    env.V85_LINE_PRICE_SEK = '10';
    const payload = validPayload();
    payload.submission_id = 'external-test-over-budget';
    await assert.rejects(
      () => importRecordedSystem(env, payload),
      /system cost exceeds configured max budget/
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
  }
});
