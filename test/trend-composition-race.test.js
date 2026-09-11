import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

test('final Worker suppresses the legacy async Trend boot and runs the real Trend finalizer before the v064 overlay', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.doesNotMatch(html, /renderStart\(\)\.catch\(err=>\{app\.innerHTML='<div class="notice">Kunde inte läsa data:/);
  const trend = html.indexOf('id="kentaurai-trend-build-a-script"');
  const finalizer = html.indexOf('id="kentaurai-statistics-finalize-script"');
  const overlay = html.indexOf('id="kentaurai-v064-overlay-script"');
  assert.ok(trend >= 0);
  assert.ok(finalizer > trend);
  assert.ok(overlay > finalizer);
  assert.match(html.slice(finalizer, overlay), /state\.page==='start'.*renderStart\(\)/s);
});
