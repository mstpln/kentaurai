import test from 'node:test';
import assert from 'node:assert/strict';
import { ESSENTIAL_MORNING_STAGES, summarizeMorningWorkflow } from '../src/workflow-health.js';

const now='2026-11-08T17:00:00.000Z';
const allParts=ESSENTIAL_MORNING_STAGES.map(name=>({name,ok:true,skipped:false,cost:{rowsRead:100}}));
const run=(stages,status='success',startedAt='2026-11-08T05:15:00.000Z')=>({
  stages,status,startedAt,finishedAt:'2026-11-08T05:19:00.000Z'
});
test('morning status requires all six current-data stages regardless of overall import_runs success',()=>{
  const healthy=summarizeMorningWorkflow(run(allParts),now);
  assert.equal(healthy.status,'healthy');
  assert.equal(healthy.coverageComplete,true);
  assert.equal(healthy.complete,6);
  assert.deepEqual(healthy.missing,[]);
  const withoutXlabs=summarizeMorningWorkflow(run(allParts.slice(0,-1)),now);
  assert.equal(withoutXlabs.status,'partial');
  assert.deepEqual(withoutXlabs.missing,['xlabs_daily_incremental']);
  assert.equal(withoutXlabs.coverageComplete,false);
});
test('failed or explicitly skipped essential stage is not represented as healthy',()=>{
  const failed=summarizeMorningWorkflow(run(allParts.map(s=>s.name==='official_daily_incremental'?{...s,ok:false}:s),'failed'),now);
  assert.equal(failed.status,'failed');
  assert.deepEqual(failed.failed,['official_daily_incremental']);
  const skipped=summarizeMorningWorkflow(run(allParts.map(s=>s.name==='live_capture_morning'?{...s,skipped:true}:s)),now);
  assert.equal(skipped.status,'partial');
  assert.deepEqual(skipped.skipped,['live_capture_morning']);
});
test('completed stages become stale after 36 hours, without changing historical execution facts',()=>{
  const stale=summarizeMorningWorkflow(run(allParts,'success','2026-11-06T05:15:00Z'),now);
  assert.equal(stale.status,'stale');
  assert.equal(stale.coverageComplete,true);
  assert.equal(stale.stale,true);
  assert.equal(summarizeMorningWorkflow(null,now).status,'never_run');
});
