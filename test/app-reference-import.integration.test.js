import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { buildReferenceRound } from './helpers/reference-fixture.js';

function cookieFor(env) {
  return createAppSessionCookie(env).then((cookie) => cookie.split(';')[0]);
}

function uploadRequest(payload, cookie, { name = 'reference.json', field = 'reference_round' } = {}) {
  const form = new FormData();
  form.append(field, new File([JSON.stringify(payload)], name, { type: 'application/json' }));
  return new Request('https://example.test/app/import/reference-round', {
    method: 'POST',
    headers: { cookie },
    body: form
  });
}

test('reference-round import page is private and renders a normal multipart form', async () => {
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
  assert.match(html, /method="post"/);
  assert.match(html, /action="\/app\/import\/reference-round"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="reference_round"/);
  assert.doesNotMatch(html, /<script>/);
});

test('reference-round form POST requires a valid private app session', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const form = new FormData();
  form.append('reference_round', new File(['{}'], 'reference.json', { type: 'application/json' }));
  const response = await worker.fetch(new Request('https://example.test/app/import/reference-round', {
    method: 'POST',
    body: form
  }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/login');
});

test('reference-round form POST imports a valid synthetic reference export', async () => {
  const { env, db, objects } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await cookieFor(env);

  const response = await worker.fetch(uploadRequest(buildReferenceRound(), cookie), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Import klar/);
  assert.match(html, /ny import/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reference_round_exports').get().n, 1);
  assert.equal(objects.size, 1);
});

test('reference-round form POST reports an idempotent reimport', async () => {
  const { env, db, objects } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await cookieFor(env);
  const payload = buildReferenceRound();

  let response = await worker.fetch(uploadRequest(payload, cookie), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(uploadRequest(payload, cookie), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /redan importerad tidigare/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reference_round_exports').get().n, 1);
  assert.equal(objects.size, 1);
});

test('reference-round form POST rejects missing, wrong-field and invalid JSON uploads', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await cookieFor(env);

  let response = await worker.fetch(new Request('https://example.test/app/import/reference-round', {
    method: 'POST',
    headers: { cookie },
    body: new FormData()
  }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /select exactly one reference round JSON file/);

  response = await worker.fetch(uploadRequest(buildReferenceRound(), cookie, { field: 'wrong_field' }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /select exactly one reference round JSON file/);

  const form = new FormData();
  form.append('reference_round', new File(['not json'], 'reference.json', { type: 'application/json' }));
  response = await worker.fetch(new Request('https://example.test/app/import/reference-round', {
    method: 'POST',
    headers: { cookie },
    body: form
  }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /must contain valid JSON/);
});

test('reference-round form POST rejects oversized files before import', async () => {
  const { env, db, objects } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = await cookieFor(env);
  const form = new FormData();
  form.append('reference_round', new File(['x'.repeat(1024 * 1024 + 1)], 'large.json', { type: 'application/json' }));
  const response = await worker.fetch(new Request('https://example.test/app/import/reference-round', {
    method: 'POST',
    headers: { cookie },
    body: form
  }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /exceeds 1 MB limit/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reference_round_exports').get().n, 0);
  assert.equal(objects.size, 0);
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
