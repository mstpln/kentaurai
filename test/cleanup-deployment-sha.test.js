import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v079.js';

test('health exposes the exact reviewed production commit supplied by deployment, not caller input', async () => {
  const sha = 'a'.repeat(40);
  const response = await worker.fetch(
    new Request('https://kentaurai.invalid/health?deploymentSha=' + 'b'.repeat(40)),
    { KENTAURAI_DEPLOY_SHA: sha }
  );
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.ok, true);
  assert.equal(status.service, 'kentaurai-api');
  assert.equal(status.deploymentSha, sha);
});

test('unbound or invalid deployment identity fails closed for production cleanup preflight', async () => {
  for (const supplied of [undefined, null, 'not-a-commit', 'A'.repeat(40)]) {
    const response = await worker.fetch(
      new Request('https://kentaurai.invalid/health'),
      { KENTAURAI_DEPLOY_SHA: supplied }
    );
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.deploymentSha, null);
  }
});
