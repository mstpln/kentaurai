import { getCloudflareUsage } from './settings-drift.js';
import { evaluateWorkloadPressure } from './morning-budget.js';

// Only expansion/repair endpoints. Never gate current start lists, results,
// daily X-Labs, personal note writes, or read-only private diagnostics.
const PATHS=new Set([
  '/v1/historical/backfill/step',
  '/v1/xlabs/backfill/step',
  '/v1/statistics/backfill/step',
  '/v1/xlabs/interval-repair',
  '/v1/xlabs/position-reconstruction/step'
]);

export function isBudgetedExpansion(path) {
  return PATHS.has(String(path));
}
export async function manualExpansionBudgetDecision(env, options={}) {
  if (env?.PREVIEW_DATA_MODE === 'synthetic' || String(env?.WORKLOAD_GUARD_ENABLED||'') !== '1') {
    return { allowed:true, reason:'guard_not_enabled',level:'disabled' };
  }
  const now=options.now||Date.now();
  const usage=await getCloudflareUsage(env,{
    now:new Date(now), includeDailyUsage:true, includeWorkersUsage:true, includeR2DailyUsage:true, ...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})
  }).catch(()=>({available:false,metrics:[]}));
  const pressure=evaluateWorkloadPressure(usage,now);
  if (!pressure.allowExpansion) {
    return { allowed:false, level:pressure.level,
      reason:pressure.reason || 'verified_usage_headroom_unavailable' };
  }
  return { allowed:true,level:pressure.level,reason:null };
}
