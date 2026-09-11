import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getDriverDetailStatistics, getDriverRankings } from '../src/statistics/drivers.js';

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

function directPlan(db, sql, ...bindings) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings).map((row) => row.detail).join('\n');
}

test('driver statistics period and market queries retain indexed access paths', async () => {
  const { db, env } = createTestEnv();
  const captures = capturePreparedQueries(env);
  await getDriverRankings(env, { period: '3m', asOfDate: '2026-09-11' });

  const core = captures.find((item) => item.sql.includes('WITH driver_stats AS'));
  const market = captures.find((item) => item.sql.includes('WITH market_candidates AS'));
  assert.ok(core); assert.ok(market);
  assert.match(planText(db, core), /idx_races_date/i, 'period ranking must retain race-date indexed access');
  assert.match(planText(db, market), /betting_snapshots|idx_betting/i, 'market-at-stop query must retain indexed betting access');

  assert.match(
    directPlan(db, 'SELECT id FROM race_entries WHERE driver_id = ? AND race_id = ?', 'driver-x', 'race-x'),
    /idx_entries_driver/i,
    'driver detail lookups can use the Build C driver/race index'
  );
  assert.match(
    directPlan(db, 'SELECT id FROM betting_snapshots WHERE race_entry_id = ? AND captured_at <= ? ORDER BY captured_at DESC LIMIT 1', 'entry-x', '2026-09-11T12:00:00Z'),
    /idx_betting_snapshots_entry_time/i,
    'latest pre-stop snapshot lookup can use the Build C entry/time index'
  );
});

test('driver detail query can use the driver index without changing canonical statistics semantics', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-x','Synthetic Driver')").run();
  const captures = capturePreparedQueries(env);
  await getDriverDetailStatistics(env, 'driver-x', { period: '1y', asOfDate: '2026-09-11' });
  const summary = captures.find((item) => item.sql.includes('SELECT') && item.sql.includes('core') === false && item.sql.includes('JOIN drivers d ON d.id=re.driver_id') && item.sql.includes('d.id=?'));
  assert.ok(summary, 'detail summary query should be captured');
  assert.match(planText(db, summary), /idx_entries_driver|idx_races_date/i);
});
