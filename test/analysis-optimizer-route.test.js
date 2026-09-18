import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v072.js';

const ADMIN_URL = 'https://example.test/v1/analysis-optimizer/round-e2';
const APP_URL = 'https://example.test/app/api/settings/analysis-optimizer?round_id=round-e2';

test('E2 optimizer routes reject missing admin auth before database work', async () => {
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { throw new Error('DB must not be reached before auth'); } }
  };
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(new Request(ADMIN_URL, { method }), env, {});
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('E2 admin route fails closed when ADMIN_TOKEN is not configured', async () => {
  const response = await worker.fetch(new Request(ADMIN_URL), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});

test('E2 validates required decision and line-price configuration before database queries', async () => {
  let queries = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { queries += 1; throw new Error('unexpected DB access'); } }
  };
  const response = await worker.fetch(new Request(ADMIN_URL, {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /line_price_sek is required/);
  assert.equal(queries, 0);
});

test('E2 app route fails closed when session auth is not configured', async () => {
  const response = await worker.fetch(new Request(APP_URL), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});
