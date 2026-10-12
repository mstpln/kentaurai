import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('selective preview workflow cannot perform destructive production cleanup', () => {
  const yml = readFileSync(new URL('../.github/workflows/production-storage-selective-preview.yml', import.meta.url),'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-selective-storage-preview.mjs', import.meta.url),'utf8');
  assert.match(yml,/workflow_dispatch:/);
  assert.match(yml,/group: kentaurai-production-operation/);
  assert.match(yml,/Require exact successful production release/);
  assert.match(yml,/Run QA before any Cloudflare interaction/);
  assert.match(yml,/secret put STORAGE_CLEANUP_TOKEN/);
  assert.match(yml,/secret delete STORAGE_CLEANUP_TOKEN/);
  assert.match(yml,/always\(\)/);
  assert.match(yml,/health/);
  assert.doesNotMatch(yml,/secrets\.ADMIN_TOKEN|mode.*execute|snapshots\/execute|raw\/execute|time-travel restore/i);
  assert.match(runner,/preview-selective/);
  assert.match(runner,/response\.status !== 401/);
  assert.match(runner,/attempt < 10/);
  assert.match(runner,/MAX_TOTAL_ROWS_READ = 100000/);
  assert.match(runner,/MAX_PAGES_PER_FAMILY = 1/);
  assert.doesNotMatch(runner,/console\.log\([^\n]*cursor|console\.log\([^\n]*sourceId/);
});

function runSyntheticPreview(returnJson) {
  const runner = new URL('../scripts/run-production-selective-storage-preview.mjs', import.meta.url).href;
  const code = `
    globalThis.fetch = async (_url, options) => {
      const family = JSON.parse(options.body).family;
      return { status:200, ok:true, json:async () => (${returnJson})(family) };
    };
    await import(${JSON.stringify(runner)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding:'utf8', timeout:10000,
    env:{...process.env, WORKER_URL:'https://diagnostic.invalid',
      CLEANUP_TOKEN:'synthetic-token', GITHUB_STEP_SUMMARY:''}
  });
}

test('runner returns a valid partial-safe aggregate report for empty families', () => {
  const child = runSyntheticPreview(`() => ({
    cost:{rowsRead:0},
    diagnostic:{pageRowsRead:0,sourceProofRowsRead:0,rawHeadRequests:0},
    rowsScanned:0,rowsQuarantined:0,rowsRemovable:0,nextCursor:null
  })`);
  assert.equal(child.status,0,child.stderr);
  const events = child.stdout.split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(events.filter((row) => row.event === 'selective_preview_page_cost').length,4);
  assert.equal(events.find((row) => row.event === 'selective_snapshot_preview_cost')?.allFamiliesComplete,true);
  assert.doesNotMatch(child.stdout,/synthetic-token|sourceRecordId|raw\/official_provider/);
});

test('runner logs safe query totals before stopping on an API safety breach', () => {
  const child = runSyntheticPreview(`() => ({
    safetyStop:true,cost:{rowsRead:250001},
    diagnostic:{pageRowsRead:250001,sourceProofRowsRead:0,rawHeadRequests:0}
  })`);
  assert.equal(child.status,1,child.stderr);
  assert.match(child.stdout,/"event":"selective_preview_page_cost"/);
  assert.match(child.stdout,/"safetyStop":true/);
  assert.match(child.stderr,/D1 operation safety stop/);
});

test('runner rejects missing D1 cost breakdown instead of printing invented zero', () => {
  const child = runSyntheticPreview(`() => ({
    cost:{rowsRead:1},
    diagnostic:{pageRowsRead:null,sourceProofRowsRead:0,rawHeadRequests:0}
  })`);
  assert.equal(child.status,1,child.stderr);
  assert.match(child.stderr,/cost breakdown unavailable/);
  assert.doesNotMatch(child.stdout,/"event":"selective_preview_page_cost"/);
});
