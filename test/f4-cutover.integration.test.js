import test from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  F4_CUTOVER_VERSION,
  F4_DEFAULT_MODE,
  F4_ROLLBACK_MODE
} from '../src/worker-v076.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

async function appCookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

function privateEnv() {
  const setup = createTestEnv();
  setup.env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  setup.env.ADMIN_TOKEN = 'synthetic-admin-token-with-high-entropy';
  return setup;
}

test('F4 health exposes v3 as the default cutover mode and rollback state explicitly', async () => {
  const { env } = privateEnv();
  let response = await worker.fetch(new Request('https://example.test/health'), env, {});
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.analysisWorkflow, F4_DEFAULT_MODE);
  assert.equal(body.analysisCutoverVersion, F4_CUTOVER_VERSION);
  assert.equal(body.legacyAnalysisCreationEnabled, false);

  response = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    ANALYSIS_WORKFLOW_MODE: F4_ROLLBACK_MODE
  }, {});
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.analysisWorkflow, undefined);

  response = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    ANALYSIS_WORKFLOW_MODE: 'invalid'
  }, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});

test('F4 disables every known legacy analysis creation path after authentication', async () => {
  const { env } = privateEnv();
  const cookie = await appCookie(env);

  let response = await worker.fetch(new Request(
    'https://example.test/app/api/settings/import-analysis',
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }
  ), env, {});
  assert.equal(response.status, 410);
  let body = await response.json();
  assert.equal(body.error, 'legacy_analysis_creation_disabled');
  assert.equal(response.headers.get('x-kentaurai-legacy-read-only'), 'true');

  response = await worker.fetch(new Request(
    'https://example.test/v1/analysis/rounds/synthetic/submissions',
    { method: 'POST', headers: { authorization: 'Bearer synthetic-admin-token-with-high-entropy', 'content-type': 'application/json' }, body: '{}' }
  ), env, {});
  assert.equal(response.status, 410);
  body = await response.json();
  assert.equal(body.analysis_workflow, 'v3');
});

test('F4 legacy creation and generation routes still fail closed before revealing deprecation to unauthenticated callers', async () => {
  const { env } = privateEnv();

  for (const request of [
    new Request('https://example.test/app/api/settings/import-analysis', { method: 'POST' }),
    new Request('https://example.test/app/api/settings/analysis-prompt?provider=openai'),
    new Request('https://example.test/app/api/settings/analysis-method-prompt?step=1'),
    new Request('https://example.test/app/api/settings/export?provider=openai&stage=pre_market'),
    new Request('https://example.test/v1/analysis/rounds/synthetic/submissions', { method: 'POST' })
  ]) {
    const response = await worker.fetch(request, env, {});
    assert.equal(response.status, 401, request.url);
    assert.match(JSON.stringify(await response.json()), /unauthorized/);
  }
});

test('F4 keeps authenticated legacy admin reads available with explicit read-only deprecation headers', async () => {
  const { env } = privateEnv();
  const response = await worker.fetch(new Request(
    'https://example.test/v1/analysis/rounds?limit=1',
    { headers: { authorization: 'Bearer synthetic-admin-token-with-high-entropy' } }
  ), env, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('deprecation'), 'true');
  assert.equal(response.headers.get('x-kentaurai-legacy-read-only'), 'true');
  const body = await response.json();
  assert.ok(Array.isArray(body.rounds));
});

test('F4 default private app renders the v3 workflow while rollback preserves the legacy app page', async () => {
  const { env } = privateEnv();
  const cookie = await appCookie(env);

  let response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  let html = await response.text();
  assert.match(html, /kentaurai-f3-private-ui-script/);
  assert.match(html, /Hämta Steg 2-underlag/);
  assert.match(html, /förlitar sig inte på konversationsminne/);

  response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), {
    ...env,
    ANALYSIS_WORKFLOW_MODE: F4_ROLLBACK_MODE
  }, {});
  assert.equal(response.status, 200);
  html = await response.text();
  assert.doesNotMatch(html, /kentaurai-f3-private-ui-script/);
  assert.match(html, /KentaurAI/);
});

test('F4 self-contained Step 2 route is private and legacy v2 generation endpoints are gone in default mode', async () => {
  const { env } = privateEnv();

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/f4-step2-bundle?round_id=private-probe'), env, {});
  assert.equal(response.status, 401);

  const cookie = await appCookie(env);
  for (const path of [
    '/app/api/settings/analysis-rounds',
    '/app/api/settings/analysis-prompt?provider=openai',
    '/app/api/settings/analysis-method-prompt?step=1',
    '/app/api/settings/export?provider=openai&stage=pre_market'
  ]) {
    response = await worker.fetch(new Request('https://example.test' + path, { headers: { cookie } }), env, {});
    assert.equal(response.status, 410, path);
    assert.equal((await response.json()).error, 'legacy_analysis_creation_disabled');
  }
});
