const AUTOMATION_KEY = 'automatic_workflows_enabled';

export const CLOUDFLARE_USAGE_LIMITS = Object.freeze({
  d1RowsRead: 25_000_000_000,
  d1RowsWritten: 50_000_000,
  d1StorageBytes: 5_000_000_000
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
  if (!row) {
    return { enabled: true, updatedAt: null, updatedBy: 'default' };
  }
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
  const active = subscriptions.find((item) => !item.end_timestamp) || subscriptions[0] || null;
  const anchor = active?.billing_cycle_anchor_timestamp || active?.start_timestamp || null;
  const cycle = anchor ? billingCycleFromAnchor(anchor, now) : null;
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

function sumMetric(groups, key) {
  return (groups || []).reduce((sum, group) => sum + Math.max(0, Number(group?.sum?.[key] || 0)), 0);
}

function currentD1Storage(groups) {
  const latestByDatabase = new Map();
  for (const group of groups || []) {
    const databaseId = String(group?.dimensions?.databaseId || '');
    const date = String(group?.dimensions?.date || '');
    if (!databaseId || !date || latestByDatabase.has(databaseId)) continue;
    latestByDatabase.set(databaseId, Math.max(0, Number(group?.max?.databaseSizeBytes || 0)));
  }
  return [...latestByDatabase.values()].reduce((sum, value) => sum + value, 0);
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
  return {
    rowsRead: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsRead'),
    rowsWritten: sumMetric(account.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
    storageBytes: currentD1Storage(account.d1StorageAdaptiveGroups)
  };
}

function usageMetric(id, label, used, limit, unit, rule) {
  const numeric = Math.max(0, Number(used || 0));
  return {
    id,
    label,
    used: numeric,
    limit,
    unit,
    percent: limit > 0 ? (numeric / limit) * 100 : null,
    overLimit: limit > 0 ? numeric > limit : false,
    rule
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
    return {
      configured: true,
      fetchedAt: nowIso(now),
      billingPeriod: cycle,
      metrics: [
        usageMetric('d1_rows_read', 'D1 · Rows read', d1.rowsRead, CLOUDFLARE_USAGE_LIMITS.d1RowsRead, 'rows',
          '25 miljarder ingår per billingperiod. Därefter debiteras överförbrukning.'),
        usageMetric('d1_rows_written', 'D1 · Rows written', d1.rowsWritten, CLOUDFLARE_USAGE_LIMITS.d1RowsWritten, 'rows',
          '50 miljoner ingår per billingperiod.'),
        usageMetric('d1_storage', 'D1 · Lagring', d1.storageBytes, CLOUDFLARE_USAGE_LIMITS.d1StorageBytes, 'bytes',
          '5 GB ingår. Lagring över den inkluderade nivån debiteras.')
      ],
      additional: {
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
      localLabel: '07:15',
      timeZone: 'Europe/Stockholm'
    }
  };
}
