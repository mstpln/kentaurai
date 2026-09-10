import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  MAX_HISTORICAL_CHECKPOINTS_PER_BATCH,
  runHistoricalBackfillBatch
} from '../src/import/official-historical-backfill.js';
import {
  MAX_XLABS_CHECKPOINTS_PER_BATCH,
  runXlabsBackfillBatch
} from '../src/import/xlabs-backfill.js';

const BATCHES = [
  ['official', runHistoricalBackfillBatch, MAX_HISTORICAL_CHECKPOINTS_PER_BATCH],
  ['X-Labs', runXlabsBackfillBatch, MAX_XLABS_CHECKPOINTS_PER_BATCH]
];

for (const [label, runBatch, maximum] of BATCHES) {
  test(`${label} batch runs at most three checkpoint steps sequentially`, async () => {
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const order = [];
    const result = await runBatch({}, null, {
      async stepImpl() {
        calls += 1;
        const current = calls;
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`start-${current}`);
        await Promise.resolve();
        order.push(`finish-${current}`);
        active -= 1;
        return { jobId: `${label}-job`, status: 'running', done: false, checkpoint: current };
      }
    });

    assert.equal(maximum, 3);
    assert.equal(calls, 3);
    assert.equal(result.stepCount, 3);
    assert.equal(maxActive, 1);
    assert.deepEqual(order, [
      'start-1', 'finish-1',
      'start-2', 'finish-2',
      'start-3', 'finish-3'
    ]);
  });

  test(`${label} batch stops on completion, busy and idle results`, async (t) => {
    for (const terminal of [
      { status: 'completed', done: true },
      { status: 'busy', done: false },
      { status: 'idle', done: true }
    ]) {
      await t.test(terminal.status, async () => {
        let calls = 0;
        const result = await runBatch({}, null, {
          async stepImpl() {
            calls += 1;
            if (calls === 2) return terminal;
            return { status: 'running', done: false };
          }
        });
        assert.equal(calls, 2);
        assert.equal(result.status, terminal.status);
      });
    }
  });

  test(`${label} batch stops immediately when the second checkpoint fails`, async () => {
    let calls = 0;
    const committed = [];
    await assert.rejects(
      () => runBatch({}, null, {
        async stepImpl() {
          calls += 1;
          if (calls === 2) throw new Error('synthetic checkpoint failure');
          committed.push(calls);
          return { status: 'running', done: false };
        }
      }),
      /synthetic checkpoint failure/
    );
    assert.equal(calls, 2);
    assert.deepEqual(committed, [1]);
  });
}

test('minute scheduler prioritizes live normalization and records bounded historical batches', async () => {
  const { env, db } = createTestEnv();
  const queued = [];
  worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env, {
    waitUntil(promise) { queued.push(promise); }
  });
  assert.equal(queued.length, 1);
  await Promise.all(queued);

  const row = db.prepare(`
    SELECT metadata_json
    FROM import_runs
    WHERE source_type = 'scheduled_orchestrator'
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const metadata = JSON.parse(row.metadata_json);
  assert.deepEqual(metadata.parts.map((part) => part.name), [
    'live_normalize',
    'historical_backfill',
    'xlabs_backfill'
  ]);
  assert.equal(metadata.parts[1].result.maxCheckpoints, 3);
  assert.equal(metadata.parts[2].result.maxCheckpoints, 3);
});
