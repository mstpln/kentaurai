import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v074.js';

test('F1 replay routes reject missing admin auth before body or DB work', async () => {
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { throw new Error('DB must not be reached before auth'); } }
  };
  for (const [url, method] of [
    ['https://example.test/v1/replay/start', 'POST'],
    ['https://example.test/v1/replay/step', 'POST'],
    ['https://example.test/v1/replay/status?run_id=replay_probe', 'GET']
  ]) {
    const response = await worker.fetch(new Request(url, { method }), env, {});
    assert.equal(response.status, 401, `${method} ${url}`);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('F1 replay routes fail closed when ADMIN_TOKEN is not configured', async () => {
  for (const [url, method] of [
    ['https://example.test/v1/replay/start', 'POST'],
    ['https://example.test/v1/replay/step', 'POST'],
    ['https://example.test/v1/replay/status?run_id=replay_probe', 'GET']
  ]) {
    const response = await worker.fetch(new Request(url, { method }), {}, {});
    assert.equal(response.status, 503, `${method} ${url}`);
    assert.equal((await response.json()).error, 'service_unavailable');
  }
});

test('F1 start route validates JSON before database work', async () => {
  let dbCalls = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { dbCalls += 1; throw new Error('unexpected DB access'); } }
  };
  const response = await worker.fetch(new Request('https://example.test/v1/replay/start', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-secret', 'content-type': 'application/json' },
    body: '{bad'
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /valid JSON/);
  assert.equal(dbCalls, 0);
});

test('F1 status route validates run_id before database work', async () => {
  let dbCalls = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { dbCalls += 1; throw new Error('unexpected DB access'); } }
  };
  const response = await worker.fetch(new Request('https://example.test/v1/replay/status', {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /run_id is required/);
  assert.equal(dbCalls, 0);
});
