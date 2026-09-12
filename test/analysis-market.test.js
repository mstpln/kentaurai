import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getVerifiedAnalysisMarket } from '../src/analysis-market.js';

function seed(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track-e','Synthetic E')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at) VALUES ('round-e','V85','2099-05-01','2099-05-01T13:55:00Z')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('race-e','track-e','2099-05-01',1),('race-other','track-e','2099-05-01',2)").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round-e',1,'race-e')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-e','Horse E'),('horse-other','Horse Other')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES ('entry-e','race-e','horse-e',1,0),('entry-other','race-other','horse-other',1,0)").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('source-e','official_provider','2099-05-01T13:50:00Z','verified')").run();
}

test('Build E market context uses latest source-backed snapshot no later than betting stop', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES ('old','round-e',1,'entry-e','2099-05-01T13:40:00Z',20,2,'source-e'),('latest','round-e',1,'entry-e','2099-05-01T13:54:00Z',35,1,'source-e'),('after','round-e',1,'entry-e','2099-05-01T13:56:00Z',80,1,'source-e')").run();
  db.prepare("INSERT INTO odds_snapshots (id,race_entry_id,captured_at,market_type,odds,source_record_id) VALUES ('odds-ok','entry-e','2099-05-01T13:54:30Z','win',3.5,'source-e'),('odds-after','entry-e','2099-05-01T13:56:30Z','win',1.2,'source-e')").run();

  const result = await getVerifiedAnalysisMarket(env, 'round-e', '2099-05-01T14:00:00Z');
  assert.equal(result.cutoff, '2099-05-01T13:55:00Z');
  assert.equal(result.deadlineSource, 'bet_stop_at');
  assert.equal(result.definitionVersion, 'verified-market-at-stop-v1');
  assert.equal(result.betting.length, 1);
  assert.equal(result.betting[0].betPercent, 35);
  assert.equal(result.betting[0].capturedAt, '2099-05-01T13:54:00Z');
  assert.equal(result.odds.length, 1);
  assert.equal(result.odds[0].odds, 3.5);
});

test('Build E market context rejects unprovenanced and cross-round market rows', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank) VALUES ('unknown-source','round-e',1,'entry-e','2099-05-01T13:54:00Z',70,1)").run();
  db.prepare("INSERT INTO odds_snapshots (id,race_entry_id,captured_at,market_type,odds,source_record_id) VALUES ('other-race','entry-other','2099-05-01T13:54:00Z','win',2.0,'source-e')").run();

  const result = await getVerifiedAnalysisMarket(env, 'round-e', '2099-05-01T13:54:30Z');
  assert.deepEqual(result.betting, []);
  assert.deepEqual(result.odds, []);
});

test('Build E market context falls back to verified round start when betting stop is absent', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  db.prepare("UPDATE game_rounds SET bet_stop_at=NULL, scheduled_start_at='2099-05-01T14:00:00Z' WHERE id='round-e'").run();
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES ('fallback-ok','round-e',1,'entry-e','2099-05-01T13:59:00Z',44,1,'source-e'),('fallback-after','round-e',1,'entry-e','2099-05-01T14:01:00Z',99,1,'source-e')").run();

  const result = await getVerifiedAnalysisMarket(env, 'round-e', '2099-05-01T14:05:00Z');
  assert.equal(result.betStopAt, null);
  assert.equal(result.marketDeadlineAt, '2099-05-01T14:00:00Z');
  assert.equal(result.deadlineSource, 'round_scheduled_start_at');
  assert.equal(result.definitionVersion, 'verified-market-at-round-start-v1');
  assert.equal(result.cutoff, '2099-05-01T14:00:00Z');
  assert.equal(result.betting.length, 1);
  assert.equal(result.betting[0].betPercent, 44);
});

test('Build E market context fails closed without betting stop or verified round start', async () => {
  const { db, env } = createTestEnv();
  seed(db);
  db.prepare("UPDATE game_rounds SET bet_stop_at=NULL, scheduled_start_at=NULL WHERE id='round-e'").run();
  await assert.rejects(getVerifiedAnalysisMarket(env, 'round-e', '2099-05-01T13:50:00Z'), /verified betting stop or round start/);
});
