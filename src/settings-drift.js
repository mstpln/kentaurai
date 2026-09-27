const AUTOMATION_KEY = 'automatic_workflows_enabled';

export const CLOUDFLARE_USAGE_LIMITS = Object.freeze({
  d1RowsRead: 25_000_000_000,
  d1RowsWritten: 50_000_000,
  d1StorageBytes: 5_000_000_000,
  r2StorageBytes: 10_000_000_000,
  r2ClassAOperations: 1_000_000,
  r2ClassBOperations: 10_000_000
});

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function anchoredDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInUtcMonth(year, monthIndex))));
}

export function billingCycleFromAnchor(anchorValue, nowValue = new Date()) {
  const anchor = new Date(anchorValue);
  const now = new Date(nowValue);
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(now.getTime())) return null;
  const day = anchor.getUTCDate();
  let start = anchoredDate(now.getUTCFullYear(), now.getUTCMonth(), day);
  if (start.getTime() > now.getTime()) {
    start = anchoredDate(now.getUTCFullYear(), now.getUTCMonth() - 1, day);
  }
  const end = anchoredDate(start.getUTCFullYear(), start.getUTCMonth() + 1, day);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getAutomationControl(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const row = await env.DB.prepare(`
    SELECT control_value, updated_at, updated_by
    FROM runtime_controls
    WHERE control_key = ?
    LIMIT 1
  `).bind(AUTOMATION_KEY).first();
  if (!row) throw new Error('automatic workflow control is missing');
  return {
    enabled: String(row.control_value) === '1',
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
  };
}

export async function setAutomationControl(env, enabled, actor = 'private_app') {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  const updatedAt = nowIso();
  await env.DB.prepare(`
    INSERT INTO runtime_controls (control_key, control_value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(control_key) DO UPDATE SET
      control_value = excluded.control_value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).bind(AUTOMATION_KEY, enabled ? '1' : '0', updatedAt, actor).run();
  return { enabled, updatedAt, updatedBy: actor };
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function cloudflareJson(fetchImpl, url, token, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type':'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false || (Array.isArray(data.errors) && data.errors.length)) {
    const message = data?.errors?.[0]?.message || `Cloudflare API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function billingCycle(env, fetchImpl, now) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const data = await cloudflareJson(
    fetchImpl,
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/billable-usage/info`,
    token
  );
  const subscriptions = data?.result?.subscriptions || [];
  const active = subscriptions.filter((item) => !item.end_timestamp);
  const candidates = (active.length ? active : subscriptions)
    .map((item) => item?.billing_cycle_anchor_timestamp || item?.start_timestamp || null)
    .filter(Boolean);
  const anchorDays = [...new Set(candidates.map((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getUTCDate() : null;
  }).filter((value) => value != null))];
  if (anchorDays.length !== 1 || !candidates.length) {
    throw new Error('Cloudflare billing cycle is unavailable or ambiguous');
  }
  const cycle = billingCycleFromAnchor(candidates[0], now);
  if (!cycle) throw new Error('Cloudflare billing cycle is unavailable');
  return cycle;
}

const D1_USAGE_QUERY = `query KentaurAiD1Usage($accountTag: string!, $start: Date, $end: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end }
      ) {
        sum { rowsRead rowsWritten }
      }
      d1StorageAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end }
        orderBy: [date_DESC]
      ) {
        max { databaseSizeBytes }
        dimensions { date databaseId }
      }
    }
  }
}`;

function verifiedNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Cloudflare ${label} metric is unavailable`);
  }
  return value;
}

function sumMetric(groups, key) {
  let total = 0;
  for (const group of groups || []) {
    if (!group?.sum || !Object.prototype.hasOwnProperty.call(group.sum, key)) {
      throw new Error(`Cloudflare D1 ${key} metric is unavailable`);
    }
    total += verifiedNonNegativeNumber(group.sum[key], `D1 ${key}`);
  }
  if (!Number.isFinite(total)) throw new Error(`Cloudflare D1 ${key} metric is unavailable`);
  return total;
}

function currentD1Storage(groups) {
  const latestByDatabase = new Map();
  for (const group of groups || []) {
    const databaseId = String(group?.dimensions?.databaseId || '');
    const date = String(group?.dimensions?.date || '');
    if (!databaseId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Cloudflare D1 storage dimensions are unavailable');
    }
    const value = verifiedNonNegativeNumber(group?.max?.databaseSizeBytes, 'D1 storage');
    const existing = latestByDatabase.get(databaseId);
    if (!existing || date > existing.date) {
      latestByDatabase.set(databaseId, { date, value });
    } else if (date === existing.date && value > existing.value) {
      latestByDatabase.set(databaseId, { date, value });
    }
  }
  return [...latestByDatabase.values()].reduce((sum, item) => sum + item.value, 0);
}

