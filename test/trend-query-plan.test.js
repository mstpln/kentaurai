import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrendQuery } from '../src/statistics/trend.js';
import { createTestEnv } from './helpers/d1.js';

test('Trend query plan starts from the existing race-date index and indexed race-entry join', () => {
  const { db } = createTestEnv();
  const query = buildTrendQuery({ category: 'horses', period: '3m', asOfDate: '2026-09-11' });
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.bindings);
  const details = plan.map((row) => String(row.detail || '')).join('\n');

  assert.match(details, /idx_races_date/);
  assert.match(details, /idx_entries_race/);
  assert.match(details, /race_results/);
});

test('filtered Trend plan can reuse existing race classification and track indexes without a new stats table', () => {
  const { db } = createTestEnv();
  const query = buildTrendQuery({
    category: 'trainers',
    period: '1y',
    raceScope: 'high_prize',
    trackId: 'synthetic-track',
    raceType: 'monte',
    breedType: 'warmblood',
    startMethod: 'volt',
    asOfDate: '2026-09-11'
  });
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.bindings);
  const details = plan.map((row) => String(row.detail || '')).join('\n');

  assert.match(details, /idx_races_date/);
  assert.match(details, /idx_race_type_classifications_type|sqlite_autoindex_race_type_classifications/);
  assert.doesNotMatch(details, /SCAN race_entries(?:\s|$)/, 'race entries should not require an unindexed full-table scan');
});
