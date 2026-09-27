import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manual production storage cleanup workflow stays gated and bounded', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-storage-cleanup.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /EXECUTE REVIEWED STORAGE CLEANUP/);
  assert.match(workflow, /KENTAURAI_ADMIN_TOKEN/);
  assert.match(workflow, /time_travel\/bookmark/);
  assert.match(workflow, /concurrency:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(runner, /MAX_BATCHES > 250/);
  assert.match(runner, /limit: 25/);
  assert.match(runner, /safetyStop === true/);
  assert.match(runner, /execution count differed from its dry-run plan/);
  assert.doesNotMatch(runner, /historical_all|backfill|repair/i);
});
