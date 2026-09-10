import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-aligned-final.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

test('final Worker structurally aligns the mobile settings gear with the brand row', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /grid-template-areas:"brand settings" "search search"!important/);
  assert.match(html, /position:static!important/);
  assert.match(html, /top:auto!important/);
  assert.match(html, /right:auto!important/);
  assert.match(html, /grid-area:settings!important/);
  assert.match(html, /width:32px!important/);
  assert.match(html, /height:32px!important/);
});
