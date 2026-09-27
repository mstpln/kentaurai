import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import worker from '../src/worker-v079.js';
import {
  billingCycleFromAnchor,
  getAutomationControl,
  getCloudflareUsage,
  setAutomationControl
} from '../src/settings-drift.js';
import { createTestEnv } from './helpers/d1.js';

async function appCookie(env) {
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const login = await worker.fetch(new Request('https://example.test/app/login', {
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({ password:env.APP_PASSWORD })
  }), env);
  assert.equal(login.status, 303);
  return login.headers.get('set-cookie').split(';')[0];
}

test('runtime control is enabled by default and persists private-app changes', async () => {
  const { env } = createTestEnv();
  assert.deepEqual((await getAutomationControl(env)).enabled, true);
  const paused = await setAutomationControl(env, false);
  assert.equal(paused.enabled, false);
  assert.equal((await getAutomationControl(env)).enabled, false);
  const resumed = await setAutomationControl(env, true);
  assert.equal(resumed.enabled, true);
  assert.equal((await getAutomationControl(env)).enabled, true);
});

test('outer worker kill switch blocks the full scheduled chain before automatic work starts', async () => {
  const { env, d1Metrics } = createTestEnv();
  await setAutomationControl(env, false);
  const before = { ...d1Metrics };
  const result = await worker.scheduled({ cron:'15 5 * * *', scheduledTime:Date.parse('2099-01-15T05:15:00Z') }, env, {});
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'automatic_workflows_paused');
  assert.equal(d1Metrics.runs, before.runs);
  assert.equal(d1Metrics.alls, before.alls);
  assert.equal(d1Metrics.firsts, before.firsts + 1);
});

test('settings automation route is private and controls the real scheduled switch', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const denied = await worker.fetch(new Request('https://example.test/app/api/settings/automation', {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ enabled:false })
  }), env);
  assert.equal(denied.status, 401);

  const cookie = await appCookie(env);
  const response = await worker.fetch(new Request('https://example.test/app/api/settings/automation', {
    method:'POST',
    headers:{ cookie, 'content-type':'application/json', accept:'application/json' },
    body:JSON.stringify({ enabled:false })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).automation.enabled, false);
  assert.equal((await getAutomationControl(env)).enabled, false);
});

test('current billing cycle is derived from the Cloudflare subscription anchor', () => {
  const cycle = billingCycleFromAnchor('2026-09-12T00:00:00Z', '2026-09-27T18:00:00Z');
  assert.equal(cycle.start, '2026-09-12T00:00:00.000Z');
  assert.equal(cycle.end, '2026-10-12T00:00:00.000Z');
});

test('Cloudflare usage uses verified API values and never starts from zero estimates', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url:String(url), options });
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{
          subscriptions:[{
            id:'workers-paid',
            billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z',
            start_timestamp:'2026-09-12T00:00:00Z'
          }]
        }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.start, '2026-09-12');
      assert.equal(body.variables.end, '2026-09-27');
      return new Response(JSON.stringify({
        data:{
          viewer:{
            accounts:[{
              d1AnalyticsAdaptiveGroups:[
                { sum:{ rowsRead:20_000_000_000, rowsWritten:800_000 } },
                { sum:{ rowsRead:7_000_000_000, rowsWritten:200_000 } }
              ],
              d1StorageAdaptiveGroups:[
                { dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:4_700_000_000 } }
              ]
            }]
          }
        }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected Cloudflare URL '+url);
  };

  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.configured, true);
  assert.equal(usage.billingPeriod.start, '2026-09-12T00:00:00.000Z');
  const reads = usage.metrics.find((item) => item.id === 'd1_rows_read');
  const writes = usage.metrics.find((item) => item.id === 'd1_rows_written');
  const storage = usage.metrics.find((item) => item.id === 'd1_storage');
  assert.equal(reads.used, 27_000_000_000);
  assert.equal(reads.overLimit, true);
  assert.equal(writes.used, 1_000_000);
  assert.equal(writes.overLimit, false);
  assert.equal(storage.used, 4_700_000_000);
  assert.equal(storage.overLimit, false);
  assert.equal(calls.length, 2);
});



test('Cloudflare usage does not turn missing analytics datasets into zero usage', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      return new Response(JSON.stringify({ data:{ viewer:{ accounts:[{}] } } }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.available, false);
  assert.deepEqual(usage.metrics, []);
});

