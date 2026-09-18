import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v071.js';

const ADMIN_URL = 'https://example.test/v1/analysis-decision-probability/round-e1';
const APP_URL = 'https://example.test/app/api/settings/analysis-decision-probability?round_id=round-e1';

test('E1 decision routes reject missing admin auth before database work', async () => {
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

test('E1 admin route fails closed when ADMIN_TOKEN is not configured', async () => {
  const response = await worker.fetch(new Request(ADMIN_URL), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});

test('E1 validates required lock binding before database queries', async () => {
  let queries = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { queries += 1; throw new Error('unexpected DB access'); } }
  };
  const response = await worker.fetch(new Request(ADMIN_URL, {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /lock_id is required/);
  assert.equal(queries, 0);
});

test('E1 app route fails closed when session auth is not configured', async () => {
  const response = await worker.fetch(new Request(APP_URL), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});
