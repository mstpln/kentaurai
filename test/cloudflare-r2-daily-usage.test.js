import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R2_DAILY_OPERATIONS_QUERY, loadAccountR2DailyOperations
} from '../src/cloudflare-r2-daily-usage.js';
import { evaluateWorkloadPressure } from '../src/morning-budget.js';

const now='2026-11-08T05:15:00.000Z';
const synthetic = (ops)=>({
  data:{viewer:{accounts:[{r2OperationsAdaptiveGroups:ops.map(requests=>({
    dimensions:{date:'2026-11-08',bucketName:'synthetic',actionType:'ReadObject'},
    sum:{requests}
  }))}]}}
});

test('account-wide current-day R2 operation count is advisory, not fabricated Class A/B',async()=>{
  const result=await loadAccountR2DailyOperations(async(query,vars)=>{
    assert.match(query,/r2OperationsAdaptiveGroups/);
    assert.equal(vars.day,'2026-11-08');
    assert.equal(vars.accountTag,'synthetic-account');
    return synthetic([200_000,125_000]);
  },{accountId:'synthetic-account',date:now});
  assert.equal(result.operations,325_000);
  assert.equal(result.accountWide,true);
  assert.equal(result.approximate,true);
  assert.equal(result.day,'2026-11-08');
  assert.equal('classA' in result,false);
  assert.equal('classB' in result,false);
  const usage={
    metrics:[{id:'d1_rows_read',used:10_000},{id:'d1_rows_written',used:200}],
    _dailyUsage:[{date:'2026-11-08',rowsRead:10000,rowsWritten:200}],
    _dailyR2Operations:result.operations
  };
  assert.equal(evaluateWorkloadPressure(usage,now).level,'elevated');
  usage._dailyR2Operations=650_000;
  assert.equal(evaluateWorkloadPressure(usage,now).level,'high');
});

test('unknown R2 operation quantities, error, or truncated aggregation do not become zero',async()=>{
  await assert.rejects(
    loadAccountR2DailyOperations(async()=>({data:{viewer:{accounts:[]}}}),{accountId:'a',date:now}),
    /incomplete/
  );
  await assert.rejects(
    loadAccountR2DailyOperations(async()=>synthetic([-1]),{accountId:'a',date:now}),
    /unavailable/
  );
  await assert.rejects(
    loadAccountR2DailyOperations(async()=>synthetic(Array(1000).fill(1)),{accountId:'a',date:now}),
    /incomplete/
  );
});

test('R2 operations source is date-bounded, read-only and intentionally unclassified',()=>{
  assert.match(R2_DAILY_OPERATIONS_QUERY,/date_geq: \$day, date_leq: \$day/);
  assert.match(R2_DAILY_OPERATIONS_QUERY,/sum \{ requests \}/);
  assert.doesNotMatch(R2_DAILY_OPERATIONS_QUERY,/classA|classB|UPDATE|DELETE/);
});
