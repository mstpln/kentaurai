import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppSessionCookie } from '../src/app-auth.js';
import worker from '../src/worker-v077.js';
import { createTestEnv } from './helpers/d1.js';

test('production Worker canonicalizes bare /app to /app/', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app?from=test'), env, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.test/app/?from=test');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('production /app/ contains the canonical entity-detail stack exactly once', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const setCookie = await createAppSessionCookie(env);
  const cookie = setCookie.split(';', 1)[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const html = await response.text();

  assert.match(html, /id="kentaurai-complete-stats-script"/);
  assert.match(html, /id="kentaurai-trainer-statistics-build-d-script"/);
  assert.match(html, /id="kentaurai-entity-detail-statistics-v2-script"/);
  assert.match(html, /id="kentaurai-external-evidence-ui-style"/);
  assert.match(html, /id="kentaurai-entity-detail-ui-runtime"/);
  assert.match(html, /id="kentaurai-performance-v1-script"/);
  assert.equal((html.match(/kentaurai-entity-detail-ui-runtime/g) || []).length, 1);
  assert.match(html, /__kentauraiEntityDetailStatistics=\{mount/);
  assert.match(html, /const legacyRenderDetail = renderDetail/);
  assert.match(html, /if \(!\['stats','external_stats','interviews'\]\.includes\(requestedTab\)\) return legacyRenderDetail\(\)/);
  assert.doesNotMatch(html, /#horseStatsBuildB,#trainerStatsBuildD,#driverStatsBuildC\{display:none!important\}/);
  assert.match(html, /\['external_stats','Extern statistik'\]/);
  assert.match(html, /\['interviews','Intervjuer'\]/);
  const performanceIndex = html.indexOf('id="kentaurai-performance-v1-script"');
  const scorecardIndex = html.indexOf('id="kentaurai-entity-detail-statistics-v2-script"');
  const runtimeIndex = html.indexOf('id="kentaurai-entity-detail-ui-runtime"');
  assert.ok(performanceIndex >= 0 && scorecardIndex > performanceIndex && runtimeIndex > scorecardIndex);
});
