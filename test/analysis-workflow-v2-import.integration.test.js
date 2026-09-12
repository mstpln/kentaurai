import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowDataExportResponse, getCombinedPromptContext } from '../src/analysis-workflow-v2.js';
import { importStrictCombinedAnalysis } from '../src/analysis-workflow-v2-strict.js';
import { createTestEnv } from './helpers/d1.js';

const ROUND_ID = 'combined-round';

function seedRound(db, gameType = 'V85') {
  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('combined-track','Synthetic Track')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES (?, ?, '2099-07-01', '2099-07-01T14:00:00Z', '2099-07-01T13:55:00Z', 'upcoming')
  `).run(ROUND_ID, gameType);
  db.prepare(`
    INSERT INTO source_records (id, source_type, fetched_at, quality_status)
    VALUES ('combined-market-source','official_provider','2026-09-12T10:00:00Z','verified')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `combined-race-${leg}`;
    db.prepare(`
      INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status)
      VALUES (?, 'combined-track', '2099-07-01', ?, '2099-07-01T14:00:00Z', 2140, 'auto', 'upcoming')
    `).run(raceId, leg);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)`).run(ROUND_ID, leg, raceId);
    for (let starter = 1; starter <= 2; starter += 1) {
      const horseId = `combined-horse-${leg}-${starter}`;
      const entryId = `combined-entry-${leg}-${starter}`;
      db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Synthetic Horse ${leg}-${starter}`);
      db.prepare(`
        INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched, data_quality)
        VALUES (?, ?, ?, ?, 0, 'normalized_verified_subset')
      `).run(entryId, raceId, horseId, starter);
      db.prepare(`
        INSERT INTO betting_snapshots
          (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
        VALUES (?, ?, ?, ?, '2026-09-12T10:00:00Z', ?, ?, 'combined-market-source')
      `).run(`combined-bet-${leg}-${starter}`, ROUND_ID, leg, entryId, starter === 1 ? 60 : 40, starter);
    }
  }
}

function systemSelections(singletonLegs) {
  const singleton = new Set(singletonLegs);
  const rows = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const count = singleton.has(leg) ? 1 : 2;
    for (let starter = 1; starter <= count; starter += 1) {
      rows.push({
        leg_number: leg,
        race_entry_id: `combined-entry-${leg}-${starter}`,
        is_spike: count === 1
      });
    }
  }
  return rows;
}

async function validPayload(env, { mainNotes = 'Synthetic two-spike rationale.' } = {}) {
  const promptContext = await getCombinedPromptContext(env, 'openai');
  return {
    contract_version: 'kentaurai-analysis-v2',
    submission_id: 'combined-openai-1',
    round_id: ROUND_ID,
    stage: 'combined',
    context_fingerprint: promptContext.context_fingerprint,
    producer: { provider: 'openai', model: 'synthetic-model' },
    analysis_version: 'synthetic-v2',
    round_summary: 'Synthetic combined analysis.',
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `combined-race-${leg}`,
        scenarios: { expected: 'synthetic scenario' },
        race_shape_summary: 'Synthetic race shape.',
        conclusion: 'Synthetic conclusion.',
        data_quality: 'sufficient',
        predictions: [
          { race_entry_id: `combined-entry-${leg}-1`, win_probability: 0.6, raw_rank: 1, abcd_group: 'A', reasoning: { summary: 'Synthetic stronger runner.' } },
          { race_entry_id: `combined-entry-${leg}-2`, win_probability: 0.4, raw_rank: 2, abcd_group: 'B', reasoning: { summary: 'Synthetic second runner.' } }
        ]
      };
    }),
    systems: [
      {
        system_id: 'main',
        system_type: 'main',
        budget_sek: 32,
        line_price_sek: 0.5,
        notes: mainNotes,
        selections: systemSelections([1, 2])
      },
      {
        system_id: 'personal',
        system_type: 'alternative',
        budget_sek: 16,
        line_price_sek: 0.5,
        notes: 'Synthetic personal system.',
        selections: systemSelections([1, 2, 3])
      }
    ]
  };
}

