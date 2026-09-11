import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { prepareAnalysisContext, submitAnalysis } from '../src/analysis-api.js';
import { ANALYSIS_SUBMISSION_VERSION } from '../src/analysis-exchange.js';

const ROUND_ID = 'build_e_round';

function seedRound(db, deadline = '2099-07-01T13:55:00Z') {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('build_e_track','Synthetic Track','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES (?, 'V85', '2099-07-01', '2099-07-01T14:00:00Z', ?, 'upcoming')
  `).run(ROUND_ID, deadline);
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `build_e_race_${leg}`;
    const horseId = `build_e_horse_${leg}`;
    const entryId = `build_e_entry_${leg}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, status) VALUES (?, 'build_e_track', '2099-07-01', ?, '2099-07-01T14:00:00Z', 'upcoming')`).run(raceId, leg);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)`).run(ROUND_ID, leg, raceId);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Synthetic Horse ${leg}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?, ?, ?, 1, 0)`).run(entryId, raceId, horseId);
  }
}

function prePayload(context, overrides = {}) {
  return {
    contract_version: ANALYSIS_SUBMISSION_VERSION,
    submission_id: 'openai-build-e-pre-1',
    round_id: ROUND_ID,
    stage: 'pre_market',
    context_fingerprint: context.contextFingerprint,
    producer: { provider: 'openai', model: 'gpt-5.6-sol' },
    legs: Array.from({ length: 8 }, (_, index) => ({
      leg_number: index + 1,
      race_id: `build_e_race_${index + 1}`,
      scenarios: null,
      race_shape_summary: null,
      conclusion: null,
      data_quality: 'sufficient',
      predictions: [{
        race_entry_id: `build_e_entry_${index + 1}`,
        win_probability: 1,
        uncertainty_low: 1,
        uncertainty_high: 1,
        raw_rank: 1,
        abcd_group: 'A',
        scenario_robustness: 1,
        reasoning: null
      }]
    })),
    ...overrides
  };
}

test('Build E accepts canonical OpenAI and Anthropic producer identities but rejects unknown providers', async () => {
  let setup = createTestEnv();
  seedRound(setup.db);
  let context = await prepareAnalysisContext(setup.env, ROUND_ID, 'pre_market');
  const openai = await submitAnalysis(setup.env, prePayload(context));
  assert.equal(openai.provider, 'openai');

  setup = createTestEnv();
  seedRound(setup.db);
  context = await prepareAnalysisContext(setup.env, ROUND_ID, 'pre_market');
  const anthropic = await submitAnalysis(setup.env, prePayload(context, {
    submission_id: 'anthropic-build-e-pre-1',
    producer: { provider: 'anthropic', model: 'claude-sonnet-4-5' }
  }));
  assert.equal(anthropic.provider, 'anthropic');

  setup = createTestEnv();
  seedRound(setup.db);
  context = await prepareAnalysisContext(setup.env, ROUND_ID, 'pre_market');
  await assert.rejects(
    submitAnalysis(setup.env, prePayload(context, { producer: { provider: 'other-ai', model: 'synthetic' } })),
    /explicitly allowed provider/
  );
});

test('Build E blocks changed fingerprints and missing canonical entry identities', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const context = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');
  await assert.rejects(
    submitAnalysis(env, prePayload(context, { context_fingerprint: `sha256:${'0'.repeat(64)}` })),
    /stale or does not match/
  );
  const missingEntry = prePayload(context);
  delete missingEntry.legs[0].predictions[0].race_entry_id;
  await assert.rejects(submitAnalysis(env, missingEntry), /race_entry_id/);
});

test('Build E exact retry is idempotent and revised content under the same submission id is rejected', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const context = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');
  const payload = prePayload(context);
  const first = await submitAnalysis(env, payload);
  assert.equal(first.reused, false);
  const retry = await submitAnalysis(env, payload);
  assert.equal(retry.reused, true);
  assert.deepEqual(retry.writes, { analyses: 0, predictions: 0, systems: 0, selections: 0 });
  await assert.rejects(
    submitAnalysis(env, { ...payload, round_summary: 'Revised content' }),
    /different content/
  );
});

test('Build E never creates a new pre-market analysis after the verified deadline', async () => {
  const { env, db } = createTestEnv();
  seedRound(db, '2020-01-01T00:00:00Z');
  await assert.rejects(
    prepareAnalysisContext(env, ROUND_ID, 'pre_market'),
    /already reached its analysis deadline/
  );
});

test('Build E final stage rejects a wrong pre-market parent before any system write', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const context = await prepareAnalysisContext(env, ROUND_ID, 'pre_market');
  await submitAnalysis(env, prePayload(context));
  await assert.rejects(
    submitAnalysis(env, {
      contract_version: ANALYSIS_SUBMISSION_VERSION,
      submission_id: 'openai-build-e-final-1',
      round_id: ROUND_ID,
      stage: 'final',
      parent_submission_id: 'missing-parent',
      context_fingerprint: context.contextFingerprint,
      producer: { provider: 'openai', model: 'gpt-5.6-sol' },
      systems: []
    }),
    /parent_submission_id must identify a stored pre-market submission/
  );
});