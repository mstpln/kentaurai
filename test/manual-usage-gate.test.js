import test from 'node:test';
import assert from 'node:assert/strict';
import { isBudgetedExpansion, manualExpansionBudgetDecision } from '../src/manual-usage-gate.js';

test('only optional historical expansion and repair routes are usage-gated',()=>{
  for(const path of [
    '/v1/historical/backfill/step','/v1/xlabs/backfill/step',
    '/v1/statistics/backfill/step','/v1/xlabs/interval-repair',
    '/v1/xlabs/position-reconstruction/step'
  ])assert.equal(isBudgetedExpansion(path),true,path);
  for(const path of [
    '/v1/live/capture','/v1/live/normalize-next','/v1/provider/capture',
    '/v1/post-race/settlement','/v1/storage-cleanup/restoration/run/status',
    '/app/api/travdata/personal','/v1/storage-cleanup/restoration/run/backup-start'
  ])assert.equal(isBudgetedExpansion(path),false,path);
});

test('optional expansion fails closed when verified account analytics are missing',async()=>{
  const decision=await manualExpansionBudgetDecision({WORKLOAD_GUARD_ENABLED:'1'});
  assert.equal(decision.allowed,false);
  assert.equal(decision.level,'unknown');
  assert.equal(decision.reason,'usage_unavailable');
});

test('preview is isolated and guard remains an explicit production config',async()=>{
  assert.equal((await manualExpansionBudgetDecision({WORKLOAD_GUARD_ENABLED:'0'})).allowed,true);
  assert.equal((await manualExpansionBudgetDecision({WORKLOAD_GUARD_ENABLED:'1',PREVIEW_DATA_MODE:'synthetic'})).allowed,true);
});
