import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { prepareAnalysisContext } from '../src/analysis-api.js';

function seedMinimalRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('blind_track','Blind Test Park','SE')`).run();
  db.prepare(`
    INSERT INTO game_rounds
      (id, game_type, round_date, scheduled_start_at, bet_stop_at, jackpot_sek, turnover_sek, status)
    VALUES ('blind_round','V85','2020-06-01','2020-06-01T14:00:00Z','2020-06-01T13:55:00Z',1000000,5000000,'upcoming')
  `).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `blind_race_${leg}`;
    const horseId = `blind_horse_${leg}`;
    const entryId = `blind_entry_${leg}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES (?, 'blind_track', '2020-06-01', ?)`).run(raceId, leg);
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('blind_round', ?, ?)`).run(leg, raceId);
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(horseId, `Blind Horse ${leg}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES (?, ?, ?, 1)`).run(entryId, raceId, horseId);
    db.prepare(`
      INSERT INTO analysis_features
        (id, race_entry_id, feature_version, as_of, feature_name, numeric_value, data_quality)
      VALUES (?, ?, 'form-v2', '2020-05-31T12:00:00Z', 'form_known', 1, 'sufficient')
    `).run(`blind_feature_known_${leg}`, entryId);
    db.prepare(`
      INSERT INTO analysis_features
        (id, race_entry_id, feature_version, as_of, feature_name, numeric_value, data_quality)
      VALUES (?, ?, 'future-market-derived-v1', '2020-05-31T12:00:00Z', 'market_leak', 99, 'sufficient')
    `).run(`blind_feature_market_${leg}`, entryId);
  }
}

test('pre-market context strips pool metadata and admits only explicitly market-blind feature versions', async () => {
  const { env, db } = createTestEnv();
  seedMinimalRound(db);
  const context = await prepareAnalysisContext(env, 'blind_round', 'pre_market');

  assert.equal('jackpotSek' in context.round, false);
  assert.equal('turnoverSek' in context.round, false);
  for (const leg of context.legs) {
    assert.deepEqual(leg.entries[0].features.map((feature) => feature.version), ['form-v2']);
    assert.equal(leg.entries[0].features.some((feature) => feature.name === 'market_leak'), false);
  }
  assert.deepEqual(
    [...context.submissionRules.acceptedFeatureVersions].sort(),
    ['class-exposure-v2', 'development-v2', 'form-v2']
  );
});
