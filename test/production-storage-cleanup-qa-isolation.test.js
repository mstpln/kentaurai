import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('cleanup subprocess suites pass with an inherited real-world read-only continuation marker', { timeout: 90_000 }, () => {
  // Reproduce production run #22's environment. Without isolation, normal
  // runner tests exit immediately with "requires an audit ID" and execute
  // simulations refuse the inherited read-only continuation marker.
  const child = spawnSync(process.execPath, [
    '--test',
    'test/production-storage-cleanup-continuation.test.js',
    'test/production-storage-cleanup-runner.test.js'
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      MODE: 'dry-run',
      CLEANUP_TRIGGER_CONFIRMATION: 'RESUME READ ONLY AUDIT',
      CLEANUP_AUDIT_RUN_ID: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      CLEANUP_SESSION_ID: '',
      CLEANUP_CONTINUATION_REQUEST: '123456789',
      DRY_RUN_MAX_BATCHES: '50',
      CLEANUP_SOFT_DEADLINE_MS: '2100000',
      CLEANUP_RUN_MAX_ROWS_READ: '1000000',
      CLEANUP_RUN_MAX_ROWS_WRITTEN: '100000',
      GITHUB_OUTPUT: '/invalid/production-output'
    },
    encoding: 'utf8',
    timeout: 80_000,
    maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0,
    ['Nested cleanup QA must be independent of inherited production state.',
      child.stderr || '', (child.stdout || '').slice(-4000)].join(String.fromCharCode(10)));
  assert.match(child.stdout, /# fail 0/);
});
