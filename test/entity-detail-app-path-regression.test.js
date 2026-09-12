import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppSessionCookie } from '../src/app-auth.js';
import worker from '../src/worker-v065.js';

const source = fs.readFileSync(new URL('../src/worker-v065.js', import.meta.url), 'utf8');

test('bare /app is canonicalized to /app/ so the complete enhancement stack always runs', async () => {
  assert.match(source, /url\.pathname !== '\/app'/);
  assert.match(source, /target\.pathname = '\/app\/'/);
  assert.match(source, /path !== '\/app\/'/);

  const response = await worker.fetch(new Request('https://example.test/app?from=test'), {}, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.test/app/?from=test');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('authenticated /app/ response contains both the complete existing shell and the shared entity-detail redesign', async () => {
  const env = { APP_PASSWORD: 'test-password' };
  const setCookie = await createAppSessionCookie(env);
  const cookie = setCookie.split(';', 1)[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const html = await response.text();
  assert.match(html, /id="kentaurai-complete-stats-script"/);
  assert.match(html, /id="kentaurai-trainer-statistics-build-d-script"/);
  assert.match(html, /id="kentaurai-entity-detail-statistics-v2-script"/);
  assert.match(html, /app\.querySelector\(':scope > \.data-groups'\)\?\.remove\(\)/);
});
