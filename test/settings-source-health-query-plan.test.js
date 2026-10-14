import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestEnv } from './helpers/d1.js';
import { getSettingsSourceHealth } from '../src/settings-source-health.js';

const COLUMNS = 'id, source_type, started_at, finished_at, status, error_count, error_json';
const EXACT_QUERY = `
  SELECT ${COLUMNS}
  FROM import_runs
  WHERE source_type = ?
  ORDER BY datetime(started_at) DESC, id DESC
  LIMIT 1
`;
const FAMILY_QUERY = `
  SELECT ${COLUMNS}
  FROM import_runs
  WHERE lower(source_type) LIKE ?
  ORDER BY datetime(started_at) DESC, id DESC
  LIMIT 1
`;

function assertIndexedOrder(db, query, argument, indexName) {
  const details = db.prepare('EXPLAIN QUERY PLAN ' + query)
    .all(argument).map((row) => row.detail);
  assert.ok(details.some((detail) => detail.includes(indexName)), details.join(' | '));
  assert.ok(details.every((detail) => !detail.includes('USE TEMP B-TREE FOR ORDER BY')), details.join(' | '));
}

test('Settings import-run lookups use indexed datetime ordering without changing source-health results', async () => {
  const { env, db } = createTestEnv();
  const insert = db.prepare(`
    INSERT INTO import_runs
      (id, source_type, started_at, status, error_count, error_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [id, type, started, failed] of [
    ['capture-old', 'official_live_scheduled_capture', '2099-09-21T19:00:00.000Z', false],
    ['capture-iso', 'official_live_scheduled_capture', '2099-09-21T19:58:00.000Z', false],
    ['capture-legacy', 'official_live_scheduled_capture', '2099-09-21 19:59:00', true],
    ['normalize-old', 'official_live_normalize_auto', '2099-09-21T19:10:00.000Z', false],
    ['xlabs-old', 'xlabs_daily', '2099-09-21T19:30:00.000Z', false],
    ['xlabs-fail', 'xlabs_daily', '2099-09-21T19:55:00.000Z', true],
    ['unrelated-newest', 'other_job', '2099-09-21T20:00:00.000Z', false]
  ]) {
    insert.run(id, type, started, failed ? 'failed' : 'success',
      failed ? 1 : 0, failed ? JSON.stringify({ message: id }) : null);
  }

  assertIndexedOrder(db, EXACT_QUERY, 'official_live_scheduled_capture',
    'idx_import_runs_settings_exact_source_datetime');
  assertIndexedOrder(db, FAMILY_QUERY, '%official%',
    'idx_import_runs_settings_family_datetime');
  assertIndexedOrder(db, FAMILY_QUERY, '%xlab%',
    'idx_import_runs_settings_family_datetime');

  assert.equal(db.prepare(EXACT_QUERY).get('official_live_scheduled_capture').id, 'capture-legacy');
  assert.equal(db.prepare(FAMILY_QUERY).get('%official%').id, 'capture-legacy');
  assert.equal(db.prepare(FAMILY_QUERY).get('%xlab%').id, 'xlabs-fail');

  const health = await getSettingsSourceHealth(env, {
    now: new Date('2099-09-21T20:00:00Z')
  });
  assert.equal(health.sources.find((source) => source.id === 'official').status, 'error_retrying');
  assert.equal(health.sources.find((source) => source.id === 'xlabs').status, 'error_retrying');
  assert.ok(health.alerts.some((alert) => alert.key.includes('capture-legacy')));
  assert.ok(health.alerts.some((alert) => alert.key.includes('xlabs-fail')));
});