function classifyBillingRecord(record) {
  const family = String(record?.ServiceFamilyName || record?.x_ProductFamilyName || '').toLowerCase();
  const service = String(record?.ServiceName || record?.x_BillableMetricName || '').toLowerCase();
  const description = String(record?.ChargeDescription || '').toLowerCase();
  const metricId = String(record?.x_BillableMetricId || '').toLowerCase();
  const combined = [family, service, description, metricId].filter(Boolean).join(' ');
  if (combined.includes('d1')) {
    if (/rows?\s*(read|reads)|read\s*rows?/.test(combined)) return 'd1_rows_read';
    if (/rows?\s*(written|write|writes)|written\s*rows?|write\s*rows?/.test(combined)) return 'd1_rows_written';
    if (/storage|gb[- ]?months?|database\s*storage/.test(combined)) return 'd1_storage';
  }
  if (combined.includes('r2')) {
    if (/class\s*a|class[_ -]?a/.test(combined)) return 'r2_class_a';
    if (/class\s*b|class[_ -]?b/.test(combined)) return 'r2_class_b';
    if (/storage/.test(combined) && !/infrequent|retrieval|catalog|sql/.test(combined)) return 'r2_storage';
  }
  return null;
}

function aggregateBillingCosts(records) {
  const totals = new Map();
  for (const record of records || []) {
    const id = classifyBillingRecord(record);
    if (!id) continue;
    const cost = record?.BilledCost;
    const currency = String(record?.BillingCurrency || '').trim().toUpperCase();
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || !currency) continue;
    const existing = totals.get(id);
    if (existing && existing.currency !== currency) {
      totals.set(id, { available:false, amount:null, currency:null });
      continue;
    }
    if (existing?.available === false) continue;
    totals.set(id, { available:true, amount:(existing?.amount || 0) + cost, currency });
  }
  return totals;
}

