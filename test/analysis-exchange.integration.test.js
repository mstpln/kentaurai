import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-pwa.js';
import { createTestEnv } from './helpers/d1.js';
import {
  ANALYSIS_CONTEXT_VERSION,
  ANALYSIS_SUBMISSION_VERSION
} from '../src/analysis-exchange.js';
import {
  getRoundAnalysisSubmission,
  prepareAnalysisContext,
  submitAnalysis
} from '../src/analysis-api.js';

const ROUND_ID = 'round_analysis_exchange';
const ROUND_DATE = '2099-05-01';

function seedRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_analysis','Synthetic Park','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES (?, 'V85', ?, '2099-05-01T14:00:00Z', '2099-05-01T13:55:00Z', 'upcoming')
  `).run(ROUND_ID, ROUND_DATE);

  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `analysis_race_${leg}`;
    db.prepare(`
      INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, first_prize_sek, status)
      VALUES (?, 'track_analysis', ?, ?, ?, 2140, 'auto', 100000, 'upcoming')
    `).run(raceId, ROUND_DATE, leg, `2099-05-01T${String(13 + leg).padStart(2, '0')}:00:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)`).run(ROUND_ID, leg, raceId);

    for (let start = 1; start <= 2; start += 1) {
      const horseId = `analysis_horse_${leg}_${start}`;
      const entryId = `analysis_entry_${leg}_${start}`;
      db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Synthetic Horse ${leg}-${start}`);
      db.prepare(`
        INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched, data_quality)
        VALUES (?, ?, ?, ?, 0, 'normalized_verified_subset')
      `).run(entryId, raceId, horseId, start);
    }
  }
}

function predictionLegs() {
  return Array.from({ length: 8 }, (_, index) => {
    const leg = index + 1;
    return {
      leg_number: leg,
      race_id: `analysis_race_${leg}`,
      scenarios: { expected: 'synthetic neutral scenario' },
      race_shape_summary: `Synthetic market-blind race shape ${leg}`,
      conclusion: `Synthetic strength conclusion ${leg}`,
      data_quality: 'sufficient',
      predictions: [
        {
          race_entry_id: `analysis_entry_${leg}_1`,
          win_probability: 0.6,
          uncertainty_low: 0.5,
          uncertainty_high: 0.7,
          raw_rank: 1,
          abcd_group: 'A',
          scenario_robustness: 0.8,
          reasoning: { summary: 'Synthetic stronger runner' }
        },
        {
          race_entry_id: `analysis_entry_${leg}_2`,
          win_probability: 0.4,
          uncertainty_low: 0.3,
          uncertainty_high: 0.5,
          raw_rank: 2,
          abcd_group: 'B',
          scenario_robustness: 0.6,
          reasoning: { summary: 'Synthetic second runner' }
        }
      ]
    };
  });
}

function preMarketSubmission(context, { id = 'claude-pre-1', provider = 'anthropic', model = 'synthetic-claude' } = {}) {
  return {
    contract_version: ANALYSIS_SUBMISSION_VERSION,
    submission_id: id,
    round_id: ROUND_ID,
    stage: 'pre_market',
    context_fingerprint: context.contextFingerprint,
    producer: { provider, model },
    analysis_version: 'synthetic-v1',
    round_summary: 'Synthetic market-blind round assessment.',
    recommendations: { strongest_legs: [1, 2, 3] },
    legs: predictionLegs()
  };
}

function finalSystem() {
  const selections = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    if (leg <= 3) {
      selections.push({ leg_number: leg, race_entry_id: `analysis_entry_${leg}_1`, is_spike: true, selection_reason: 'Synthetic spike' });
    } else {
      selections.push({ leg_number: leg, race_entry_id: `analysis_entry_${leg}_1`, is_spike: false });
      selections.push({ leg_number: leg, race_entry_id: `analysis_entry_${leg}_2`, is_spike: false });
    }
  }
  return {
    system_id: 'main-200',
    system_type: 'main',
    budget_sek: 16,
    line_price_sek: 0.5,
    risk_profile: 'balanced',
    notes: 'Synthetic final system',
    selections
  };
}

