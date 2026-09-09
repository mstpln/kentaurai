import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { runNextPostRaceReview } from '../src/post-race-review.js';

function seedSettledRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_review','Review Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_review','V85','2099-02-01','finished')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_win','Winner'),('horse_other','Other')`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_review','round_review','main',216,144,3,'2099-02-01T10:00:00Z')`).run();

  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('review_race_${leg}','track_review','2099-02-01',${leg})`).run();
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_review',${leg},'review_race_${leg}')`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('review_win_${leg}','review_race_${leg}','horse_win',1),('review_other_${leg}','review_race_${leg}','horse_other',2)`).run();
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text) VALUES ('review_win_${leg}',1,'1')`).run();
    const selected = leg === 2 || leg === 8 ? `review_other_${leg}` : `review_win_${leg}`;
    const spike = leg <= 3 ? 1 : 0;
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent) VALUES ('system_review',${leg},'${selected}',${spike},0.25,0.20)`).run();
  }
}

test('post-race runner writes one deterministic review per settled leg', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  const result = await runNextPostRaceReview(env);
  assert.equal(result.status, 'completed');
  assert.equal(result.roundId, 'round_review');
  assert.equal(result.reviews, 8);

  const rows = db.prepare(`SELECT error_type, selected_in_system, review_json FROM post_race_reviews WHERE system_id='system_review' ORDER BY race_id`).all();
  assert.equal(rows.length, 8);
  assert.equal(rows.filter((row) => row.error_type === 'spike_miss').length, 1);
  assert.equal(rows.filter((row) => row.error_type === 'coverage_miss').length, 1);
  assert.equal(rows.filter((row) => row.selected_in_system === 1).length, 6);
  assert.ok(rows.every((row) => JSON.parse(row.review_json).reviewVersion === 'deterministic-v1'));
  assert.ok(rows.every((row) => ['candidate_learning', 'no_change'].includes(JSON.parse(row.review_json).classification)));
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM model_change_log`).get().count, 0);
});

test('post-race runner is idempotent after a system is reviewed', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  await runNextPostRaceReview(env);
  const second = await runNextPostRaceReview(env);
  assert.equal(second.status, 'idle');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews`).get().count, 8);
});

test('post-race runner resumes a partial deterministic review without duplicates', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  await runNextPostRaceReview(env);
  db.prepare(`DELETE FROM post_race_reviews WHERE race_id='review_race_8'`).run();
  const resumed = await runNextPostRaceReview(env);
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.reviews, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews`).get().count, 8);
  assert.equal(new Set(db.prepare(`SELECT id FROM post_race_reviews`).all().map((row) => row.id)).size, 8);
});

test('post-race runner respects an existing review for the same system and race regardless of review id', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  db.prepare(`INSERT INTO post_race_reviews (id, game_round_id, race_id, race_entry_id, system_id, selected_in_system, review_json) VALUES ('legacy_review','round_review','review_race_1','review_win_1','system_review',1,'{}')`).run();
  const result = await runNextPostRaceReview(env);
  assert.equal(result.status, 'completed');
  assert.equal(result.reviews, 7);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews WHERE system_id='system_review'`).get().count, 8);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews WHERE system_id='system_review' AND race_id='review_race_1'`).get().count, 1);
});

test('post-race runner waits until all eight legs have factual winners', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  db.prepare(`DELETE FROM race_results WHERE race_entry_id='review_win_8'`).run();
  const result = await runNextPostRaceReview(env);
  assert.equal(result.status, 'idle');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews`).get().count, 0);
});

test('post-race runner does not guess a winner when a leg has multiple first-place results', async () => {
  const { env, db } = createTestEnv();
  seedSettledRound(db);
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text) VALUES ('review_other_8',1,'1')`).run();
  const result = await runNextPostRaceReview(env);
  assert.equal(result.status, 'idle');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews`).get().count, 0);
});
