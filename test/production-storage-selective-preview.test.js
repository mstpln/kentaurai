import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(runner,/MAX_PAGES_PER_FAMILY = 2/);
  assert.doesNotMatch(runner,/console\.log\([^\n]*cursor|console\.log\([^\n]*sourceId/);
});
