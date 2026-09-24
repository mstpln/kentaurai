import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getGameHistoryDetail, getGameHistorySummary, listGameHistory } from '../src/routes/games.js';
import { getGameStatistics } from '../src/routes/game-statistics.js';

function seedRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_1','Synthetic Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_1','V86','2099-01-02','finished')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_1','Alpha Horse')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_2','Beta Horse')`).run();
  db.prepare(`INSERT INTO model_versions (id,created_at,feature_version) VALUES ('model_1','2099-01-02T08:00:00Z','synthetic-v1')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('final_game_src','official_provider','game:round_1','2099-01-02T22:00:00Z','normalized_verified_subset')`).run();

  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `race_${leg}`;
    const winnerEntryId = `winner_${leg}`;
    const otherEntryId = `other_${leg}`;
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('${raceId}', 'track_1', '2099-01-02', ${leg}, 2140, 'auto')`).run();
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_1', ${leg}, '${raceId}')`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('${winnerEntryId}', '${raceId}', 'horse_1', 1)`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('${otherEntryId}', '${raceId}', 'horse_2', 2)`).run();
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, km_time, official_odds) VALUES ('${winnerEntryId}', 1, '1', '1.12,0', 3.5)`).run();
    db.prepare(`INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?,?,?,1,?)`)
      .run(`analysis_${leg}`,raceId,'model_1','2099-01-02T08:00:00Z','2099-01-02T08:00:00Z');
    db.prepare(`INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,?,?)`)
      .run(`pred_w_${leg}`,`analysis_${leg}`,winnerEntryId,0.6,1,'A');
    db.prepare(`INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,?,?)`)
      .run(`pred_o_${leg}`,`analysis_${leg}`,otherEntryId,0.4,2,'B');
    db.prepare(`INSERT INTO analysis_entry_form_snapshots (id,game_round_id,step1_pack_id,leg_number,race_entry_id,as_of,form_version,form_score,used_starts,form_rank) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(`form_w_${leg}`,'round_1','pack_1',leg,winnerEntryId,'2099-01-02T08:00:00Z','horse-form-index-v1',72,5,1);
    db.prepare(`INSERT INTO analysis_entry_form_snapshots (id,game_round_id,step1_pack_id,leg_number,race_entry_id,as_of,form_version,form_score,used_starts,form_rank) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(`form_o_${leg}`,'round_1','pack_1',leg,otherEntryId,'2099-01-02T08:00:00Z','horse-form-index-v1',55,5,2);
    db.prepare(`INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(`close_w_${leg}`,'round_1',leg,winnerEntryId,'2099-01-02T22:00:00Z',60,1,'final_game_src');
    db.prepare(`INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(`close_o_${leg}`,'round_1',leg,otherEntryId,'2099-01-02T22:00:00Z',40,2,'final_game_src');
    if (leg === 1) {
      db.prepare(`INSERT INTO race_positions (id, race_entry_id, observed_at_m, position, leader) VALUES ('pos_1', '${winnerEntryId}', 500, 1, 1)`).run();
    }
  }

  db.prepare(`INSERT INTO systems (id, game_round_id, model_version_id, system_type, budget_sek, row_count, spike_count, created_at, metrics_json) VALUES ('system_main','round_1','model_1','main',216,144,3,'2099-01-02T10:00:00Z','{"step1_pack_id":"pack_1"}')`).run();
  db.prepare(`INSERT INTO game_round_final_results (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek) VALUES ('round_1','V86','final_game_src','2099-01-02T22:00:00Z','results',1000000,10000,500,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":4,"jackpot":false}}',8,2500000,25000)`).run();

  for (let leg = 1; leg <= 8; leg += 1) {
    const selectedEntryId = leg <= 6 ? `winner_${leg}` : `other_${leg}`;
    const isSpike = leg <= 3 ? 1 : 0;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent) VALUES ('system_main', ${leg}, '${selectedEntryId}', ${isSpike}, 0.25, 0.20)`).run();
  }
}

function seedPartialRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_p','Partial Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_p','V85','2099-01-03','running')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_p','Partial Horse')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('prace_${leg}', 'track_p', '2099-01-03', ${leg}, 2140, 'auto')`).run();
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_p', ${leg}, 'prace_${leg}')`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('pentry_${leg}', 'prace_${leg}', 'horse_p', 1)`).run();
    if (leg <= 2) db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text) VALUES ('pentry_${leg}', 1, '1')`).run();
  }
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_partial','round_p','main',180,120,3,'2099-01-03T10:00:00Z')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system_partial', ${leg}, 'pentry_${leg}', ${leg <= 3 ? 1 : 0})`).run();
  }
}

