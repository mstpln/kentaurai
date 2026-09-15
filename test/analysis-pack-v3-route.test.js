import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v067.js';

const URL = 'https://example.test/v1/analysis-pack/private-probe';

test('D1 private analysis-pack route rejects missing and invalid admin auth before DB work', async () => {
  const missing = await worker.fetch(new Request(URL), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthorized');

  const invalid = await worker.fetch(new Request(URL, { headers: { authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error, 'unauthorized');
});

test('D1 private analysis-pack route fails closed when ADMIN_TOKEN is not configured', async () => {
  const response = await worker.fetch(new Request(URL), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});
