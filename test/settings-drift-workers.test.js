import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getCloudflareUsage } from '../src/settings-drift.js';
import { evaluateWorkloadPressure } from '../src/morning-budget.js';

function ok(result) {
  return new Response(JSON.stringify({success:true,...result}),{
    status:200,headers:{'content-type':'application/json'}
  });
}
function mockAnalyticsFetch() {
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push(String(url));
    if(String(url).endsWith('/billable-usage/info')) {
      return ok({result:{subscriptions:[{
        billing_cycle_anchor_timestamp:'2026-11-01T00:00:00Z',
        start_timestamp:'2026-11-01T00:00:00Z'
      }]}});
    }
    if(String(url).includes('/billable-usage?')) return ok({result:[]});
    if(String(url).endsWith('/graphql')) {
      const payload=JSON.parse(options.body);
      if(payload.query.includes('TravdataR2Today')) {
        return ok({data:{viewer:{accounts:[{
          r2OperationsAdaptiveGroups:[{dimensions:{date:'2026-11-08',bucketName:'synthetic-r2',actionType:'ReadObject'},sum:{requests:350_000}}]
        }]}}});
      }
      if(payload.query.includes('TravdataWorkersUsage')) {
        assert.equal(payload.variables.accountTag,'synthetic-account');
        return ok({data:{viewer:{accounts:[{
          period:[{dimensions:{scriptName:'app-a'},sum:{requests:250_000,errors:2,cpuTimeUs:900_000_000}},
            {dimensions:{scriptName:'app-b'},sum:{requests:150_000,errors:0,cpuTimeUs:600_000_000}}],
          today:[{dimensions:{scriptName:'app-a'},sum:{requests:450_000,errors:0,cpuTimeUs:300_000_000}}]
        }]}}});
      }
      if(payload.query.includes('d1AnalyticsAdaptiveGroups')) {
        return ok({data:{viewer:{accounts:[{
          d1AnalyticsAdaptiveGroups:[{
            dimensions:{date:'2026-11-08',databaseId:'synthetic-db'},
            sum:{rowsRead:8_000_000,rowsWritten:9_000}
          }],
          d1StorageAdaptiveGroups:[{
            dimensions:{date:'2026-11-08',databaseId:'synthetic-db'},
            max:{databaseSizeBytes:4_000_000_000}
          }],
          r2StorageAdaptiveGroups:[]
        }]}}});
      }
      return ok({data:{viewer:{accounts:[{d1QueriesAdaptiveGroups:[]}]}}});
    }
    throw new Error('unexpected synthetic analytics endpoint');
  };
  return {fetchImpl,calls};
}

test('Drift can read account-wide Workers counts and CPU alongside D1 without exposing worker names',async()=>{
  const {env}=createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID='synthetic-account';
  env.CLOUDFLARE_USAGE_API_TOKEN='synthetic-analytics-token';
  const {fetchImpl,calls}=mockAnalyticsFetch();
  const usage=await getCloudflareUsage(env,{
    now:'2026-11-08T12:00:00.000Z',fetchImpl,
    includeWorkersUsage:true,includeR2DailyUsage:true,includeDailyUsage:true
  });
  const requests=usage.metrics.find(x=>x.id==='workers_requests');
  const cpu=usage.metrics.find(x=>x.id==='workers_cpu_ms');
  assert.equal(usage.configured,true);
  assert.equal(requests.used,400_000);
  assert.equal(cpu.used,1_500_000);
  assert.equal(requests.limit,10_000_000);
  assert.equal(cpu.limit,30_000_000);
  assert.equal(cpu.approximate,true);
  assert.equal(cpu.scope,'account');
  assert.equal(usage._dailyWorkersUsage.requests,450_000);
  assert.equal(usage._dailyWorkersUsage.cpuMs,300_000);
  assert.equal(usage.additional.workersAccountAvailable,true);
  assert.equal(usage.additional.workersCpuAvailable,true);
  assert.equal(usage.additional.r2DailyAvailable,true);
  assert.equal(usage._dailyR2Operations,350_000);
  assert.equal(calls.length,6);
  assert.doesNotMatch(JSON.stringify(usage),/app-a|app-b|synthetic-r2|synthetic-analytics-token/);
  const pressure=evaluateWorkloadPressure(usage,'2026-11-08T12:00:00Z');
  assert.equal(pressure.level,'high');
  assert.equal(pressure.allowExpansion,false);
  assert.equal(pressure.dailyWorkersTelemetryAvailable,true);
});

test('Optional Workers API failure retains D1 coverage and never invents a zero Workers bill',async()=>{
  const {env}=createTestEnv();
  env.CLOUDFLARE_ACCOUNT_ID='synthetic-account';
  env.CLOUDFLARE_USAGE_API_TOKEN='synthetic-analytics-token';
  const {fetchImpl}=mockAnalyticsFetch();
  const failWorkers=async(url,options)=>{
    if(String(url).endsWith('/graphql') &&
       JSON.parse(options.body).query.includes('TravdataWorkersUsage')) {
      throw new Error('optional Workers analytics unavailable');
    }
    return fetchImpl(url,options);
  };
  const usage=await getCloudflareUsage(env,{
    now:'2026-11-08T12:00:00.000Z',fetchImpl:failWorkers,includeWorkersUsage:true
  });
  assert.equal(usage.metrics.find(x=>x.id==='d1_rows_read').used,8_000_000);
  assert.equal(usage.metrics.some(x=>x.id==='workers_requests'),false);
  assert.equal(usage.additional.workersAccountAvailable,false);
});