function seedMarket(db) {
  db.prepare(`
    INSERT INTO source_records (id, source_type, fetched_at, quality_status)
    VALUES ('analysis-market-source', 'official_provider', '2026-09-01T12:00:00Z', 'verified')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    for (let start = 1; start <= 2; start += 1) {
      const entryId = `analysis_entry_${leg}_${start}`;
      db.prepare(`
        INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
        VALUES (?, ?, ?, ?, '2026-09-01T12:00:00Z', ?, ?, 'analysis-market-source')
      `).run(`bet_${leg}_${start}`, ROUND_ID, leg, entryId, start === 1 ? 40 : 60, start === 1 ? 2 : 1);
    }
  }
  db.prepare(`
    INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank)
    VALUES ('bet_unprovenanced_newer', ?, 1, 'analysis_entry_1_1', '2026-09-02T12:00:00Z', 90, 1)
  `).run(ROUND_ID);
}

test('pre-market context is market-blind and can be stored independently by Claude and ChatGPT', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  seedMarket(db);

  const context = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');
  assert.equal(context.contractVersion, ANALYSIS_CONTEXT_VERSION);
  assert.equal(context.stage, 'pre_market');
  assert.equal(context.analysisRules.marketBlind, true);
  assert.match(context.contextFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(context).includes('betPercent'), false);
  assert.equal(JSON.stringify(context).includes('marketRank'), false);

  const claude = await submitAnalysis(env, preMarketSubmission(context));
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.stage, 'pre_market');
  assert.equal(claude.writes.analyses, 8);
  assert.equal(claude.writes.predictions, 16);

  const chatgpt = await submitAnalysis(env, preMarketSubmission(context, {
    id: 'openai-pre-1',
    provider: 'openai',
    model: 'synthetic-gpt'
  }));
  assert.equal(chatgpt.provider, 'openai');
  assert.notEqual(chatgpt.modelVersionId, claude.modelVersionId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM model_versions WHERE feature_version='analysis-exchange-v1'`).get().n, 2);
});

test('market context requires a stored pre-market parent and final submission copies strength unchanged', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  seedMarket(db);

  await assert.rejects(
    prepareAnalysisContext(env, ROUND_ID, 'market', { preMarketSubmissionId: 'missing-pre' }),
    /stored pre-market submission/
  );

  const preContext = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');
  await submitAnalysis(env, preMarketSubmission(preContext));
  const marketContext = await prepareAnalysisContext(env, ROUND_ID, 'market', { preMarketSubmissionId: 'claude-pre-1' });
  assert.equal(marketContext.stage, 'market');
  assert.equal(marketContext.analysisRules.marketBlind, false);
  assert.equal(marketContext.market.definitionVersion, 'verified-market-at-stop-v1');
  assert.equal(marketContext.market.cutoff, marketContext.market.asOf);
  assert.ok(Date.parse(marketContext.market.cutoff) < Date.parse(marketContext.market.betStopAt));
  assert.equal(marketContext.market.betting.length, 16);
  assert.equal(marketContext.market.betting.find((row) => row.raceEntryId === 'analysis_entry_1_1').betPercent, 40);

  const final = await submitAnalysis(env, {
    contract_version: ANALYSIS_SUBMISSION_VERSION,
    submission_id: 'claude-final-1',
    round_id: ROUND_ID,
    stage: 'final',
    parent_submission_id: 'claude-pre-1',
    context_fingerprint: marketContext.contextFingerprint,
    producer: { provider: 'anthropic', model: 'synthetic-claude' },
    analysis_version: 'synthetic-v1',
    round_summary: 'Synthetic value/system pass.',
    recommendations: { spikes: [1, 2, 3], note: 'Synthetic recommendation' },
    systems: [finalSystem()]
  });
  assert.equal(final.parentSubmissionId, 'claude-pre-1');
  assert.equal(final.writes.systems, 1);
  assert.equal(final.writes.selections, 13);

  const storedPre = await getRoundAnalysisSubmission(env, ROUND_ID, 'claude-pre-1');
  const storedFinal = await getRoundAnalysisSubmission(env, ROUND_ID, 'claude-final-1');
  assert.deepEqual(
    storedFinal.legs.map((leg) => leg.predictions.map((prediction) => [prediction.raceEntryId, prediction.winProbability, prediction.rawRank, prediction.abcdGroup])),
    storedPre.legs.map((leg) => leg.predictions.map((prediction) => [prediction.raceEntryId, prediction.winProbability, prediction.rawRank, prediction.abcdGroup]))
  );
  assert.equal(storedFinal.systems.length, 1);
  assert.equal(storedFinal.systems[0].spikeCount, 3);
  assert.equal(storedFinal.systems[0].rowCount, 32);
  assert.equal(storedFinal.systems[0].selections.filter((selection) => selection.isSpike).length, 3);
  assert.equal(storedFinal.systems[0].selections.find((selection) => selection.raceEntryId === 'analysis_entry_1_1').ownProbability, 0.6);
  assert.equal(storedFinal.systems[0].selections.find((selection) => selection.raceEntryId === 'analysis_entry_1_1').marketPercent, 40);
  assert.ok(storedFinal.legs[0].predictions[0].valueRatio > 1);
  assert.ok(storedFinal.legs[0].predictions[0].valueRatio < 2);
});

