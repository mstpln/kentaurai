import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v070.js';

const ADMIN_URL = 'https://example.test/v1/analysis-market-pack/round-d4?lock_id=lock-d4&lock_hash=sha256%3Alock-d4';
const APP_URL = 'https://example.test/app/api/settings/analysis-market-pack?round_id=round-d4&lock_id=lock-d4&lock_hash=sha256%3Alock-d4';

test('D4 market-pack admin route rejects missing and invalid auth before DB work', async () => {
  const missing = await worker.fetch(new Request(ADMIN_URL), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthorized');

  const invalid = await worker.fetch(new Request(ADMIN_URL, { headers: { authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error, 'unauthorized');
});

test('D4 market-pack routes fail closed when private auth is not configured', async () => {
  const admin = await worker.fetch(new Request(ADMIN_URL), {}, {});
  assert.equal(admin.status, 503);
  assert.equal((await admin.json()).error, 'service_unavailable');

  const app = await worker.fetch(new Request(APP_URL), {}, {});
  assert.equal(app.status, 503);
  assert.equal((await app.json()).error, 'service_unavailable');
});

test('D4 market-pack route requires explicit lock id and lock hash', async () => {
  const url = 'https://example.test/v1/analysis-market-pack/round-d4';
  const response = await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), { ADMIN_TOKEN: 'synthetic-secret', DB: {} }, {});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'request_failed');
  assert.match(body.message, /lock_id is required/);
});
