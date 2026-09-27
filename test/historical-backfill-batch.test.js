import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import {
  MAX_HISTORICAL_CHECKPOINTS_PER_BATCH,
  runHistoricalBackfillBatch,
  runHistoricalBackfillStep
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

test('automatic official history ignores multi-day backfill jobs', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`
    INSERT INTO historical_backfill_jobs (id,start_date,end_date,next_date,status)
    VALUES ('long_history','2098-01-01','2099-01-01','2099-01-01','running')
  `).run();

  assert.deepEqual(await runHistoricalBackfillStep(env), { status:'idle', done:true });
});

test('automatic maintenance is reduced to one bounded morning schedule', () => {
  const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(wrangler.triggers?.crons, ['15 5 * * *']);

  const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(indexSource, /const BACKFILL_CRON = '\\* \\* \\* \\* \\*'/);
  assert.doesNotMatch(indexSource, /live_capture_evening/);
  assert.doesNotMatch(indexSource, /statistics_data_backfill', \(\) => runNextStatisticsDataBackfill/);
  assert.doesNotMatch(indexSource, /xlabs_interval_repair', \(\) => runXlabsIntervalRepairBatch/);
  assert.doesNotMatch(indexSource, /xlabs_position_reconstruction', \(\) => runXlabsPositionReconstructionBatch/);
  assert.match(indexSource, /official_daily_incremental/);
  assert.match(indexSource, /xlabs_daily_incremental/);

  const extensionWorkflow = readFileSync(new URL('../.github/workflows/extend-production-history-2020-2023.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(extensionWorkflow, /^\s*schedule:\s*$/m);
  assert.match(extensionWorkflow, /workflow_dispatch:/);
});
