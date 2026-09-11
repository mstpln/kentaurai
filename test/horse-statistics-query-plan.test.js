import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getHorseRankings } from '../src/statistics/horses.js';

function capturePreparedQueries(env) {
  const originalPrepare = env.DB.prepare.bind(env.DB);
  const captures = [];
  env.DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    const capture = { sql, bindings: [] };
    captures.push(capture);
    const originalBind = statement.bind.bind(statement);
    statement.bind = (...args) => {
      capture.bindings = args;
      return originalBind(...args);
    };
    return statement;
  };
  return captures;
}

function planText(db, capture) {
  return db.prepare(`EXPLAIN QUERY PLAN ${capture.sql}`).all(...capture.bindings).map((row) => row.detail).join('\n');
}

test('horse statistics period queries reuse existing indexes and rest query keeps indexed joins', async () => {
  const { db, env } = createTestEnv();
  const captures = capturePreparedQueries(env);
  await getHorseRankings(env, { period: '3m', asOfDate: '2026-09-11' });

  const core = captures.find((item) => item.sql.includes('WITH horse_stats AS'));
  const xlabs = captures.find((item) => item.sql.includes('WITH latest_x AS'));
  const rest = captures.find((item) => item.sql.includes('WITH actual AS'));
  assert.ok(core); assert.ok(xlabs); assert.ok(rest);

  const corePlan = planText(db, core);
  assert.match(corePlan, /idx_races_date/i, 'period ranking must use the existing race-date index');
  assert.match(corePlan, /idx_entries_race|race_entries.*race_id/i, 'race-entry join remains indexed');

  const xlabsPlan = planText(db, xlabs);
  assert.match(xlabsPlan, /idx_races_date/i);
  assert.match(xlabsPlan, /xlabs|source_records/i);

  const restPlan = planText(db, rest);
  assert.match(restPlan, /race_entries|idx_entries_race/i);
  assert.match(restPlan, /race_results/i);
});
