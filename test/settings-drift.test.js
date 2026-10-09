import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import worker from '../src/worker-v079.js';
import {
  billingCycleFromAnchor,
  getAutomationControl,
  getCloudflareUsage,
  getDriftOverview,
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
      assert.equal(body.variables.databaseId, 'd8189e0e-6127-4ef2-88cc-534cb2217340');
      assert.match(body.query, /databaseId: \$databaseId/);
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
    if (String(url).includes('/billable-usage?')) {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('from'), '2026-09-12');
      assert.equal(parsed.searchParams.get('to'), '2026-09-27');
      return new Response(JSON.stringify({
        success:true,
        result:[
          { x_BillableMetricId:'d1_rows_read', BilledCost:1.25, BillingCurrency:'USD', ConsumedQuantity:20_000_000_000, ConsumedUnit:'Count' },
          { x_BillableMetricId:'d1_rows_read', ContractedCost:0.50, BillingCurrency:'USD', ConsumedQuantity:7_000_000_000, ConsumedUnit:'Count' },
          { x_BillableMetricId:'d1_rows_written', BilledCost:0, BillingCurrency:'USD', ConsumedQuantity:1_000_000, ConsumedUnit:'Count' },
          { ServiceFamilyName:'D1', ServiceName:'D1 Storage', BilledCost:0.75, BillingCurrency:'USD', ConsumedQuantity:4.7, ConsumedUnit:'GB-months' },
          { ServiceFamilyName:'Workers', ServiceName:'Workers Standard Requests', BilledCost:9.99, BillingCurrency:'USD' }
        ]
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
  assert.equal(reads.billingCost, 1.75);
  assert.equal(reads.billingCurrency, 'USD');
  assert.equal(reads.billingCostSource, 'cloudflare_billing');
  assert.equal(writes.used, 1_000_000);
  assert.equal(writes.overLimit, false);
  assert.equal(writes.billingCost, 0);
  assert.equal(writes.billingCurrency, 'USD');
  assert.equal(writes.billingCostSource, 'cloudflare_billing');
  assert.equal(storage.used, 4_700_000_000);
  assert.equal(storage.overLimit, false);
  assert.equal(storage.billingCost, 0.75);
  assert.equal(storage.billingCurrency, 'USD');
  assert.equal(usage.additional.billingCostAvailable, true);
  assert.equal(calls.length, 3);
});



test('Cloudflare usage adds R2 storage and operation progress with matching billed cost', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.r2BucketName, 'kentaurai-raw');
      assert.equal(body.variables.r2Start, '2026-09-12T00:00:00.000Z');
      assert.equal(body.variables.r2End, '2026-09-27T18:00:00.000Z');
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[{ sum:{ rowsRead:10, rowsWritten:2 } }],
          d1StorageAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:100 } }],
          r2StorageAdaptiveGroups:[
            { dimensions:{ datetime:'2026-09-26T18:00:00Z' }, max:{ payloadSize:3_000_000_000, metadataSize:100_000_000 } },
            { dimensions:{ datetime:'2026-09-27T17:55:00Z' }, max:{ payloadSize:4_500_000_000, metadataSize:200_000_000 } }
          ]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).includes('/billable-usage?')) {
      return new Response(JSON.stringify({
        success:true,
        result:[
          { ServiceFamilyName:'R2', ServiceName:'R2 Data Storage', BilledCost:0.12, BillingCurrency:'USD', ConsumedQuantity:2.02, ConsumedUnit:'GB-months' },
          { ServiceFamilyName:'R2', ServiceName:'R2 Storage Class A Operations', BilledCost:0.03, BillingCurrency:'USD', ConsumedQuantity:1500, ConsumedUnit:'Count' },
          { ServiceFamilyName:'R2', ServiceName:'R2 Storage Class B Operations', BilledCost:0.01, BillingCurrency:'USD', ConsumedQuantity:5400, ConsumedUnit:'Count' }
        ]
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.additional.r2Available, true);
  const storage = usage.metrics.find((item) => item.id === 'r2_storage');
  const classA = usage.metrics.find((item) => item.id === 'r2_class_a');
  const classB = usage.metrics.find((item) => item.id === 'r2_class_b');
  assert.equal(storage.used, 4_700_000_000);
  assert.equal(storage.limit, 10_000_000_000);
  assert.equal(storage.unit, 'bytes');
  assert.equal(storage.percent, 47);
  assert.equal(storage.observedAt, '2026-09-27T17:55:00Z');
  assert.match(storage.rule, /aktuell lagrad mängd/i);
  assert.equal(storage.billingCost, 0.12);
  assert.equal(classA.used, 1500);
  assert.equal(classA.limit, 1_000_000);
  assert.equal(classA.billingCost, 0.03);
  assert.equal(classB.used, 5400);
  assert.equal(classB.limit, 10_000_000);
  assert.equal(classB.billingCost, 0.01);
});

test('Cloudflare usage keeps verified progress visible when per-metric billing cost cannot be read', async () => {
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
          d1StorageAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:100 } }]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).includes('/billable-usage?')) {
      return new Response(JSON.stringify({ success:false, errors:[{ message:'billing temporarily unavailable' }] }), { status:503, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.configured, true);
  assert.equal(usage.additional.billingCostAvailable, false);
  const reads = usage.metrics.find((item) => item.id === 'd1_rows_read');
  const writes = usage.metrics.find((item) => item.id === 'd1_rows_written');
  assert.equal(reads.used, 10);
  assert.equal(reads.billingCost, 0);
  assert.equal(reads.billingCurrency, 'USD');
  assert.equal(reads.billingCostSource, 'published_pricing');
  assert.equal(writes.billingCost, 0);
  assert.equal(writes.billingCostSource, 'published_pricing');
});

