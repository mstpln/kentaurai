import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manual production storage cleanup workflow stays gated and bounded', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-storage-cleanup.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /EXECUTE REVIEWED STORAGE CLEANUP/);
  assert.match(workflow, /STORAGE_CLEANUP_TOKEN/);
  assert.match(workflow, /wrangler@4\.114\.0 secret put STORAGE_CLEANUP_TOKEN/);
  assert.match(workflow, /secret delete STORAGE_CLEANUP_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.ADMIN_TOKEN|secrets\.KENTAURAI_ADMIN_TOKEN/);
  assert.match(workflow, /time_travel\/bookmark/);
  assert.match(workflow, /Wait for cleanup auth to propagate/);
  assert.match(workflow, /storage-cleanup\/auth-check/);
  assert.match(workflow, /seq 1 15/);
  assert.match(workflow, /concurrency:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /execution_scope:/);
  assert.match(workflow, /until-complete/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /Queue automatic continuation/);
  assert.match(workflow, /production-storage-cleanup\.yml\/dispatches/);
  assert.match(workflow, /continuation_session/);
  assert.match(runner, /MAX_BATCHES > 250/);
  assert.match(runner, /AUTO_TIME_BUDGET_MS/);
  assert.match(runner, /storage-cleanup\/session\/start/);
  assert.match(runner, /storage-cleanup\/session\/checkpoint/);
  assert.match(runner, /CHECKPOINT_EVERY = 10/);
  assert.match(runner, /limit: 25/);
  assert.match(runner, /safetyStop === true/);
  assert.match(runner, /execution count differed from its dry-run plan/);
  assert.match(runner, /response\.status === 401/);
  assert.match(runner, /attempt <= 15/);
  assert.doesNotMatch(runner, /historical_all|backfill|repair/i);
});