test('combined V85 import persists blind legs, systems and the audited two-spike main reason atomically', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await validPayload(env);
  const result = await importStrictCombinedAnalysis(env, payload);

  assert.equal(result.ok, true);
  assert.equal(result.stage, 'combined');
  assert.equal(result.analysisBlindness, 'declared_unsealed');
  assert.deepEqual(result.writes, { analyses: 8, predictions: 16, systems: 2, selections: 27 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ai_race_analyses WHERE market_blind = 1`).get().n, 8);
  const main = db.prepare(`SELECT spike_count, notes, metrics_json FROM systems WHERE system_type = 'main'`).get();
  assert.equal(main.spike_count, 2);
  assert.equal(main.notes, 'Synthetic two-spike rationale.');
  assert.equal(JSON.parse(main.metrics_json).analysisBlindness, 'declared_unsealed');
});

test('V85 main with two spikes is rejected without notes before anything is stored', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await validPayload(env, { mainNotes: null });
  await assert.rejects(() => importStrictCombinedAnalysis(env, payload), /two spikes requires a clear reason in notes/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM model_versions WHERE feature_version = 'analysis-exchange-v2'`).get().n, 0);
});

test('combined import leaves no partial rows when the atomic D1 batch fails', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await validPayload(env);
  const failingDb = {
    prepare: env.DB.prepare.bind(env.DB),
    async batch() { throw new Error('synthetic batch failure'); }
  };
  await assert.rejects(() => importStrictCombinedAnalysis({ ...env, DB: failingDb }, payload), /synthetic batch failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM model_versions WHERE feature_version = 'analysis-exchange-v2'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM systems WHERE game_round_id = ?`).get(ROUND_ID).n, 0);
});

test('combined import rejects numeric strings instead of silently coercing JSON types', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await validPayload(env);
  payload.legs[0].predictions[0].win_probability = '0.6';
  await assert.rejects(() => importStrictCombinedAnalysis(env, payload), /win_probability must be a JSON number/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM model_versions WHERE feature_version = 'analysis-exchange-v2'`).get().n, 0);
});

test('combined import requires is_spike to be a real JSON boolean', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await validPayload(env);
  payload.systems[0].selections[0].is_spike = 1;
  await assert.rejects(() => importStrictCombinedAnalysis(env, payload), /is_spike must be a JSON boolean/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM model_versions WHERE feature_version = 'analysis-exchange-v2'`).get().n, 0);
});

test('combined import rejects market contamination in round summary and English leg reasoning', async () => {
  const { env } = createTestEnv();
  seedRound(env.DB.db);
  let payload = await validPayload(env);
  payload.round_summary = 'The market makes this leg attractive.';
  await assert.rejects(() => importStrictCombinedAnalysis(env, payload), /round_summary contains market language/);

  payload = await validPayload(env);
  payload.legs[0].predictions[0].reasoning = { summary: 'The favourite looks overbet.' };
  await assert.rejects(() => importStrictCombinedAnalysis(env, payload), /reasoning contains market language/);
});

test('pre-market export guard follows race-start fallback when round-level deadlines are null', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`UPDATE game_rounds SET scheduled_start_at = NULL, bet_stop_at = NULL WHERE id = ?`).run(ROUND_ID);
  db.prepare(`
    INSERT INTO model_versions (id, created_at, feature_version, ai_provider, ai_model)
    VALUES ('guard-model','2026-09-12T10:00:00Z','synthetic','openai','synthetic-model')
  `).run();
  db.prepare(`
    INSERT INTO ai_race_analyses
      (id, race_id, model_version_id, data_snapshot_at, market_blind, created_at)
    VALUES ('guard-analysis','combined-race-1','guard-model','2026-09-12T10:00:00Z',1,'2026-09-12T10:00:00Z')
  `).run();
  db.prepare(`
    INSERT INTO ai_horse_predictions
      (id, ai_race_analysis_id, race_entry_id, win_probability, raw_rank, abcd_group)
    VALUES ('guard-prediction','guard-analysis','combined-entry-1-1',0.6,1,'A')
  `).run();
  db.prepare(`
    INSERT INTO systems
      (id, game_round_id, model_version_id, system_type, budget_sek, row_count, line_price_sek, spike_count, created_at)
    VALUES ('guard-system',?,'guard-model','main',1.5,3,0.5,3,'2026-09-12T10:00:00Z')
  `).run(ROUND_ID);
  db.prepare(`
    INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike)
    VALUES ('guard-system',1,'combined-entry-1-1',1)
  `).run();

  const response = await createWorkflowDataExportResponse(env, 'openai', 'pre_market');
  const exported = await response.json();
  assert.equal(exported.tables.ai_race_analyses.some((row) => row.id === 'guard-analysis'), false);
  assert.equal(exported.tables.ai_horse_predictions.some((row) => row.id === 'guard-prediction'), false);
  assert.equal(exported.tables.systems.some((row) => row.id === 'guard-system'), false);
  assert.equal(exported.tables.system_selections.some((row) => row.system_id === 'guard-system'), false);
});
