/**
 * Read-only Cloudflare Workers invocation analytics for the full account.
 *
 * workersInvocationsAdaptive can be sampled and can lag billing. Values
 * are observations, not hard spending limits or invoice quantities.
 * Do not log individual script names or token contents.
 */
export const WORKERS_ACCOUNT_ANALYTICS_QUERY = `query TravdataWorkersUsage(
  $accountTag: string!,
  $periodStart: Time!,
  $dayStart: Time!,
  $end: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      period: workersInvocationsAdaptive(
        limit: 1000,
        orderBy: [sum_requests_DESC],
        filter: { datetime_geq: $periodStart, datetime_leq: $end }
      ) {
        dimensions { scriptName }
        sum { requests errors cpuTimeUs }
      }
      today: workersInvocationsAdaptive(
        limit: 1000,
        orderBy: [sum_requests_DESC],
        filter: { datetime_geq: $dayStart, datetime_leq: $end }
      ) {
        dimensions { scriptName }
        sum { requests errors cpuTimeUs }
      }
    }
  }
}`;

const WITHOUT_CPU = WORKERS_ACCOUNT_ANALYTICS_QUERY.replaceAll(
  'requests errors cpuTimeUs', 'requests errors'
);
const MAX_GROUPS = 1000;

function validNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function aggregate(rows, withCpu) {
  if (!Array.isArray(rows) || rows.length >= MAX_GROUPS) {
    return null; // A potentially truncated result is unknown, not a valid total.
  }
  let requests = 0;
  let errors = 0;
  let cpuTimeUs = 0;
  let cpuAvailable = withCpu;
  for (const group of rows) {
    if (!validNonNegative(group?.sum?.requests) ||
        !validNonNegative(group?.sum?.errors)) return null;
    requests += group.sum.requests;
    errors += group.sum.errors;
    if (!validNonNegative(group?.sum?.cpuTimeUs)) cpuAvailable = false;
    else cpuTimeUs += group.sum.cpuTimeUs;
  }
  if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(errors)) return null;
  return {
    requests, errors,
    cpuMs:cpuAvailable ? cpuTimeUs / 1000 : null,
    scriptGroups:rows.length
  };
}

/**
 * @param {function(string, object): Promise<object>} runGraphql
 * @param {{accountId:string, periodStart:string, dayStart:string, end:string}} options
 */
export async function loadWorkersAccountUsage(runGraphql, options) {
  const variables = {
    accountTag:options.accountId,
    periodStart:new Date(options.periodStart).toISOString(),
    dayStart:new Date(options.dayStart).toISOString(),
    end:new Date(options.end).toISOString()
  };
  let data;
  let withCpu = true;
  try {
    data = await runGraphql(WORKERS_ACCOUNT_ANALYTICS_QUERY, variables);
  } catch (error) {
    // Keep request metrics if the account schema lacks cumulative CPU.
    // Never infer CPU from p50/p99 quantiles.
    if (!/cpuTimeUs/i.test(String(error?.message || error))) throw error;
    withCpu = false;
    data = await runGraphql(WITHOUT_CPU, variables);
  }

  const accounts = data?.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error('Cloudflare Workers account analytics unavailable');
  }
  const period = aggregate(accounts[0]?.period, withCpu);
  const today = aggregate(accounts[0]?.today, withCpu);
  if (!period || !today) throw new Error('Cloudflare Workers analytics incomplete');
  return {
    available:true, source:'cloudflare_workers_graphql_adaptive',
    approximate:true, accountWide:true, period, today
  };
}
