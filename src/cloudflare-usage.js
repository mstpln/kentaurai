const API_ROOT = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_URL = `${API_ROOT}/graphql`;

const D1_DATABASE_ID = 'd8189e0e-6127-4ef2-88cc-534cb2217340';
const R2_BUCKET_NAME = 'kentaurai-raw';
const WORKER_SCRIPT_NAME = 'kentaurai-api';

export const CLOUDFLARE_INCLUDED_USAGE = Object.freeze({
  d1RowsRead: 25_000_000_000,
  d1RowsWritten: 50_000_000,
  d1StorageBytes: 5_000_000_000,
  r2ClassAOperations: 1_000_000,
  r2ClassBOperations: 10_000_000,
  r2StorageGbMonth: 10,
  workersRequests: 10_000_000,
  workersCpuMs: 30_000_000
});

const R2_CLASS_A = new Set([
  'ListBuckets','PutBucket','ListObjects','PutObject','CopyObject','CompleteMultipartUpload',
  'CreateMultipartUpload','LifecycleStorageTierTransition','ListMultipartUploads','UploadPart',
  'UploadPartCopy','ListParts','PutBucketEncryption','PutBucketCors','PutBucketLifecycleConfiguration'
]);
const R2_CLASS_B = new Set([
  'HeadBucket','HeadObject','GetObject','UsageSummary','GetBucketEncryption','GetBucketLocation',
  'GetBucketCors','GetBucketLifecycleConfiguration'
]);

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...extra
  };
}

