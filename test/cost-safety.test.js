import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { applyRunSafetyResult, createRunSafetyState, observeD1Operation } from '../src/cost-safety.js';
import { createTestEnv } from './helpers/d1.js';

test('cost observer reports only counts and trips the run-local circuit breaker', async () => {
  const { env } = createTestEnv();
  const logs = [];
  const originalInfo = console.info;
  console.info = (line) => logs.push(String(line));
  try {
    const observed = await observeD1Operation(env, 'synthetic', async (observedEnv) => {
      await observedEnv.DB.batch([
        observedEnv.DB.prepare("INSERT INTO horses (id,canonical_name) VALUES ('cost-horse','Cost Horse')"),
        observedEnv.DB.prepare("INSERT INTO horses (id,canonical_name) VALUES ('cost-horse-2','Cost Horse 2')")
      ]);
      return { privatePayload: 'not logged' };
    }, { rowsRead: 10, rowsWritten: 0, durationMs: 10000 });
    assert.equal(observed.metrics.rowsWritten, 2);
    assert.equal(observed.safetyStop, true);
    const state = createRunSafetyState();
    applyRunSafetyResult(state, 'synthetic', observed);
    assert.deepEqual({ stopped: state.stopped, reason: state.reason }, { stopped: true, reason: 'abnormal_cost:synthetic' });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('privatePayload'), false);
  assert.match(logs[0], /"rowsRead":0,"rowsWritten":2/);
});

test('Step 1 export has no repair, historical backfill or automatic retry dependency', () => {
  const source = readFileSync(new URL('../src/f3-private-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /repair|historical[_-]backfill|runHistorical|while\s*\(/i);
  assert.match(source, /observeD1Operation\(env, 'step1_export'/);
});

test('production config preserves exactly the single morning cron', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const crons = [...config.matchAll(/"(\d+\s+\d+\s+\*\s+\*\s+\*)"/g)].map((match) => match[1]);
  assert.deepEqual(crons, ['15 5 * * *']);
});


test('cost observer counts reads performed through D1 first()', async () => {
  const { env } = createTestEnv();
  await env.DB.prepare("INSERT INTO horses (id,canonical_name) VALUES ('first-a','First A')").run();
  await env.DB.prepare("INSERT INTO horses (id,canonical_name) VALUES ('first-b','First B')").run();

  const observed = await observeD1Operation(env, 'synthetic_first', async (observedEnv) => {
    return observedEnv.DB.prepare('SELECT id,canonical_name FROM horses ORDER BY id').first();
  }, { rowsRead: 0, rowsWritten: 100, durationMs: 10000 });

  assert.equal(observed.value.id, 'first-a');
  assert.equal(observed.metrics.rowsRead, 1);
  assert.equal(observed.safetyStop, true);
});


test('cumulative morning cost safety stops after individually safe operations', () => {
  const state = createRunSafetyState({ rowsRead: 100, rowsWritten: 100, durationMs: 1000 });
  applyRunSafetyResult(state, 'first_part', {
    safetyStop: false,
    cost: { rowsRead: 60, rowsWritten: 10, durationMs: 100 }
  });
  assert.equal(state.stopped, false);

  applyRunSafetyResult(state, 'second_part', {
    safetyStop: false,
    cost: { rowsRead: 50, rowsWritten: 5, durationMs: 100 }
  });
  assert.equal(state.stopped, true);
  assert.equal(state.reason, 'abnormal_cost:second_part');
  assert.deepEqual(state.metrics, { rowsRead: 110, rowsWritten: 15, durationMs: 200 });
});


test('cost-efficiency migration keeps live progress and recent selectors indexed', () => {
  const { db } = createTestEnv();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  assert.ok(tables.has('official_live_normalization_state'));
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  for (const name of [
    
    'idx_import_runs_live_normalize_success_cursor',
    'idx_import_runs_scheduled_orchestrator_started',
    'idx_source_records_recent_normalized_official',
    
  ]) assert.ok(indexes.has(name), `missing ${name}`);
});

test('morning scheduler centralizes promotion jobs and stops all later processors after abnormal cumulative cost', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /recent_start_points_promotion/);
  assert.match(source, /recent_official_snapshot_promotion/);
  assert.match(source, /async function critical\(name, action\)[\s\S]*?if \(safety\.stopped\)/);
  assert.match(source, /daysAhead: 6/);
});

test('GitHub operational workflows contain no recurring schedule', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const name of readdirSync(directory).filter((value) => value.endsWith('.yml') || value.endsWith('.yaml'))) {
    const workflow = readFileSync(new URL(name, directory), 'utf8');
    assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m, `${name} must remain non-scheduled`);
    assert.doesNotMatch(workflow, /^\s*-\s*cron:\s*/m, `${name} must not add a GitHub cron`);
  }
});


test('cost observer preserves first(column) semantics without reading the full result set', async () => {
  const { env } = createTestEnv();
  for (const id of ['first-c','first-d','first-e']) {
    await env.DB.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').bind(id, id).run();
  }

  const observed = await observeD1Operation(env, 'synthetic_first_column', async (observedEnv) => {
    return observedEnv.DB.prepare('SELECT id,canonical_name FROM horses ORDER BY id').first('canonical_name');
  }, { rowsRead: 10, rowsWritten: 100, durationMs: 10000 });

  assert.equal(observed.value, 'first-c');
  assert.equal(observed.metrics.rowsRead, 1);
  assert.equal(observed.safetyStop, false);

  await assert.rejects(
    () => observeD1Operation(env, 'synthetic_first_missing_column', (observedEnv) =>
      observedEnv.DB.prepare('SELECT id FROM horses ORDER BY id').first('missing_column')
    ),
    /column not found/
  );
});
