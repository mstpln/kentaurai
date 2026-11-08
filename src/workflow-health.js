/**
 * Interpret the recorded morning orchestration result without looking up
 * racing facts or adding read load. A successful import_runs row is not enough:
 * all essential stages must have been attempted and completed successfully.
 */
export const ESSENTIAL_MORNING_STAGES = Object.freeze([
  'live_capture_morning',
  'live_normalize_morning',
  'official_daily_incremental',
  'post_race_settlement',
  'manual_system_settlement',
  'xlabs_daily_incremental'
]);

export function summarizeMorningWorkflow(latestRun, nowValue = Date.now()) {
  if (!latestRun) {
    return {status:'never_run',lastRunAt:null,required:ESSENTIAL_MORNING_STAGES.length,
      complete:0,missing:ESSENTIAL_MORNING_STAGES.slice(),skipped:[],failed:[],
      stale:false};
  }
  const stages = new Map((latestRun.stages || []).map(s=>[s.name,s]));
  const missing=[], skipped=[], failed=[];
  let complete=0;
  for (const name of ESSENTIAL_MORNING_STAGES) {
    const part=stages.get(name);
    if (!part) missing.push(name);
    else if (part.skipped) skipped.push(name);
    else if (part.ok === false) failed.push(name);
    else complete++;
  }
  const timestamp=Date.parse(latestRun.startedAt || latestRun.finishedAt || '');
  const at=Number(nowValue instanceof Date ? nowValue.getTime() : new Date(nowValue).getTime());
  const stale=Number.isFinite(timestamp) && Number.isFinite(at) &&
    at - timestamp > 36*60*60*1000;
  const failedRun=latestRun.status === 'failed' || failed.length > 0;
  const status=failedRun?'failed':missing.length || skipped.length?'partial':
    stale?'stale':'healthy';
  return {
    status, lastRunAt:latestRun.startedAt||latestRun.finishedAt||null,
    required:ESSENTIAL_MORNING_STAGES.length,complete,missing,skipped,failed,
    stale, coverageComplete:!failedRun&&!missing.length&&!skipped.length
  };
}
