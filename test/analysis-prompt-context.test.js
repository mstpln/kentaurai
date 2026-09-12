import test from 'node:test';
import assert from 'node:assert/strict';

import { getAnalysisPromptContext } from '../src/analysis-prompt-context.js';
import { submitAnalysis } from '../src/analysis-api.js';
import { ANALYSIS_SUBMISSION_VERSION } from '../src/analysis-exchange.js';
import { createTestEnv } from './helpers/d1.js';

function seedRound(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, country_code) VALUES ('prompt-final-track','Finalbanan','SE')").run();
  db.prepare(`INSERT INTO game_rounds (
    id, game_type, round_date, scheduled_start_at, bet_stop_at, status
  ) VALUES ('prompt-final-round','V86','2099-09-13','2099-09-13T15:00:00Z','2099-09-13T14:55:00Z','upcoming')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `prompt-final-race-${leg}`;
    const horseId = `prompt-final-horse-${leg}`;
    const entryId = `prompt-final-entry-${leg}`;
    db.prepare(`INSERT INTO races (
      id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status
    ) VALUES (?, 'prompt-final-track', '2099-09-13', ?, '2099-09-13T15:00:00Z', 2140, 'auto', 'upcoming')`).run(raceId, leg);
    db.prepare('INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)').run('prompt-final-round', leg, raceId);
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Finalhäst ${leg}`);
    db.prepare('INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?, ?, ?, 1, 0)').run(entryId, raceId, horseId);
  }
}

test('prompt context advances from pre-market to final while retaining canonical identity mapping', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  const pre = await getAnalysisPromptContext(env, 'openai');
  assert.equal(pre.export_stage, 'pre_market');
  assert.equal(pre.round_id, 'prompt-final-round');
  assert.equal(pre.context_fingerprint, pre.context.contextFingerprint);

  await submitAnalysis(env, {
    contract_version: ANALYSIS_SUBMISSION_VERSION,
    submission_id: 'openai-prompt-final-pre-1',
    round_id: 'prompt-final-round',
    stage: 'pre_market',
    context_fingerprint: pre.context_fingerprint,
    producer: { provider: 'openai', model: 'gpt-test' },
    systems: [],
    legs: Array.from({ length: 8 }, (_, index) => ({
      leg_number: index + 1,
      race_id: `prompt-final-race-${index + 1}`,
      scenarios: null,
      race_shape_summary: null,
      conclusion: null,
      data_quality: 'unknown',
      predictions: [{
        race_entry_id: `prompt-final-entry-${index + 1}`,
        win_probability: 1,
        uncertainty_low: null,
        uncertainty_high: null,
        raw_rank: 1,
        abcd_group: 'A',
        scenario_robustness: null,
        reasoning: null
      }]
    }))
  });

  const final = await getAnalysisPromptContext(env, 'openai');
  assert.equal(final.export_stage, 'final');
  assert.equal(final.parent_submission_id, 'openai-prompt-final-pre-1');
  assert.equal(final.context_fingerprint, final.context.contextFingerprint);
  assert.equal(final.context.stage, 'market');
  assert.equal(final.identity_context.stage, 'pre_market');
  assert.equal(final.identity_context.legs.length, 8);
  assert.equal(final.identity_context.legs[0].entries[0].raceEntryId, 'prompt-final-entry-1');
  assert.equal(final.identity_context.legs[0].entries[0].horseName, 'Finalhäst 1');
});
