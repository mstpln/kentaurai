import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-v078.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { setAutomationControl } from '../src/automation-control.js';
import { createTestEnv } from './helpers/d1.js';

async function cookieFor(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('Settings automation endpoints are private and persist the master switch', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/automation'), env);
  assert.equal(response.status, 401);

  const cookie = await cookieFor(env);
  response = await worker.fetch(new Request('https://example.test/app/api/settings/automation', { headers:{ cookie } }), env);
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.enabled, true);
  assert.equal(data.cron, '15 5 * * *');
  assert.ok(data.nextRunAt);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/automation', {
    method:'POST',
    headers:{ cookie, 'content-type':'application/json' },
    body:JSON.stringify({ enabled:false })
  }), env);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.enabled, false);
  assert.equal(data.nextRunAt, null);
  assert.equal(db.prepare("SELECT enabled FROM automation_controls WHERE id='automatic_workflows'").get().enabled, 0);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/automation', {
    method:'POST',
    headers:{ cookie, 'content-type':'application/json' },
    body:JSON.stringify({ enabled:true })
  }), env);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.enabled, true);
  assert.ok(data.nextRunAt);
});

test('Cloudflare usage endpoint is private and never reports missing credentials as zero usage', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/cloudflare-usage'), env);
  assert.equal(response.status, 401);

  const cookie = await cookieFor(env);
  response = await worker.fetch(new Request('https://example.test/app/api/settings/cloudflare-usage', { headers:{ cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.reason, 'missing_usage_token');
  assert.equal(Object.hasOwn(data, 'd1'), false);
});

test('paused automation gate exits the production entrypoint before scheduled work starts', async () => {
  const { env, db, d1Metrics } = createTestEnv();
  await setAutomationControl(env, false, {
    now:new Date('2099-09-27T18:00:00Z'),
    via:'test'
  });
  const beforeRuns = db.prepare("SELECT COUNT(*) AS n FROM import_runs WHERE source_type='scheduled_orchestrator'").get().n;
  const beforeStatements = d1Metrics.statements;

  const result = await worker.scheduled({
    cron:'15 5 * * *',
    scheduledTime:Date.parse('2099-09-28T05:15:00Z')
  }, env, { waitUntil() {} });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'automation_paused');
  assert.equal(result.automation.enabled, false);
  const afterRuns = db.prepare("SELECT COUNT(*) AS n FROM import_runs WHERE source_type='scheduled_orchestrator'").get().n;
  assert.equal(afterRuns, beforeRuns);
  assert.equal(d1Metrics.statements - beforeStatements, 1);
});
