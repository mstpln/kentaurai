import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUDFLARE_INCLUDED_USAGE,
  currentBillingPeriod,
  getCloudflareUsageOverview
} from '../src/cloudflare-usage.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type':'application/json' }
  });
}

test('billing period follows Cloudflare subscription anchor and clamps month length', () => {
  assert.deepEqual(
    currentBillingPeriod('2026-09-12T00:00:00Z', new Date('2026-09-27T18:00:00Z')),
    { start:'2026-09-12T00:00:00.000Z', end:'2026-10-12T00:00:00.000Z' }
  );

  const february = currentBillingPeriod('2026-01-31T10:00:00Z', new Date('2026-02-15T12:00:00Z'));
  assert.equal(february.start, '2026-01-31T10:00:00.000Z');
  assert.equal(february.end, '2026-02-28T10:00:00.000Z');
});

test('usage overview does not invent zero usage when Cloudflare read credentials are absent', async () => {
  const data = await getCloudflareUsageOverview({});
  assert.equal(data.configured, false);
  assert.equal(data.reason, 'missing_usage_token');
  assert.equal(data.limits.d1RowsRead, CLOUDFLARE_INCLUDED_USAGE.d1RowsRead);
});

test('usage overview uses account-wide Cloudflare metrics and billing-period limits', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url:String(url), method:options.method || 'GET', body:options.body || null });

    if (String(url).endsWith('/billable-usage/info')) {
      return jsonResponse({
        success:true,
        result:{
          subscriptions:[{
            start_timestamp:'2026-01-01T00:00:00Z',
            billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z'
          }]
        }
      });
    }

    if (String(url).includes('/d1/database?')) {
      return jsonResponse({
        success:true,
        result:[
          { uuid:'synthetic-db-1', file_size:4_700_000_000 },
          { uuid:'synthetic-db-2', file_size:100_000_000 }
        ],
        result_info:{ total_pages:1 }
      });
    }

    if (String(url).includes('/billable-usage?')) {
      return jsonResponse({
        success:true,
        result:[
          {
            x_ProductFamilyName:'Workers',
            x_BillableMetricId:'workers_cpu_time',
            ConsumedQuantity:10000,
            ConsumedUnit:'seconds',
            BilledCost:1.25,
            BillingCurrency:'USD'
          },
          {
            x_ProductFamilyName:'R2',
            x_BillableMetricId:'r2_storage',
            ConsumedQuantity:4.2,
            ConsumedUnit:'GB-month',
            BilledCost:0.5,
            BillingCurrency:'USD'
          }
        ]
      });
    }

    if (String(url).endsWith('/graphql')) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.variables.accountTag, 'synthetic-account');
      assert.equal(payload.variables.startDate, '2026-09-12');
      assert.equal(payload.variables.endDate, '2026-09-27');
      assert.equal(payload.variables.startTime, '2026-09-12T00:00:00.000Z');
      assert.equal(payload.variables.endTime, '2026-09-27T18:00:00.000Z');
      assert.doesNotMatch(payload.query, /bucketName|scriptName/);
      return jsonResponse({
        data:{
          viewer:{
            accounts:[{
              d1AnalyticsAdaptiveGroups:[{ sum:{ rowsRead:27_000_000_000, rowsWritten:1_000_000 } }],
              r2OperationsAdaptiveGroups:[
                { dimensions:{ actionType:'ListObjects' }, sum:{ requests:200_000 } },
                { dimensions:{ actionType:'GetObject' }, sum:{ requests:2_000_000 } },
                { dimensions:{ actionType:'DeleteObject' }, sum:{ requests:12_000 } }
              ],
              workersInvocationsAdaptive:[{ sum:{ requests:5_000_000, errors:3 } }]
            }]
          }
        }
      });
    }

    throw new Error('unexpected Cloudflare URL: ' + url);
  };

  const data = await getCloudflareUsageOverview({
    CLOUDFLARE_USAGE_API_TOKEN:'synthetic-token',
    CLOUDFLARE_ACCOUNT_ID:'synthetic-account'
  }, {
    now:new Date('2026-09-27T18:00:00Z'),
    fetchImpl
  });

  assert.equal(data.configured, true);
  assert.deepEqual(data.billingPeriod, {
    start:'2026-09-12T00:00:00.000Z',
    end:'2026-10-12T00:00:00.000Z'
  });

  assert.equal(data.d1.rowsRead.value, 27_000_000_000);
  assert.equal(data.d1.rowsRead.overIncluded, true);
  assert.equal(data.d1.rowsRead.overBy, 2_000_000_000);
  assert.equal(data.d1.rowsWritten.value, 1_000_000);
  assert.equal(data.d1.rowsWritten.overIncluded, false);
  assert.equal(data.d1.storage.value, 4_800_000_000);
  assert.equal(data.d1.storage.percent, 96);
  assert.equal(data.d1.storage.scope, 'cloudflare_account');

  assert.equal(data.r2.classAOperations.value, 200_000);
  assert.equal(data.r2.classBOperations.value, 2_000_000);
  assert.equal(data.r2.freeOperations, 12_000);
  assert.equal(data.r2.storage.value, 4.2);
  assert.equal(data.r2.storage.exactBillingProgress, true);

  assert.equal(data.workers.requests.value, 5_000_000);
  assert.equal(data.workers.cpu.value, 10_000_000);
  assert.equal(data.workers.cpu.exactBillingProgress, true);

  assert.equal(data.billedUsageCost.amount, 1.75);
  assert.equal(data.billedUsageCost.currency, 'USD');
  assert.ok(calls.length >= 4);
});

test('ambiguous Cloudflare billing anchors fail rather than combining unlike periods', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/billable-usage/info')) {
      return jsonResponse({
        success:true,
        result:{
          subscriptions:[
            { start_timestamp:'2026-01-01T00:00:00Z', billing_cycle_anchor_timestamp:'2026-09-01T00:00:00Z' },
            { start_timestamp:'2026-01-01T00:00:00Z', billing_cycle_anchor_timestamp:'2026-09-12T00:00:00Z' }
          ]
        }
      });
    }
    throw new Error('should not continue after ambiguous billing anchors');
  };

  await assert.rejects(
    getCloudflareUsageOverview({
      CLOUDFLARE_USAGE_API_TOKEN:'synthetic-token',
      CLOUDFLARE_ACCOUNT_ID:'synthetic-account'
    }, {
      now:new Date('2026-09-27T18:00:00Z'),
      fetchImpl
    }),
    /different billing cycle anchors/
  );
});
