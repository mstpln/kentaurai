import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkersAccountUsage,
  WORKERS_ACCOUNT_ANALYTICS_QUERY
} from '../src/cloudflare-workers-usage.js';

const options = {
  accountId:'synthetic-account',
  periodStart:'2026-11-01T00:00:00Z',
  dayStart:'2026-11-08T00:00:00Z',
  end:'2026-11-08T05:15:00Z'
};
const group = (requests, errors, cpuTimeUs) => ({
  dimensions:{scriptName:'synthetic-script'},
  sum:{requests,errors,...(cpuTimeUs==null?{}:{cpuTimeUs})}
});
const response = (period, today) => ({
  data:{viewer:{accounts:[{period,today}]}}
});

test('Workers account metrics are cumulative across scripts, with CPU converted from microseconds',async()=>{
  let calls=0;
  const result=await loadWorkersAccountUsage(async(query,variables)=>{
    calls++;
    assert.match(query,/workersInvocationsAdaptive/);
    assert.match(query,/cpuTimeUs/);
    assert.equal(variables.accountTag,options.accountId);
    assert.equal(variables.dayStart,'2026-11-08T00:00:00.000Z');
    return response([group(90,2,250_000),group(60,0,150_000)],[group(12,0,42_000)]);
  },options);
  assert.equal(calls,1);
  assert.equal(result.accountWide,true);
  assert.equal(result.approximate,true);
  assert.equal(result.period.requests,150);
  assert.equal(result.period.cpuMs,400);
  assert.equal(result.period.errors,2);
  assert.equal(result.today.requests,12);
  assert.equal(result.today.cpuMs,42);
});

test('missing cumulative CPU field never converts percentiles into made-up totals',async()=>{
  let calls=0;
  const result=await loadWorkersAccountUsage(async(query)=>{
    calls++;
    if(query.includes('cpuTimeUs'))throw new Error('Cannot query field "cpuTimeUs"');
    return response([group(123,0)],[group(20,1)]);
  },options);
  assert.equal(calls,2);
  assert.equal(result.period.requests,123);
  assert.equal(result.period.cpuMs,null);
  assert.equal(result.today.cpuMs,null);
});

test('missing, malformed and truncated Workers analytics cannot be interpreted as zero',async()=>{
  await assert.rejects(
    loadWorkersAccountUsage(async()=>({data:{viewer:{accounts:[]}}}),options),
    /unavailable/
  );
  await assert.rejects(
    loadWorkersAccountUsage(async()=>response([group(null,0,1)],[group(0,0,0)]),options),
    /incomplete/
  );
  await assert.rejects(
    loadWorkersAccountUsage(async()=>response(Array.from({length:1000},()=>group(1,0,1000)),[]),options),
    /incomplete/
  );
});

test('Workers metrics have an explicit account scope and bounded GraphQL periods',()=>{
  assert.match(WORKERS_ACCOUNT_ANALYTICS_QUERY,/accounts\(filter: \{ accountTag: \$accountTag \}\)/);
  assert.match(WORKERS_ACCOUNT_ANALYTICS_QUERY,/datetime_geq: \$periodStart/);
  assert.match(WORKERS_ACCOUNT_ANALYTICS_QUERY,/datetime_geq: \$dayStart/);
  assert.match(WORKERS_ACCOUNT_ANALYTICS_QUERY,/datetime_leq: \$end/);
  assert.match(WORKERS_ACCOUNT_ANALYTICS_QUERY,/limit: 1000/);
  assert.doesNotMatch(WORKERS_ACCOUNT_ANALYTICS_QUERY,/source_records|editorial|race_entry/);
});