test('game history lists one row per saved system with result and spike metrics', async () => {
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

test('game history keeps multiple systems from the same round as separate rows', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_alt','round_1','alternative',108,72,3,'2099-01-02T10:30:00Z')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const selectedEntryId = leg <= 4 ? `winner_${leg}` : `other_${leg}`;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system_alt', ${leg}, '${selectedEntryId}', ${leg <= 3 ? 1 : 0})`).run();
  }

  const data = await listGameHistory(env, { gameType: 'V86', sort: 'latest' });
  assert.equal(data.total, 2);
  assert.equal(data.items.length, 2);
  assert.deepEqual(data.items.map((item) => item.roundId), ['round_1', 'round_1']);
  assert.deepEqual(data.items.map((item) => item.systemId), ['system_main', 'system_alt']);
  assert.deepEqual(data.items.map((item) => item.systemLabel), ['Huvudsystem', 'Alternativ 1']);
  assert.deepEqual(data.items.map((item) => item.budgetSek), [216, 108]);
  assert.deepEqual(data.items.map((item) => item.correctLegs), [6, 4]);
  assert.deepEqual(data.items.map((item) => item.correctSpikes), [3, 3]);
});

test('game history sorting ranks individual systems instead of grouped rounds', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_alt','round_1','alternative',108,72,3,'2099-01-02T10:30:00Z')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const selectedEntryId = leg <= 8 ? `winner_${leg}` : `other_${leg}`;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system_alt', ${leg}, '${selectedEntryId}', ${leg <= 3 ? 1 : 0})`).run();
  }

  const mostCorrect = await listGameHistory(env, { gameType: 'V86', sort: 'correct_desc' });
  assert.equal(mostCorrect.items[0].systemId, 'system_alt');
  assert.equal(mostCorrect.items[0].correctLegs, 8);
  assert.equal(mostCorrect.items[1].systemId, 'system_main');
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

test('unfinished legs are not counted as unknown winner trips', async () => {
  const { env, db } = createTestEnv();
  seedPartialRound(db);
  const summary = await getGameHistorySummary(env);
  assert.equal(summary.all.rounds, 1);
  assert.equal(summary.all.completedRounds, 0);
  assert.equal(summary.unknownWinnerTrips, 2);
});

