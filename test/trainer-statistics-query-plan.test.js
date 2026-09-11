import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getTrainerDetailStatistics, getTrainerRankings } from '../src/statistics/trainers.js';

function capturePreparedQueries(env) {
  const originalPrepare = env.DB.prepare.bind(env.DB);
  const captures = [];
  env.DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    const capture = { sql, bindings: [] };
    captures.push(capture);
    const originalBind = statement.bind.bind(statement);
    statement.bind = (...args) => { capture.bindings = args; return originalBind(...args); };
    return statement;
  };
  return captures;
}

function planText(db, capture) {
  return db.prepare(`EXPLAIN QUERY PLAN ${capture.sql}`).all(...capture.bindings).map((row) => row.detail).join('\n');
}
function directPlan(db, sql, ...bindings) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings).map((row) => row.detail).join('\n');
}

test('trainer statistics core and market queries retain indexed access paths', async () => {
  const { db, env } = createTestEnv();
  const captures = capturePreparedQueries(env);
  await getTrainerRankings(env, { period: '3m', asOfDate: '2026-09-11' });
  const core = captures.find((item) => item.sql.includes('WITH trainer_stats AS'));
  const market = captures.find((item) => item.sql.includes('WITH market_candidates AS'));
  assert.ok(core); assert.ok(market);
  assert.match(planText(db, core), /idx_races_date/i, 'period ranking must retain race-date indexed access');
  assert.match(planText(db, market), /betting_snapshots|idx_betting/i, 'market-at-stop query must retain indexed betting access');
  assert.match(
    directPlan(db, 'SELECT id FROM race_entries WHERE trainer_id = ? AND race_id = ?', 'trainer-x', 'race-x'),
    /idx_entries_trainer/i,
    'trainer/race lookup can use the Build D index'
  );
});

test('trainer detail summary can use trainer or race-date indexes without changing factual semantics', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-x','Synthetic Trainer')").run();
  const captures = capturePreparedQueries(env);
  await getTrainerDetailStatistics(env, 'trainer-x', { period: '1y', asOfDate: '2026-09-11' });
  const summary = captures.find((item) => item.sql.includes('JOIN trainers t ON t.id=re.trainer_id') && item.sql.includes('t.id=?') && !item.sql.includes('market_candidates') && !item.sql.includes('trainer_home'));
  assert.ok(summary, 'detail summary query should be captured');
  assert.match(planText(db, summary), /idx_entries_trainer|idx_races_date/i);
});
