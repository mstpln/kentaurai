import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-pwa.js';
import { createTestEnv } from './helpers/d1.js';

function seedSettledRound(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_review_worker','Review Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_review_worker','V85','2099-02-02','finished')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse_review_worker','Winner')`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_review_worker','round_review_worker','main',216,1,3,'2099-02-02T10:00:00Z')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('review_worker_race_${leg}','track_review_worker','2099-02-02',${leg})`).run();
    db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_review_worker',${leg},'review_worker_race_${leg}')`).run();
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('review_worker_win_${leg}','review_worker_race_${leg}','horse_review_worker',1)`).run();
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text) VALUES ('review_worker_win_${leg}',1,'1')`).run();
    db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system_review_worker',${leg},'review_worker_win_${leg}',${leg <= 3 ? 1 : 0})`).run();
  }
}

test('manual post-race endpoint is admin protected and runs deterministic review', async () => {
  const { env, db } = createTestEnv();
  env.ADMIN_TOKEN = 'test-admin';
  seedSettledRound(db);

  const denied = await worker.fetch(new Request('https://example.test/v1/post-race/review-next', { method: 'POST' }), env);
  assert.equal(denied.status, 401);

  const response = await worker.fetch(new Request('https://example.test/v1/post-race/review-next', {
    method: 'POST',
    headers: { authorization: 'Bearer test-admin' }
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'completed');
  assert.equal(body.reviews, 8);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM post_race_reviews WHERE system_id='system_review_worker'`).get().count, 8);
});

test('minute scheduler queues the existing orchestrator and deterministic post-race review', async () => {
  const { env } = createTestEnv();
  const queued = [];
  const ctx = { waitUntil(promise) { queued.push(promise); } };
  worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env, ctx);
  assert.equal(queued.length, 2);
  await Promise.all(queued);
});
