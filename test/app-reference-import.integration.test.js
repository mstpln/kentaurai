import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

function cookieFor(env) {
  return createAppSessionCookie(env).then((cookie) => cookie.split(';')[0]);
}

test('reference-round import page is private', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/import/reference-round'), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/login');

  const cookie = await cookieFor(env);
  response = await worker.fetch(new Request('https://example.test/app/import/reference-round', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /kentaurai-reference-v1/);
  assert.match(html, /\/app\/api\/import\/reference-round/);
});

test('reference-round app import API requires a valid private app session', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app/api/import/reference-round', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }), env);
  assert.equal(response.status, 401);
});

test('reference-round app import API rejects oversized payloads before import', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await cookieFor(env);
  const response = await worker.fetch(new Request('https://example.test/app/api/import/reference-round', {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'content-length': String(1024 * 1024 + 1)
    },
    body: '{}'
  }), env);
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.error, 'request_failed');
  assert.match(data.message, /exceeds 1 MB limit/);
});
