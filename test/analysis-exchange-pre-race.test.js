import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { prepareAnalysisContext } from '../src/analysis-api.js';

test('analysis context fails closed after the stored betting deadline', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES ('settled_analysis_round','V85','2020-01-01','2020-01-01T14:00:00Z','2020-01-01T13:55:00Z','results')
  `).run();

  await assert.rejects(
    prepareAnalysisContext(env, 'settled_analysis_round', 'pre_market'),
    /pre-race only/
  );
});

test('analysis context fails closed when no verified pre-race deadline exists', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('undated_analysis_round','V86','2099-01-01','upcoming')`).run();

  await assert.rejects(
    prepareAnalysisContext(env, 'undated_analysis_round', 'pre_market'),
    /no verified pre-race analysis deadline/
  );
});
