const AUTOMATION_KEY = 'automatic_workflows_enabled';
const KENTAURAI_D1_DATABASE_ID = 'd8189e0e-6127-4ef2-88cc-534cb2217340';

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

const D1_USAGE_QUERY = `query KentaurAiUsage(
  $accountTag: string!,
  $databaseId: string!,
  $start: Date,
  $end: Date,
  $r2Start: Time!,
  $r2End: Time!,
  $r2BucketName: string!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }
      ) {
        sum { rowsRead rowsWritten }
        dimensions { date databaseId }
      }
      d1StorageAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }
        orderBy: [date_DESC]
      ) {
        max { databaseSizeBytes }
        dimensions { date databaseId }
      }
      d1QueriesAdaptiveGroups(
        limit: 20
        filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }
        orderBy: [sum_rowsRead_DESC]
      ) {
        count
        avg { rowsRead rowsReturned rowsWritten queryDurationMs }
        sum { rowsRead rowsReturned rowsWritten queryDurationMs }
        dimensions { query databaseId }
      }
      r2StorageAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $r2Start
          datetime_leq: $r2End
          bucketName: $r2BucketName
        }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize }
        dimensions { datetime }
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

function currentR2Storage(groups) {
  let latest = null;
  for (const group of groups || []) {
    const observedAt = String(group?.dimensions?.datetime || '');
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs)) continue;
    const payloadBytes = verifiedNonNegativeNumber(group?.max?.payloadSize, 'R2 payload storage');
    const metadataBytes = verifiedNonNegativeNumber(group?.max?.metadataSize, 'R2 metadata storage');
    const bytes = payloadBytes + metadataBytes;
    if (!latest || observedMs > latest.observedMs || (observedMs === latest.observedMs && bytes > latest.bytes)) {
      latest = { bytes, observedAt, observedMs };
    }
  }
  return latest ? { bytes:latest.bytes, observedAt:latest.observedAt } : null;
}

function dailyD1Usage(groups) {
  const byDate = new Map();
  for (const group of groups || []) {
    const date = String(group?.dimensions?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rowsRead = verifiedNonNegativeNumber(group?.sum?.rowsRead, 'D1 rowsRead');
    const rowsWritten = verifiedNonNegativeNumber(group?.sum?.rowsWritten, 'D1 rowsWritten');
    const current = byDate.get(date) || { date, rowsRead:0, rowsWritten:0 };
    current.rowsRead += rowsRead;
    current.rowsWritten += rowsWritten;
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
}

function runDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function runActivityWeight(run) {
  const activity = ['inserted_count','updated_count','skipped_count','error_count']
    .reduce((sum, key) => sum + Math.max(0, Number(run?.[key] || 0)), 0);
  if (activity > 0) return activity;
  const start = Date.parse(run?.started_at || '');
  const end = Date.parse(run?.finished_at || run?.started_at || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return Math.max(1, Math.round((end - start) / 1000));
  }
  return 1;
}

function billableDelta(before, amount, included) {
  const prior = Math.max(0, before - included);
  const after = Math.max(0, before + amount - included);
  return Math.max(0, after - prior);
}

async function estimateRecentRunD1Usage(env, cycle, dailyUsage) {
  if (!env?.DB || !Array.isArray(dailyUsage) || !dailyUsage.length) return {};
  const { results = [] } = await env.DB.prepare(`
    SELECT id, source_type, started_at, finished_at,
           inserted_count, updated_count, skipped_count, error_count
    FROM import_runs
    WHERE datetime(started_at) >= datetime(?)
      AND datetime(started_at) < datetime(?)
    ORDER BY datetime(started_at) DESC, id DESC
    LIMIT 1000
  `).bind(cycle.start, cycle.end).all();

  const byDate = new Map();
  for (const run of results) {
    const date = runDate(run.started_at);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(run);
  }

  const cumulativeBefore = new Map();
  let readsBefore = 0;
  let writesBefore = 0;
  for (const day of dailyUsage) {
    cumulativeBefore.set(day.date, { rowsRead:readsBefore, rowsWritten:writesBefore });
    readsBefore += day.rowsRead;
    writesBefore += day.rowsWritten;
  }

  const estimates = {};
  for (const day of dailyUsage) {
    const runs = byDate.get(day.date) || [];
    if (!runs.length) continue;
    const totalWeight = runs.reduce((sum, run) => sum + runActivityWeight(run), 0);
    if (!(totalWeight > 0)) continue;
    const before = cumulativeBefore.get(day.date) || { rowsRead:0, rowsWritten:0 };
    const billableReads = billableDelta(before.rowsRead, day.rowsRead, CLOUDFLARE_USAGE_LIMITS.d1RowsRead);
    const billableWrites = billableDelta(before.rowsWritten, day.rowsWritten, CLOUDFLARE_USAGE_LIMITS.d1RowsWritten);

    for (const run of runs) {
      const share = runActivityWeight(run) / totalWeight;
      const rowsRead = Math.round(day.rowsRead * share);
      const rowsWritten = Math.round(day.rowsWritten * share);
      const runBillableReads = billableReads * share;
      const runBillableWrites = billableWrites * share;
      const readCostUsd = (runBillableReads / 1_000_000) * 0.001;
      const writeCostUsd = (runBillableWrites / 1_000_000) * 1;
      estimates[String(run.id)] = {
        method:'daily_cloudflare_allocation_v1',
        approximate:true,
        date:day.date,
        rowsRead,
        rowsWritten,
        estimatedCostUsd:readCostUsd + writeCostUsd,
        estimatedReadCostUsd:readCostUsd,
        estimatedWriteCostUsd:writeCostUsd,
        allocationShare:share,
        sameDayRunCount:runs.length
      };
    }
  }
  return estimates;
}

function classifyBillingRecord(record) {
  const family = String(record?.ServiceFamilyName || record?.x_ProductFamilyName || '').toLowerCase();
  const service = String(record?.ServiceName || record?.x_BillableMetricName || '').toLowerCase();
  const description = String(record?.ChargeDescription || '').toLowerCase();
  const metricId = String(record?.x_BillableMetricId || '').toLowerCase();
  const combined = [family, service, description, metricId].filter(Boolean).join(' ');
  const normalized = combined.replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bd1\b/.test(normalized)) {
    if (/\brows?\s+(read|reads)\b|\bread\s+rows?\b/.test(normalized)) return 'd1_rows_read';
    if (/\brows?\s+(written|write|writes)\b|\bwritten\s+rows?\b|\bwrite\s+rows?\b/.test(normalized)) return 'd1_rows_written';
    if (/\bstorage\b|\bgb\s+months?\b|\bdatabase\s+storage\b/.test(normalized)) return 'd1_storage';
  }
  if (/\br2\b/.test(normalized)) {
    if (/\bclass\s+a\b/.test(normalized)) return 'r2_class_a';
    if (/\bclass\s+b\b/.test(normalized)) return 'r2_class_b';
    if (/\bstorage\b/.test(normalized) && !/\binfrequent\b|\bretrieval\b|\bcatalog\b|\bsql\b/.test(normalized)) return 'r2_storage';
  }
  return null;
}

function recordCost(record) {
  for (const key of ['BilledCost', 'EffectiveCost', 'ContractedCost']) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function aggregateBillingMetrics(records) {
  const totals = new Map();
  for (const record of records || []) {
    const id = classifyBillingRecord(record);
    if (!id) continue;
    const cost = recordCost(record);
    const currency = String(record?.BillingCurrency || '').trim().toUpperCase();
    if (cost == null || !currency) continue;

    const quantity = record?.ConsumedQuantity;
    const unit = String(record?.ConsumedUnit || '').trim();
    const quantityValid = typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0 && unit;
    const existing = totals.get(id);

    if (existing && existing.currency !== currency) {
      totals.set(id, { available:false, amount:null, currency:null, quantity:null, unit:null, quantityAvailable:false });
      continue;
    }
    if (existing?.available === false) continue;

    let quantityAvailable = Boolean(existing?.quantityAvailable);
    let aggregatedQuantity = existing?.quantity ?? null;
    let aggregatedUnit = existing?.unit ?? null;
    if (quantityValid) {
      if (quantityAvailable && aggregatedUnit !== unit) {
        quantityAvailable = false;
        aggregatedQuantity = null;
        aggregatedUnit = null;
      } else if (!quantityAvailable && aggregatedQuantity == null && aggregatedUnit == null) {
        quantityAvailable = true;
        aggregatedQuantity = quantity;
        aggregatedUnit = unit;
      } else if (quantityAvailable) {
        aggregatedQuantity += quantity;
      }
    }

    totals.set(id, {
      available:true,
      amount:(existing?.amount || 0) + cost,
      currency,
      quantity:aggregatedQuantity,
      unit:aggregatedUnit,
      quantityAvailable
    });
  }
  return totals;
}

async function billingMetrics(env, fetchImpl, cycle, now) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || '').trim();
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/billable-usage`);
  url.searchParams.set('from', dateKey(cycle.start));
  url.searchParams.set('to', dateKey(now));
  const data = await cloudflareJson(fetchImpl, url.toString(), token);
  if (!Array.isArray(data?.result)) throw new Error('Cloudflare billable usage records are unavailable');
  return aggregateBillingMetrics(data.result);
}

