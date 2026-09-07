import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

test('private app APIs fail closed without APP_PASSWORD or a valid session', async () => {
  const { env } = createTestEnv();
  let response = await worker.fetch(new Request('https://example.test/app/api/summary'), env);
  assert.equal(response.status, 503);

  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  response = await worker.fetch(new Request('https://example.test/app/api/summary'), env);
  assert.equal(response.status, 401);
});

test('valid app session can read summary without exposing ADMIN_TOKEN', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/api/summary', {
    headers: { cookie }
  }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.counts.horses, 0);
  assert.equal(data.trends.available, false);
});
