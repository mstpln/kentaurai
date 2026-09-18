import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v074.js';

test('F1 replay routes reject missing admin auth before database work', async () => {
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { throw new Error('DB must not be reached before auth'); } }
  };

  const post = await worker.fetch(new Request('https://example.test/v1/replay/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from:'2099-01-01T00:00:00Z', to:'2099-01-31T23:59:59Z' })
  }), env, {});
  assert.equal(post.status, 401);
  assert.equal((await post.json()).error, 'unauthorized');

  const get = await worker.fetch(new Request('https://example.test/v1/replay/replay_probe'), env, {});
  assert.equal(get.status, 401);
  assert.equal((await get.json()).error, 'unauthorized');
});

test('F1 replay routes fail closed when ADMIN_TOKEN is not configured', async () => {
  const response = await worker.fetch(new Request('https://example.test/v1/replay/replay_probe'), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});

test('F1 replay POST validates body before querying D1', async () => {
  let calls = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { calls += 1; throw new Error('unexpected DB access'); } }
  };
  const response = await worker.fetch(new Request('https://example.test/v1/replay/decision', {
    method: 'POST',
    headers: {
      authorization: 'Bearer synthetic-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ from:'not-a-date', to:'2099-01-31T23:59:59Z' })
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /from must be a valid timestamp/);
  assert.equal(calls, 0);
});
