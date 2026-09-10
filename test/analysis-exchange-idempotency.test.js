import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { prepareAnalysisContext, submitAnalysis } from '../src/analysis-api.js';
import { ANALYSIS_SUBMISSION_VERSION } from '../src/analysis-exchange.js';

function seedRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('idem_track','Idempotent Park','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES ('idem_round','V86','2099-07-01','2099-07-01T14:00:00Z','2099-07-01T13:55:00Z','upcoming')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `idem_race_${leg}`;
    const horseId = `idem_horse_${leg}`;
    const entryId = `idem_entry_${leg}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES (?, 'idem_track', '2099-07-01', ?)`).run(raceId, leg);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('idem_round', ?, ?)`).run(leg, raceId);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Idempotent Horse ${leg}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES (?, ?, ?, 1)`).run(entryId, raceId, horseId);
  }
}

function payload(context) {
  return {
    contract_version: ANALYSIS_SUBMISSION_VERSION,
    submission_id: 'openai-idem-1',
    round_id: 'idem_round',
    stage: 'pre_market',
    context_fingerprint: context.contextFingerprint,
    producer: { provider: 'openai', model: 'synthetic-model' },
    round_summary: 'First immutable analysis.',
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `idem_race_${leg}`,
        data_quality: 'limited',
        predictions: [{
          race_entry_id: `idem_entry_${leg}`,
          win_probability: 1,
          raw_rank: 1,
          abcd_group: 'A'
        }]
      };
    })
  };
}

test('exact analysis retry is a no-op while changed content under the same submission id is rejected', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const context = await prepareAnalysisContext(env, 'idem_round', 'pre_market');
  const firstPayload = payload(context);

  const first = await submitAnalysis(env, firstPayload);
  assert.equal(first.reused, false);
  assert.equal(first.writes.analyses, 8);

  const second = await submitAnalysis(env, firstPayload);
  assert.equal(second.reused, true);
  assert.deepEqual(second.writes, { analyses: 0, predictions: 0, systems: 0, selections: 0 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ai_race_analyses`).get().n, 8);

  await assert.rejects(
    submitAnalysis(env, { ...firstPayload, round_summary: 'Changed analysis under reused id.' }),
    /already exists with different content/
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ai_race_analyses`).get().n, 8);
});