test('D1 rows read shows verified published-pricing overage when Cloudflare omits cost fields', async () => {
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
          d1AnalyticsAdaptiveGroups:[{ sum:{ rowsRead:27_000_000_000, rowsWritten:55_000_000 } }],
          d1StorageAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:100 } }]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).includes('/billable-usage?')) {
      return new Response(JSON.stringify({
        success:true,
        result:[
          { x_BillableMetricId:'d1_rows_read', BillingCurrency:'USD', ConsumedQuantity:27_000_000_000, ConsumedUnit:'Count' },
          { x_BillableMetricId:'d1_rows_written', BillingCurrency:'USD', ConsumedQuantity:55_000_000, ConsumedUnit:'Count' }
        ]
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  const reads = usage.metrics.find((item) => item.id === 'd1_rows_read');
  const writes = usage.metrics.find((item) => item.id === 'd1_rows_written');
  assert.equal(reads.billingCost, 2);
  assert.equal(reads.billingCurrency, 'USD');
  assert.equal(reads.billingCostSource, 'published_pricing');
  assert.equal(writes.billingCost, 5);
  assert.equal(writes.billingCurrency, 'USD');
  assert.equal(writes.billingCostSource, 'published_pricing');
});

test('Drift estimates per-workflow D1 usage from daily Cloudflare totals and monthly threshold position', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  await env.DB.prepare(`
    INSERT INTO import_runs
      (id,source_type,started_at,finished_at,status,inserted_count,updated_count,skipped_count,error_count)
    VALUES
      ('run-a','official_live','2026-09-27T05:15:00Z','2026-09-27T05:20:00Z','success',300,0,0,0),
      ('run-b','xlabs_daily','2026-09-27T05:20:00Z','2026-09-27T05:24:00Z','success',100,0,0,0)
  `).run();

  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.parse(options.body);
      assert.match(body.query, /dimensions \{ date databaseId \}/);
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[
            { dimensions:{ date:'2026-09-27', databaseId:'db-a' }, sum:{ rowsRead:30_000_000_000, rowsWritten:60_000_000 } }
          ],
          d1StorageAdaptiveGroups:[
            { dimensions:{ date:'2026-09-27', databaseId:'db-a' }, max:{ databaseSizeBytes:1_000_000_000 } }
          ]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).includes('/billable-usage?')) {
      return new Response(JSON.stringify({ success:true, result:[] }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };

  const drift = await getDriftOverview(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(Object.prototype.hasOwnProperty.call(drift.cloudflare, '_dailyUsage'), false);
  assert.match(drift.usageEstimateNote, /uppskattning/i);

  const a = drift.recentRunEstimates['run-a'];
  const b = drift.recentRunEstimates['run-b'];
  assert.equal(a.approximate, true);
  assert.equal(a.rowsRead, 22_500_000_000);
  assert.equal(a.rowsWritten, 45_000_000);
  assert.equal(a.sameDayRunCount, 2);
  assert.equal(a.allocationShare, 0.75);
  assert.equal(a.estimatedReadCostUsd, 3.75);
  assert.equal(a.estimatedWriteCostUsd, 7.5);
  assert.equal(a.estimatedCostUsd, 11.25);
  assert.equal(b.rowsRead, 7_500_000_000);
  assert.equal(b.rowsWritten, 15_000_000);
  assert.equal(b.estimatedCostUsd, 3.75);
});

test('Cloudflare Query Insights is database-scoped and exposes read-heavy SQL diagnostics', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.databaseId, 'd8189e0e-6127-4ef2-88cc-534cb2217340');
      assert.match(body.query, /d1QueriesAdaptiveGroups/);
      assert.match(body.query, /sum_rowsRead_DESC/);
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:body.variables.databaseId }, sum:{ rowsRead:1000, rowsWritten:5 } }],
          d1StorageAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:body.variables.databaseId }, max:{ databaseSizeBytes:1000 } }],
          d1QueriesAdaptiveGroups:[{
            count:4,
            avg:{ rowsRead:250, rowsReturned:1, rowsWritten:0, queryDurationMs:8 },
            sum:{ rowsRead:1000, rowsReturned:4, rowsWritten:0, queryDurationMs:32 },
            dimensions:{ query:'SELECT  id   FROM horses WHERE id = ?', databaseId:body.variables.databaseId }
          }]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).includes('/billable-usage?')) {
      return new Response(JSON.stringify({ success:true, result:[] }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };

  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.queryInsights.length, 1);
  assert.equal(usage.queryInsights[0].query, 'SELECT id FROM horses WHERE id = ?');
  assert.equal(usage.queryInsights[0].count, 4);
  assert.equal(usage.queryInsights[0].totalRowsRead, 1000);
  assert.equal(usage.queryInsights[0].avgRowsRead, 250);
  assert.equal(usage.queryInsights[0].queryEfficiency, 0.004);
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

test('Cloudflare storage chooses the latest dated sample for the filtered KentaurAI database', async () => {
  const { env } = createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID = 'account-synthetic';
  env.CLOUDFLARE_USAGE_API_TOKEN = 'usage-token-synthetic';
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return new Response(JSON.stringify({
        success:true,
        result:{ subscriptions:[{ id:'a', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z', start_timestamp:'2026-09-12T00:00:00Z' }] }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.databaseId, 'd8189e0e-6127-4ef2-88cc-534cb2217340');
      return new Response(JSON.stringify({
        data:{ viewer:{ accounts:[{
          d1AnalyticsAdaptiveGroups:[{ dimensions:{ date:'2026-09-27', databaseId:body.variables.databaseId }, sum:{ rowsRead:10, rowsWritten:2 } }],
          d1StorageAdaptiveGroups:[
            { dimensions:{ date:'2026-09-20', databaseId:body.variables.databaseId }, max:{ databaseSizeBytes:200 } },
            { dimensions:{ date:'2026-09-27', databaseId:body.variables.databaseId }, max:{ databaseSizeBytes:500 } }
          ]
        }] } }
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error('unexpected URL');
  };
  const usage = await getCloudflareUsage(env, { fetchImpl, now:'2026-09-27T18:00:00Z' });
  assert.equal(usage.available, undefined);
  assert.equal(usage.metrics.find((item) => item.id === 'd1_storage').used, 500);
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
  assert.match(html, /Exakt morgonkostnad/);
  assert.match(html, /D1 Query Insights/);
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

test('usage UI renders verified per-metric cost in the right-aligned card header', () => {
  const source = readFileSync(new URL('../src/settings-drift-ui.js', import.meta.url), 'utf8');
  assert.match(source, /settings-usage-cost/);
  assert.match(source, /fmtBillingCost\(m\)/);
  assert.match(source, /billingCost/);
  assert.match(source, /billingCurrency/);
  assert.match(source, /settings-usage-meta/);
  const backend = readFileSync(new URL('../src/settings-drift.js', import.meta.url), 'utf8');
  assert.match(backend, /R2 · Lagring/);
  assert.match(backend, /R2 · Class A/);
  assert.match(backend, /R2 · Class B/);
});

test('usage progress colors are green below 80, orange from 80 to below 100, and red from 100', () => {
  const source = readFileSync(new URL('../src/settings-drift-ui.js', import.meta.url), 'utf8');
  assert.match(source, /if\(n>=100\)return 'danger';if\(n>=80\)return 'warning';return 'ok'/);
  assert.match(source, /settings-usage-percent\.ok/);
  assert.match(source, /settings-usage-percent\.warning/);
  assert.match(source, /settings-usage-percent\.danger/);
  assert.match(source, /settings-usage-progress-fill\.ok/);
  assert.match(source, /settings-usage-progress-fill\.warning/);
  assert.match(source, /settings-usage-progress-fill\.danger/);
});

test('recent activity UI is expandable and shows approximate D1 reads, writes and USD cost', () => {
  const source = readFileSync(new URL('../src/settings-drift-ui.js', import.meta.url), 'utf8');
  assert.match(source, /<details class="settings-drift-activity-row"/);
  assert.match(source, /settings-drift-activity-chevron/);
  assert.match(source, /Beräknade D1 reads/);
  assert.match(source, /Beräknade D1 writes/);
  assert.match(source, /Beräknad D1-kostnad/);
  assert.match(source, /recentRunEstimates/);
  assert.match(source, /usageEstimateNote/);
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

test('legacy worker overlays no longer own scheduled data side jobs', () => {
  const snapshotWrapper = readFileSync(new URL('../src/worker-v066.js', import.meta.url), 'utf8');
  const startPointWrapper = readFileSync(new URL('../src/worker-v064.js', import.meta.url), 'utf8');
  const scheduler = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

  assert.doesNotMatch(snapshotWrapper, /syncOnePendingOfficialSnapshotSource|getAutomationControl/);
  assert.doesNotMatch(startPointWrapper, /syncOnePendingHorseStartPointSource|getAutomationControl/);
  assert.match(scheduler, /recent_start_points_promotion/);
  assert.match(scheduler, /recent_official_snapshot_promotion/);
  assert.match(scheduler, /minFetchedAt: recentPromotionCutoff/);
});
