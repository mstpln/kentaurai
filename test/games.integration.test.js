import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getGameHistoryDetail, getGameHistorySummary, listGameHistory } from '../src/routes/games.js';

function seedRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_1','Synthetic Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_1','V86','2099-01-02','finished')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Alpha Horse')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_2','Beta Horse')`).run();

  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `race_${leg}`;
    const winnerEntryId = `winner_${leg}`;
    const otherEntryId = `other_${leg}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('${raceId}', 'track_1', '2099-01-02', ${leg}, 2140, 'auto')`).run();
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_1', ${leg}, '${raceId}')`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('${winnerEntryId}', '${raceId}', 'horse_1', 1)`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('${otherEntryId}', '${raceId}', 'horse_2', 2)`).run();
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, km_time, official_odds) VALUES ('${winnerEntryId}', 1, '1', '1.12,0', 3.5)`).run();
    if (leg === 1) {
      db.prepare(`INSERT INTO race_positions (id, race_entry_id, observed_at_m, position, leader) VALUES ('pos_1', '${winnerEntryId}', 500, 1, 1)`).run();
    }
  }

  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_main','round_1','main',216,144,3,'2099-01-02T10:00:00Z')`).run();

  for (let leg = 1; leg <= 8; leg += 1) {
    const selectedEntryId = leg <= 6 ? `winner_${leg}` : `other_${leg}`;
    const isSpike = leg <= 3 ? 1 : 0;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent) VALUES ('system_main', ${leg}, '${selectedEntryId}', ${isSpike}, 0.25, 0.20)`).run();
  }
}

test('game history lists one row per round with result and spike metrics', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const data = await listGameHistory(env, { gameType: 'V86', sort: 'correct_desc' });
  assert.equal(data.total, 1);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].gameType, 'V86');
  assert.equal(data.items[0].trackNames, 'Synthetic Park');
  assert.equal(data.items[0].correctLegs, 6);
  assert.equal(data.items[0].correctSpikes, 3);
  assert.equal(data.items[0].resultComplete, true);
});

test('game history detail exposes eight legs and factual winner-trip classification', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const detail = await getGameHistoryDetail(env, 'round_1');
  assert.equal(detail.round.gameType, 'V86');
  assert.equal(detail.systems.length, 1);
  assert.equal(detail.systems[0].correctLegs, 6);
  assert.equal(detail.legs.length, 8);
  assert.equal(detail.legs[0].winner.horseName, 'Alpha Horse');
  assert.equal(detail.legs[0].winner.trip.label, 'Spets');
  assert.equal(detail.legs[5].systems.system_main.selectedWinner, true);
  assert.equal(detail.legs[6].systems.system_main.selectedWinner, false);
  assert.equal(detail.unknownWinnerTrips, 7);
});

test('game overview summarizes rounds, spikes and winner-trip evidence without inventing unknown trips', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const summary = await getGameHistorySummary(env);
  assert.equal(summary.all.rounds, 1);
  assert.equal(summary.all.completedRounds, 1);
  assert.equal(summary.all.averageCorrect, 6);
  assert.equal(summary.all.spikeHitRate, 1);
  assert.deepEqual(summary.winnerTrips, [{ label: 'Spets', count: 1 }]);
  assert.equal(summary.unknownWinnerTrips, 7);
});