test('analysis exchange fails closed for stale contexts and invalid spike structures', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  seedMarket(db);
  const context = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');

  await assert.rejects(
    submitAnalysis(env, { ...preMarketSubmission(context), context_fingerprint: `sha256:${'0'.repeat(64)}` }),
    /stale or does not match/
  );
  await submitAnalysis(env, preMarketSubmission(context));
  const marketContext = await prepareAnalysisContext(env, ROUND_ID, 'market', { preMarketSubmissionId: 'claude-pre-1' });
  const badSystem = finalSystem();
  badSystem.selections.find((selection) => selection.leg_number === 4 && selection.race_entry_id.endsWith('_2')).is_spike = true;
  await assert.rejects(
    submitAnalysis(env, {
      submission_id: 'claude-final-bad',
      round_id: ROUND_ID,
      stage: 'final',
      parent_submission_id: 'claude-pre-1',
      context_fingerprint: marketContext.contextFingerprint,
      producer: { provider: 'anthropic', model: 'synthetic-claude' },
      systems: [badSystem]
    }),
    /multi-horse leg cannot be marked as a spike/
  );
});

test('analysis exchange HTTP routes are ADMIN_TOKEN protected and round-bound', async () => {
  const { env, db } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin';
  seedRound(db);

  const denied = await worker.fetch(new Request('https://example.test/v1/analysis/rounds'), env);
  assert.equal(denied.status, 401);

  const headers = { authorization: 'Bearer synthetic-admin' };
  const rounds = await worker.fetch(new Request('https://example.test/v1/analysis/rounds', { headers }), env);
  assert.equal(rounds.status, 200);
  const roundBody = await rounds.json();
  assert.equal(roundBody.rounds[0].id, ROUND_ID);

  const contextResponse = await worker.fetch(new Request(`https://example.test/v1/analysis/rounds/${ROUND_ID}/context?stage=pre_market`, { headers }), env);
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();

  const payload = preMarketSubmission(context);
  const imported = await worker.fetch(new Request(`https://example.test/v1/analysis/rounds/${ROUND_ID}/submissions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }), env);
  assert.equal(imported.status, 201);

  const fetched = await worker.fetch(new Request(`https://example.test/v1/analysis/rounds/${ROUND_ID}/submissions/claude-pre-1`, { headers }), env);
  assert.equal(fetched.status, 200);
  const fetchedBody = await fetched.json();
  assert.equal(fetchedBody.producer.provider, 'anthropic');

  const wrongRound = await worker.fetch(new Request(`https://example.test/v1/analysis/rounds/${ROUND_ID}/submissions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, round_id: 'different-round' })
  }), env);
  assert.equal(wrongRound.status, 400);
});