test('Cloudflare usage refuses malformed numeric analytics instead of fabricating zero', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[{ sum:{ rowsRead:null, rowsWritten:12 } }],
          d1StorageAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:100 } }]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.available, false);
  assert.deepEqual(usage.metrics, []);
});

test('Cloudflare storage chooses the latest dated sample even if analytics order changes', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[{ sum:{ rowsRead:10, rowsWritten:2 } }],
          d1StorageAdaptiveGroups:[
            { dimensions:{ date:'2026-09-20', databaseId:'db-a' }, max:{ databaseSizeBytes:200 } },
            { dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:500 } },
            { dimensions:{ date:'2026-09-25', databaseId:'db-b' }, max:{ databaseSizeBytes:300 } }
          ]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.available, undefined);
  assert.equal(usage.metrics.find((item) => item.id === 'd1_storage').used, 800);
});

test('Cloudflare usage refuses to guess when active subscription billing anchors disagree', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[
          { id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' },
          { id:'b', billing_cycle_anchor_timestamp:'2026-09-20T00:00:00Z', start_timestamp:'2026-09-20T00:00:00Z' }
        ] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('GraphQL must not be called for ambiguous billing anchors');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.configured, true);
  assert.equal(usage.available, false);
  assert.equal(usage.reason, 'cloudflare_usage_unavailable');
  assert.deepEqual(usage.metrics, []);
});

test('Cloudflare usage fails visibly instead of fabricating values when read-only access is absent', async () => {
  const { env } = createTestEnv();
  const usage = await getCloudflareUsage(env);
  assert.equal(usage.configured, false);
  assert.deepEqual(usage.metrics, []);
});

test('production app contains the Drift/Data settings overlay and no concept badge', async () => {
  const { env } = createTestEnv();
  const cookie = await appCookie(env);
  const response = await worker.fetch(new Request('https://example.test/app/', { headers:{ cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /kentaurai-settings-drift-ui/);
  assert.match(html, /data-settings-primary="drift"/);
  assert.match(html, /data-settings-primary="data"/);
  assert.match(html, /Cloudflare-användning/);
  assert.match(html, /automationToggleV079/);
  assert.match(html, /dataCoverageAuditCard/);
  assert.doesNotMatch(html, /Konceptvy/);
});

test('scheduled orchestrator rechecks persisted automation control before every morning part', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /async function automationAllowed\(name\)/);
  assert.match(source, /async function critical\(name, action\) \{\s*if \(!\(await automationAllowed\(name\)\)\) return;/);
  assert.match(source, /async function nonCritical\(name, action\) \{\s*if \(!\(await automationAllowed\(name\)\)\) return;/);
  assert.match(source, /automationStopReason = 'automatic_workflows_paused'/);
  assert.match(source, /automationStopReason = 'automation_control_unavailable'/);
});

test('billing period UI renders the exclusive cycle end as the previous inclusive date', () => {
  const source = readFileSync(new URL('../src/settings-drift-ui.js', import.meta.url), 'utf8');
  assert.match(source, /setUTCDate\(d\.getUTCDate\(\)-1\)/);
  assert.match(source, /fmtBillingEnd\(cf\.billingPeriod\.end\)/);
});

test('runtime controls stay outside structured data exports', () => {
  const source = readFileSync(new URL('../src/settings-data.js', import.meta.url), 'utf8');
  assert.match(source, /EXCLUDED_TABLES = new Set\(\['d1_migrations', 'runtime_controls'\]\)/);
});

test('all scheduled wrapper side jobs recheck the persisted automation switch', () => {
  const snapshotWrapper = readFileSync(new URL('../src/worker-v066.js', import.meta.url), 'utf8');
  const startPointWrapper = readFileSync(new URL('../src/worker-v064.js', import.meta.url), 'utf8');
  const pwaWrapper = readFileSync(new URL('../src/worker-pwa.js', import.meta.url), 'utf8');

  assert.match(snapshotWrapper, /getAutomationControl\(env\)/);
  assert.match(snapshotWrapper, /if \(!control\.enabled\) return result;/);
  assert.match(startPointWrapper, /getAutomationControl\(env\)/);
  assert.match(startPointWrapper, /if \(!control\.enabled\) return result;/);
  assert.match(pwaWrapper, /getAutomationControl\(env\)/);
  assert.match(pwaWrapper, /if \(control\.enabled\) await runNextPostRaceReview\(env\)/);
});
