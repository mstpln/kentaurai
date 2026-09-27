import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