test('latest main system is used consistently as the primary round system', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_main_new','round_1','main',240,160,3,'2099-01-02T11:00:00Z')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const selectedEntryId = leg <= 7 ? `winner_${leg}` : `other_${leg}`;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system_main_new', ${leg}, '${selectedEntryId}', ${leg <= 3 ? 1 : 0})`).run();
  }

  const list = await listGameHistory(env, { gameType: 'V86' });
  assert.equal(list.items[0].primarySystemId, 'system_main_new');
  assert.equal(list.items[0].correctLegs, 7);

  const detail = await getGameHistoryDetail(env, 'round_1');
  assert.equal(detail.systems[0].id, 'system_main_new');
  assert.equal(detail.systems[0].correctLegs, 7);
});


test('game statistics use closing market, frozen form, stored KentaurAI analysis and primary system only', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const stats = await getGameStatistics(env, { gameType:'V86' });

  assert.deepEqual(stats.winners.byBetPercent.find(row=>row.label==='50%+'), { label:'50%+', starters:8, winners:8, winRate:1 });
  assert.deepEqual(stats.winners.byMarketRank.find(row=>row.label==='1'), { label:'1', starters:8, winners:8, winRate:1 });
  assert.deepEqual(stats.winners.byForm.find(row=>row.label==='70–79'), { label:'70–79', starters:8, winners:8, winRate:1 });
  assert.deepEqual(stats.winners.byFormRank.find(row=>row.label==='1'), { label:'1', starters:8, winners:8, winRate:1 });
  assert.deepEqual(stats.kentaurai.byRank.find(row=>row.label==='1'), { label:'1', starters:8, winners:8, winRate:1 });
  assert.deepEqual(stats.kentaurai.byAbcd.find(row=>row.label==='A'), { label:'A', starters:8, winners:8, winRate:1 });

  assert.equal(stats.spikes.total,3);
  assert.equal(stats.spikes.winners,3);
  assert.equal(stats.spikes.hitRate,1);
  assert.equal(stats.spikes.items[0].closingBetPercent,60);
  assert.equal(stats.spikes.items[0].closingMarketRank,1);
  assert.equal(stats.spikes.items[0].formScore,72);
  assert.equal(stats.spikes.items[0].kaiRank,1);

  assert.deepEqual(stats.payoutPerformance.find(row=>row.label==='20 000–99 999 kr'), {
    label:'20 000–99 999 kr', rounds:1, averageCorrect:6, correct8:0, correct7:0, correct6:1, correct5:0
  });
});

test('game history winner cards expose frozen form and final closing market without overwriting prediction context', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const detail = await getGameHistoryDetail(env,'round_1');
  const result = detail.legs[0].systems.system_main;
  assert.equal(result.winnerPrediction.rawRank,1);
  assert.equal(result.winnerPrediction.abcdGroup,'A');
  assert.equal(result.winnerContext.formScore,72);
  assert.equal(result.winnerContext.formRank,1);
  assert.equal(result.winnerContext.closingBetPercent,60);
  assert.equal(result.winnerContext.closingMarketRank,1);
});


test('game statistics never borrow Form from an unrelated later Step 1 pack', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`INSERT INTO analysis_entry_form_snapshots
    (id,game_round_id,step1_pack_id,leg_number,race_entry_id,as_of,form_version,form_score,used_starts,form_rank)
    VALUES ('later_wrong','round_1','pack_later',1,'winner_1','2099-01-02T09:00:00Z','horse-form-index-v1',99,5,1)`).run();

  const stats = await getGameStatistics(env, { gameType:'V86' });
  const expected = stats.winners.byForm.find(row=>row.label==='70–79');
  const wrong = stats.winners.byForm.find(row=>row.label==='80+');
  assert.equal(expected.winners,8);
  assert.equal(wrong.winners,0);

  const detail = await getGameHistoryDetail(env,'round_1');
  assert.equal(detail.legs[0].systems.system_main.winnerContext.formScore,72);
});


test('game statistics exclude analyses created after the registered system', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare(`INSERT INTO ai_race_analyses
    (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at)
    VALUES ('analysis_late','race_1','model_1','2099-01-02T11:00:00Z',1,'2099-01-02T11:00:00Z')`).run();
  db.prepare(`INSERT INTO ai_horse_predictions
    (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group)
    VALUES ('pred_late','analysis_late','winner_1',0.01,9,'D')`).run();

  const stats = await getGameStatistics(env, { gameType:'V86' });
  assert.equal(stats.kentaurai.byRank.find(row=>row.label==='1').winners,8);
  assert.equal(stats.kentaurai.byRank.find(row=>row.label==='9').winners,0);
  assert.equal(stats.kentaurai.byAbcd.find(row=>row.label==='A').winners,8);
  assert.equal(stats.kentaurai.byAbcd.find(row=>row.label==='D').winners,0);
});