async function billingCosts(env, fetchImpl, cycle, now) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/billable-usage`);
  url.searchParams.set('from', dateKey(cycle.start));
  url.searchParams.set('to', dateKey(now));
  const data = await cloudflareJson(fetchImpl, url.toString(), token);
  if (!Array.isArray(data?.result)) throw new Error('Cloudflare billable usage records are unavailable');
  return aggregateBillingCosts(data.result);
}

const R2_USAGE_QUERY = `query KentaurAiR2Usage($accountTag: string!, $start: Time, $end: Time) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests }
        dimensions { actionType }
      }
      r2StorageAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize }
        dimensions { datetime bucketName }
      }
    }
  }
}`;

const R2_CLASS_A_ACTIONS = new Set([
  'listbuckets','putbucket','listobjects','putobject','copyobject','completemultipartupload',
  'createmultipartupload','lifecyclestoragetiertransition','listmultipartuploads','uploadpart',
  'uploadpartcopy','listparts','putbucketencryption','putbucketcors','putbucketlifecycleconfiguration'
]);
const R2_CLASS_B_ACTIONS = new Set([
  'headbucket','headobject','getobject','usagesummary','getbucketencryption','getbucketlocation',
  'getbucketcors','getbucketlifecycleconfiguration'
]);

function normalizeR2Action(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function r2OperationCounts(groups) {
  let classA = 0;
  let classB = 0;
  for (const group of groups || []) {
    const requests = verifiedNonNegativeNumber(group?.sum?.requests, 'R2 requests');
    const action = normalizeR2Action(group?.dimensions?.actionType);
    if (R2_CLASS_A_ACTIONS.has(action)) classA += requests;
    else if (R2_CLASS_B_ACTIONS.has(action)) classB += requests;
  }
  return { classA, classB };
}

function currentR2Storage(groups) {
  const latestByBucket = new Map();
  for (const group of groups || []) {
    const bucket = String(group?.dimensions?.bucketName || '').trim();
    const datetime = String(group?.dimensions?.datetime || '').trim();
    const time = Date.parse(datetime);
    if (!bucket || !Number.isFinite(time)) throw new Error('Cloudflare R2 storage dimensions are unavailable');
    const payload = verifiedNonNegativeNumber(group?.max?.payloadSize, 'R2 payload storage');
    const metadata = verifiedNonNegativeNumber(group?.max?.metadataSize, 'R2 metadata storage');
    const value = payload + metadata;
    const existing = latestByBucket.get(bucket);
    if (!existing || time > existing.time || (time === existing.time && value > existing.value)) {
      latestByBucket.set(bucket, { time, value });
    }
  }
  return [...latestByBucket.values()].reduce((sum, item) => sum + item.value, 0);
}

async function r2Usage(env, fetchImpl, cycle, now) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const data = await cloudflareJson(fetchImpl, 'https://api.cloudflare.com/client/v4/graphql', token, {
    method:'POST',
    body: JSON.stringify({
      query: R2_USAGE_QUERY,
      variables: {
        accountTag: accountId,
        start: cycle.start,
        end: new Date(now).toISOString()
      }
    })
  });
  const account = data?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare R2 analytics account is unavailable');
  if (!Array.isArray(account.r2OperationsAdaptiveGroups) || !Array.isArray(account.r2StorageAdaptiveGroups)) {
    throw new Error('Cloudflare R2 analytics datasets are unavailable');
  }
  if (!account.r2StorageAdaptiveGroups.length) throw new Error('Cloudflare R2 storage metric is unavailable');
  const operations = r2OperationCounts(account.r2OperationsAdaptiveGroups);
  return {
    classAOperations: operations.classA,
    classBOperations: operations.classB,
    storageBytes: currentR2Storage(account.r2StorageAdaptiveGroups)
  };
}

async function d1Usage(env, fetchImpl, cycle, now) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const data = await cloudflareJson(fetchImpl, 'https://api.cloudflare.com/client/v4/graphql', token, {
    method:'POST',
    body: JSON.stringify({
      query: D1_USAGE_QUERY,
      variables: {
        accountTag: accountId,
        start: dateKey(cycle.start),
        end: dateKey(now)
      }
    })
  });
  if (Array.isArray(data.errors) && data.errors.length) throw new Error(data.errors[0]?.message || 'Cloudflare analytics query failed');
  const account = data?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare analytics account is unavailable');
  if (!Array.isArray(account.d1AnalyticsAdaptiveGroups) || !Array.isArray(account.d1StorageAdaptiveGroups)) {
    throw new Error('Cloudflare D1 analytics datasets are unavailable');
  }
  if (!account.d1StorageAdaptiveGroups.length) {
    throw new Error('Cloudflare D1 storage metric is unavailable');
  }
  return {
    rowsRead: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsRead'),
    rowsWritten: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
    storageBytes: currentD1Storage(account.d1StorageAdaptiveGroups)
  };
}

function usageMetric(id, label, used, limit, unit, rule, billingCost = null) {
  const numeric = verifiedNonNegativeNumber(used, id);
  return {
    id,
    label,
    used: numeric,
    limit,
    unit,
    percent: limit > 0 ? (numeric / limit) * 100 : null,
    overLimit: limit > 0 ? numeric > limit : false,
    rule,
    billingCost: billingCost?.available === true ? billingCost.amount : null,
    billingCurrency: billingCost?.available === true ? billingCost.currency : null
  };
}

export async function getCloudflareUsage(env, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now ? new Date(options.now) : new Date();
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env?.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  if (!accountId || !token) {
    return {
      configured: false,
      reason: 'cloudflare_usage_not_configured',
      billingPeriod: null,
      metrics: []
    };
  }
  try {
    const cycle = await billingCycle(env, fetchImpl, now);
    const [d1, r2] = await Promise.all([
      d1Usage(env, fetchImpl, cycle, now),
      r2Usage(env, fetchImpl, cycle, now)
    ]);
    let costByMetric = new Map();
    let billingCostAvailable = true;
    try {
      costByMetric = await billingCosts(env, fetchImpl, cycle, now);
    } catch {
      billingCostAvailable = false;
    }
    return {
      configured: true,
      fetchedAt: nowIso(now),
      billingPeriod: cycle,
      metrics: [
        usageMetric('d1_rows_read', 'D1 · Rows read', d1.rowsRead, CLOUDFLARE_USAGE_LIMITS.d1RowsRead, 'rows',
          '25 miljarder ingår per billingperiod. Därefter debiteras överförbrukning.', costByMetric.get('d1_rows_read')),
        usageMetric('d1_rows_written', 'D1 · Rows written', d1.rowsWritten, CLOUDFLARE_USAGE_LIMITS.d1RowsWritten, 'rows',
          '50 miljoner ingår per billingperiod.', costByMetric.get('d1_rows_written')),
        usageMetric('d1_storage', 'D1 · Lagring', d1.storageBytes, CLOUDFLARE_USAGE_LIMITS.d1StorageBytes, 'bytes',
          '5 GB ingår. Lagring över den inkluderade nivån debiteras.', costByMetric.get('d1_storage')),
        usageMetric('r2_storage', 'R2 · Lagring', r2.storageBytes, CLOUDFLARE_USAGE_LIMITS.r2StorageBytes, 'bytes',
          '10 GB-månad ingår för Standard storage.', costByMetric.get('r2_storage')),
        usageMetric('r2_class_a', 'R2 · Class A', r2.classAOperations, CLOUDFLARE_USAGE_LIMITS.r2ClassAOperations, 'requests',
          '1 miljon Class A-operationer ingår per månad.', costByMetric.get('r2_class_a')),
        usageMetric('r2_class_b', 'R2 · Class B', r2.classBOperations, CLOUDFLARE_USAGE_LIMITS.r2ClassBOperations, 'requests',
          '10 miljoner Class B-operationer ingår per månad.', costByMetric.get('r2_class_b'))
      ],
      additional: {
        billingCostAvailable,
        r2AndWorkers: 'planned_from_cloudflare_billing_usage'
      }
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      reason: 'cloudflare_usage_unavailable',
      message: String(error.message || error).slice(0, 300),
      billingPeriod: null,
      metrics: []
    };
  }
}

export async function getDriftOverview(env, options = {}) {
  const [automation, cloudflare] = await Promise.all([
    getAutomationControl(env),
    getCloudflareUsage(env, options)
  ]);
  return {
    automation,
    cloudflare,
    schedule: {
      cron: '15 5 * * *',
      timeZone: 'Europe/Stockholm'
    }
  };
}