function d1QueryInsights(groups) {
  return (groups || []).map((group) => {
    const query = String(group?.dimensions?.query || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const count = verifiedNonNegativeNumber(group?.count, 'D1 query count');
    const totalRowsRead = verifiedNonNegativeNumber(group?.sum?.rowsRead, 'D1 query rowsRead');
    const totalRowsWritten = verifiedNonNegativeNumber(group?.sum?.rowsWritten, 'D1 query rowsWritten');
    const totalDurationMs = verifiedNonNegativeNumber(group?.sum?.queryDurationMs, 'D1 query duration');
    const rowsReturned = verifiedNonNegativeNumber(group?.sum?.rowsReturned, 'D1 query rowsReturned');
    return {
      query,
      count,
      totalRowsRead,
      avgRowsRead: count > 0 ? totalRowsRead / count : 0,
      totalRowsWritten,
      avgRowsWritten: count > 0 ? totalRowsWritten / count : 0,
      totalDurationMs,
      avgDurationMs: count > 0 ? totalDurationMs / count : 0,
      queryEfficiency: totalRowsRead > 0 ? rowsReturned / totalRowsRead : 0
    };
  }).sort((a, b) => b.totalRowsRead - a.totalRowsRead);
}

async function recentMorningStageCosts(env) {
  if (!env?.DB) return [];
  const { results = [] } = await env.DB.prepare(`
    SELECT id, started_at, finished_at, status, metadata_json
    FROM import_runs
    WHERE source_type = 'scheduled_orchestrator'
    ORDER BY started_at DESC, id DESC
    LIMIT 7
  `).all();
  return results.map((run) => {
    let metadata = {};
    try { metadata = JSON.parse(run.metadata_json || '{}'); } catch {}
    return {
      id: run.id,
      startedAt: run.started_at || null,
      finishedAt: run.finished_at || null,
      status: run.status || null,
      total: metadata?.safety?.metrics || null,
      stopped: Boolean(metadata?.safety?.stopped),
      stopReason: metadata?.safety?.reason || null,
      stages: Array.isArray(metadata?.parts) ? metadata.parts.map((part) => ({
        name: part?.name || 'unknown',
        ok: part?.ok !== false,
        skipped: Boolean(part?.skipped),
        reason: part?.reason || null,
        cost: part?.cost || null,
        safetyStop: Boolean(part?.safetyStop)
      })) : []
    };
  });
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
        databaseId: KENTAURAI_D1_DATABASE_ID,
        start: dateKey(cycle.start),
        end: dateKey(now),
        r2Start: cycle.start,
        r2End: now.toISOString(),
        r2BucketName: 'kentaurai-raw'
      }
    })
  });
  if (Array.isArray(data.errors) && data.errors.length) throw new Error(data.errors[0]?.message || 'Cloudflare analytics query failed');
  const account = data?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare analytics account is unavailable');
  if (!Array.isArray(account.d1AnalyticsAdaptiveGroups) || !Array.isArray(account.d1StorageAdaptiveGroups) || !Array.isArray(account.d1QueriesAdaptiveGroups)) {
    throw new Error('Cloudflare D1 analytics datasets are unavailable');
  }
  if (!account.d1StorageAdaptiveGroups.length) {
    throw new Error('Cloudflare D1 storage metric is unavailable');
  }
  const r2Storage = Array.isArray(account.r2StorageAdaptiveGroups)
    ? currentR2Storage(account.r2StorageAdaptiveGroups)
    : null;
  return {
    rowsRead: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsRead'),
    rowsWritten: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
    storageBytes: currentD1Storage(account.d1StorageAdaptiveGroups),
    dailyUsage: dailyD1Usage(account.d1AnalyticsAdaptiveGroups),
    queryInsights: d1QueryInsights(account.d1QueriesAdaptiveGroups),
    r2StorageBytes: r2Storage?.bytes ?? null,
    r2StorageObservedAt: r2Storage?.observedAt ?? null
  };
}

