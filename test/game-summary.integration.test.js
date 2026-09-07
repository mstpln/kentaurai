import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getGameHistorySummary } from '../src/routes/game-summary.js';

test('Spel overview counts only the latest review per primary system and race', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_1','V86','2099-01-02','finished')`).run();
  db.prepare(`INSERT INTO races (id, race_date, race_number) VALUES ('race_1','2099-01-02',1)`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_main','round_1','main',200,128,3,'2099-01-02T10:00:00Z')`).run();
  db.prepare(`INSERT INTO post_race_reviews (id, game_round_id, race_id, system_id, error_type, created_at) VALUES ('review_old','round_1','race_1','system_main','old_error','2099-01-02T12:00:00Z')`).run();
  db.prepare(`INSERT INTO post_race_reviews (id, game_round_id, race_id, system_id, error_type, created_at) VALUES ('review_new','round_1','race_1','system_main','scenario_error','2099-01-02T13:00:00Z')`).run();

  const summary = await getGameHistorySummary(env);
  assert.deepEqual(summary.errorTypes, [{ type: 'scenario_error', count: 1 }]);
});