async function readCloudflareJson(response, label) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (!response.ok || body?.success === false || (Array.isArray(body?.errors) && body.errors.length)) {
    const message = body?.errors?.[0]?.message || `${label} failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function anchoredUtcDate(year, month, day, time) {
  const safeDay = Math.min(day, daysInUtcMonth(year, month));
  return new Date(Date.UTC(
    year,
    month,
    safeDay,
    time.getUTCHours(),
    time.getUTCMinutes(),
    time.getUTCSeconds(),
    time.getUTCMilliseconds()
  ));
}

export function currentBillingPeriod(anchorValue, nowValue = new Date()) {
  const anchor = new Date(anchorValue);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(now.getTime())) {
    throw new Error('billing anchor and now must be valid dates');
  }
  const day = anchor.getUTCDate();
  let start = anchoredUtcDate(now.getUTCFullYear(), now.getUTCMonth(), day, anchor);
  if (start.getTime() > now.getTime()) {
    start = anchoredUtcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, day, anchor);
  }
  const end = anchoredUtcDate(start.getUTCFullYear(), start.getUTCMonth() + 1, day, anchor);
  return { start: start.toISOString(), end: end.toISOString() };
}

function activeBillingAnchor(info, now) {
  const subscriptions = info?.result?.subscriptions || [];
  const nowMs = now.getTime();
  const active = subscriptions.filter((item) => {
    const start = Date.parse(item.start_timestamp || item.billing_cycle_anchor_timestamp || '');
    const end = item.end_timestamp ? Date.parse(item.end_timestamp) : Infinity;
    return Number.isFinite(start) && start <= nowMs && end > nowMs;
  });
  if (active.length !== 1) {
    throw new Error(active.length ? 'multiple active Cloudflare usage subscriptions' : 'no active Cloudflare usage subscription');
  }
  const anchor = active[0].billing_cycle_anchor_timestamp;
  if (!anchor) throw new Error('Cloudflare billing cycle anchor is unavailable');
  return anchor;
}

function dayString(iso) {
  return String(iso).slice(0, 10);
}

function endInclusiveIso(endExclusive) {
  return new Date(new Date(endExclusive).getTime() - 1).toISOString();
}

async function cloudflareGet(fetchImpl, url, token, label) {
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  return readCloudflareJson(response, label);
}

async function cloudflareGraphql(fetchImpl, token, query, variables) {
  const response = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: authHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ query, variables })
  });
  const body = await readCloudflareJson(response, 'Cloudflare Analytics API');
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(body.errors[0]?.message || 'Cloudflare Analytics API returned an error');
  }
  return body.data;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function progress(value, included) {
  const safeValue = numberOrZero(value);
  return {
    value: safeValue,
    included,
    percent: included > 0 ? (safeValue / included) * 100 : null,
    overIncluded: safeValue > included,
    overBy: Math.max(0, safeValue - included),
    remaining: Math.max(0, included - safeValue)
  };
}

function aggregateR2Operations(rows) {
  let classA = 0;
  let classB = 0;
  let free = 0;
  let other = 0;
  for (const row of rows || []) {
    const action = row?.dimensions?.actionType || '';
    const requests = numberOrZero(row?.sum?.requests);
    if (R2_CLASS_A.has(action)) classA += requests;
    else if (R2_CLASS_B.has(action)) classB += requests;
    else if (action === 'DeleteObject' || action === 'DeleteBucket' || action === 'AbortMultipartUpload') free += requests;
    else other += requests;
  }
  return { classA, classB, free, other };
}

function metricRecordId(row) {
  return String(row?.x_BillableMetricId || row?.x_BillableMetricName || row?.ChargeDescription || '').toLowerCase();
}

function sumBillingMetric(rows, matcher) {
  return (rows || []).reduce((sum, row) => matcher(metricRecordId(row), row)
    ? sum + numberOrZero(row.ConsumedQuantity)
    : sum, 0);
}

function findWorkersCpuMs(rows) {
  const quantity = sumBillingMetric(rows, (id, row) =>
    String(row?.x_ProductFamilyName || '').toLowerCase() === 'workers'
    && /cpu/.test(id)
  );
  if (!quantity) return null;
  const matching = (rows || []).find((row) =>
    String(row?.x_ProductFamilyName || '').toLowerCase() === 'workers'
    && /cpu/.test(metricRecordId(row))
  );
  const unit = String(matching?.ConsumedUnit || matching?.PricingUnit || '').toLowerCase();
  if (unit.includes('millisecond') || unit === 'ms') return quantity;
  if (unit.includes('second')) return quantity * 1000;
  return null;
}

function findR2StorageGbMonth(rows) {
  const candidates = (rows || []).filter((row) =>
    String(row?.x_ProductFamilyName || '').toLowerCase() === 'r2'
    && /storage/.test(metricRecordId(row))
  );
  if (!candidates.length) return null;
  let total = 0;
  for (const row of candidates) {
    const unit = String(row?.ConsumedUnit || row?.PricingUnit || '').toLowerCase();
    const quantity = numberOrZero(row?.ConsumedQuantity);
    if (unit.includes('gb')) total += quantity;
    else return null;
  }
  return total;
}

function billingCost(rows) {
  let amount = 0;
  let currency = null;
  for (const row of rows || []) {
    const cost = Number(row?.BilledCost ?? row?.EffectiveCost);
    if (Number.isFinite(cost)) amount += cost;
    if (!currency && row?.BillingCurrency) currency = row.BillingCurrency;
  }
  return { amount, currency: currency || 'USD' };
}

const ANALYTICS_QUERY = `
query KentaurAICloudflareUsage(
  $accountTag: string!
  $startDate: Date
  $endDate: Date
  $startTime: Time
  $endTime: Time
  $bucketName: string
  $scriptName: string
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 1
        filter: { date_geq: $startDate, date_leq: $endDate }
      ) {
        sum { rowsRead rowsWritten }
      }
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $startTime
          datetime_leq: $endTime
          bucketName: $bucketName
        }
      ) {
        sum { requests }
        dimensions { actionType }
      }
      r2StorageAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $startTime
          datetime_leq: $endTime
          bucketName: $bucketName
        }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize objectCount }
        dimensions { datetime }
      }
      workersInvocationsAdaptive(
        limit: 1
        filter: {
          scriptName: $scriptName
          datetime_geq: $startTime
          datetime_leq: $endTime
        }
      ) {
        sum { requests errors }
      }
    }
  }
}
`;

export async function getCloudflareUsageOverview(env, options = {}) {
  const token = String(env?.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const fetchImpl = options.fetchImpl || fetch;

  if (!token || !accountId) {
    return {
      configured: false,
      reason: !token ? 'missing_usage_token' : 'missing_account_id',
      limits: CLOUDFLARE_INCLUDED_USAGE
    };
  }

  const info = await cloudflareGet(
    fetchImpl,
    `${API_ROOT}/accounts/${encodeURIComponent(accountId)}/billable-usage/info`,
    token,
    'Cloudflare billing info'
  );
  const period = currentBillingPeriod(activeBillingAnchor(info, now), now);
  const endInclusive = endInclusiveIso(period.end);
  const usageTo = now.getTime() < Date.parse(period.end) ? now.toISOString() : endInclusive;

  const [analytics, d1Details, billable] = await Promise.all([
    cloudflareGraphql(fetchImpl, token, ANALYTICS_QUERY, {
      accountTag: accountId,
      startDate: dayString(period.start),
      endDate: dayString(usageTo),
      startTime: period.start,
      endTime: usageTo,
      bucketName: R2_BUCKET_NAME,
      scriptName: WORKER_SCRIPT_NAME
    }),
    cloudflareGet(
      fetchImpl,
      `${API_ROOT}/accounts/${encodeURIComponent(accountId)}/d1/database/${D1_DATABASE_ID}?fields=file_size,name,uuid`,
      token,
      'Cloudflare D1 database details'
    ),
    cloudflareGet(
      fetchImpl,
      `${API_ROOT}/accounts/${encodeURIComponent(accountId)}/billable-usage?from=${encodeURIComponent(dayString(period.start))}&to=${encodeURIComponent(dayString(usageTo))}`,
      token,
      'Cloudflare billable usage'
    )
  ]);

  const account = analytics?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare Analytics API returned no matching account');

  const d1 = account.d1AnalyticsAdaptiveGroups?.[0]?.sum || {};
  const r2Ops = aggregateR2Operations(account.r2OperationsAdaptiveGroups || []);
  const r2Storage = account.r2StorageAdaptiveGroups?.[0] || null;
  const workers = account.workersInvocationsAdaptive?.[0]?.sum || {};
  const billingRows = billable?.result || [];
  const workersCpuMs = findWorkersCpuMs(billingRows);
  const r2StorageGbMonth = findR2StorageGbMonth(billingRows);
  const cost = billingCost(billingRows);
  const d1StorageBytes = numberOrZero(d1Details?.result?.file_size);
  const currentR2Bytes = numberOrZero(r2Storage?.max?.payloadSize) + numberOrZero(r2Storage?.max?.metadataSize);

  return {
    configured: true,
    fetchedAt: now.toISOString(),
    billingPeriod: period,
    source: 'cloudflare_api',
    d1: {
      rowsRead: progress(d1.rowsRead, CLOUDFLARE_INCLUDED_USAGE.d1RowsRead),
      rowsWritten: progress(d1.rowsWritten, CLOUDFLARE_INCLUDED_USAGE.d1RowsWritten),
      storage: {
        ...progress(d1StorageBytes, CLOUDFLARE_INCLUDED_USAGE.d1StorageBytes),
        scope: 'kentaurai_database',
        accountIncludedLimit: true
      }
    },
    r2: {
      classAOperations: progress(r2Ops.classA, CLOUDFLARE_INCLUDED_USAGE.r2ClassAOperations),
      classBOperations: progress(r2Ops.classB, CLOUDFLARE_INCLUDED_USAGE.r2ClassBOperations),
      freeOperations: r2Ops.free,
      unclassifiedOperations: r2Ops.other,
      storage: r2StorageGbMonth == null ? {
        value: currentR2Bytes,
        unit: 'bytes_current',
        included: CLOUDFLARE_INCLUDED_USAGE.r2StorageGbMonth,
        exactBillingProgress: false,
        objectCount: numberOrZero(r2Storage?.max?.objectCount)
      } : {
        ...progress(r2StorageGbMonth, CLOUDFLARE_INCLUDED_USAGE.r2StorageGbMonth),
        unit: 'gb_month',
        exactBillingProgress: true,
        currentBytes: currentR2Bytes,
        objectCount: numberOrZero(r2Storage?.max?.objectCount)
      }
    },
    workers: {
      requests: progress(workers.requests, CLOUDFLARE_INCLUDED_USAGE.workersRequests),
      cpu: workersCpuMs == null ? {
        value: null,
        included: CLOUDFLARE_INCLUDED_USAGE.workersCpuMs,
        exactBillingProgress: false
      } : {
        ...progress(workersCpuMs, CLOUDFLARE_INCLUDED_USAGE.workersCpuMs),
        unit: 'ms',
        exactBillingProgress: true
      }
    },
    billedUsageCost: cost
  };
}