function d1FallbackCost(metricId, used) {
  const numeric = verifiedNonNegativeNumber(used, metricId);
  if (metricId === 'd1_rows_read') {
    return { available:true, amount:(Math.max(0, numeric - CLOUDFLARE_USAGE_LIMITS.d1RowsRead) / 1_000_000) * 0.001, currency:'USD', source:'published_pricing' };
  }
  if (metricId === 'd1_rows_written') {
    return { available:true, amount:(Math.max(0, numeric - CLOUDFLARE_USAGE_LIMITS.d1RowsWritten) / 1_000_000) * 1, currency:'USD', source:'published_pricing' };
  }
  return null;
}

function billingCostOrFallback(metricId, used, billingMetric) {
  if (billingMetric?.available === true) return { ...billingMetric, source:'cloudflare_billing' };
  return d1FallbackCost(metricId, used);
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
    billingCurrency: billingCost?.available === true ? billingCost.currency : null,
    billingCostSource: billingCost?.available === true ? (billingCost.source || 'cloudflare_billing') : null
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
    const d1 = await d1Usage(env, fetchImpl, cycle, now);
    let billingByMetric = new Map();
    let billingCostAvailable = true;
    try {
      billingByMetric = await billingMetrics(env, fetchImpl, cycle, now);
    } catch {
      billingCostAvailable = false;
    }
    const metrics = [
      usageMetric('d1_rows_read', 'D1 · Rows read', d1.rowsRead, CLOUDFLARE_USAGE_LIMITS.d1RowsRead, 'rows',
        '25 miljarder ingår per billingperiod. Därefter debiteras överförbrukning.', billingCostOrFallback('d1_rows_read', d1.rowsRead, billingByMetric.get('d1_rows_read'))),
      usageMetric('d1_rows_written', 'D1 · Rows written', d1.rowsWritten, CLOUDFLARE_USAGE_LIMITS.d1RowsWritten, 'rows',
        '50 miljoner ingår per billingperiod.', billingCostOrFallback('d1_rows_written', d1.rowsWritten, billingByMetric.get('d1_rows_written'))),
      usageMetric('d1_storage', 'D1 · Lagring', d1.storageBytes, CLOUDFLARE_USAGE_LIMITS.d1StorageBytes, 'bytes',
        '5 GB ingår. Lagring över den inkluderade nivån debiteras.', billingByMetric.get('d1_storage'))
    ];
    const r2Storage = billingByMetric.get('r2_storage');
    const r2ClassA = billingByMetric.get('r2_class_a');
    const r2ClassB = billingByMetric.get('r2_class_b');
    if (typeof d1.r2StorageBytes === 'number' && Number.isFinite(d1.r2StorageBytes) && d1.r2StorageBytes >= 0) {
      metrics.push({
        ...usageMetric('r2_storage', 'R2 · Lagring', d1.r2StorageBytes, CLOUDFLARE_USAGE_LIMITS.r2StorageBytes, 'bytes',
          'Baren visar aktuell lagrad mängd mot 10 GB. Kostnaden till höger kommer från Cloudflares billingperiod.', r2Storage),
        observedAt:d1.r2StorageObservedAt
      });
    }
    if (r2ClassA?.available === true && r2ClassA.quantityAvailable === true) {
      metrics.push(usageMetric('r2_class_a', 'R2 · Class A', r2ClassA.quantity, CLOUDFLARE_USAGE_LIMITS.r2ClassAOperations, 'requests',
        '1 miljon Class A-operationer ingår per månad.', r2ClassA));
    }
    if (r2ClassB?.available === true && r2ClassB.quantityAvailable === true) {
      metrics.push(usageMetric('r2_class_b', 'R2 · Class B', r2ClassB.quantity, CLOUDFLARE_USAGE_LIMITS.r2ClassBOperations, 'requests',
        '10 miljoner Class B-operationer ingår per månad.', r2ClassB));
    }
    return {
      configured: true,
      fetchedAt: nowIso(now),
      billingPeriod: cycle,
      metrics,
      queryInsights: d1.queryInsights,
      queryInsightsWindow: { start: cycle.start, end: nowIso(now) },
      additional: {
        billingCostAvailable,
        r2Available: Boolean(d1.r2StorageBytes != null || r2Storage?.available || r2ClassA?.available || r2ClassB?.available)
      },
      ...(options.includeDailyUsage ? { _dailyUsage:d1.dailyUsage } : {})
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
  const [automation, cloudflare, morningStageCosts] = await Promise.all([
    getAutomationControl(env),
    getCloudflareUsage(env, { ...options, includeDailyUsage:true }),
    recentMorningStageCosts(env)
  ]);
  let recentRunEstimates = {};
  if (cloudflare?.configured && cloudflare.available !== false && cloudflare.billingPeriod && Array.isArray(cloudflare._dailyUsage)) {
    recentRunEstimates = await estimateRecentRunD1Usage(env, cloudflare.billingPeriod, cloudflare._dailyUsage).catch(() => ({}));
  }
  if (cloudflare && Object.prototype.hasOwnProperty.call(cloudflare, '_dailyUsage')) delete cloudflare._dailyUsage;
  return {
    automation,
    cloudflare,
    recentRunEstimates,
    morningStageCosts,
    usageEstimateNote:'Beräknad fördelning av den dagens verifierade Cloudflare D1-usage mellan registrerade workflows. Detta är en uppskattning, inte exakt per-query-mätning.',
    schedule: {
      cron: '15 5 * * *',
      timeZone: 'Europe/Stockholm'
    }
  };
}
