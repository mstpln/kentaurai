// GitHub Actions runner for a single private, resumable source-recovery run.
// It never prints source IDs, source facts, encrypted cursors, backup keys,
// capability tokens or private API error bodies.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const URL_BASE=process.env.WORKER_URL;
const TOKEN=process.env.CLEANUP_TOKEN;
const PHASE=process.env.RUNNER_PHASE;
const MODE=process.env.RECOVERY_MODE;
const RUN_ID=process.env.RECOVERY_RUN_ID||'';
const REPAIR_TOKEN=process.env.HISTORICAL_REPAIR_TOKEN||'';
const OUT=process.env.GITHUB_OUTPUT;
const MAX_STEPS=180;
const MAX_MS=5*60*1000;

function fail(message){throw new Error(message);}
function writeOutput(name,value){
  if(!OUT)fail('recovery_GITHUB_OUTPUT_missing');
  appendFileSync(OUT,name+'='+String(value)+'\n',{encoding:'utf8'});
}
function ensure(){
  if(!URL_BASE?.startsWith('https://') ||
    !/^[a-zA-Z0-9._-]+$/.test(new URL(URL_BASE).hostname) ||
    !TOKEN || !['initialize','backup','run'].includes(PHASE) ||
    !['inventory','backup','execute'].includes(MODE)) fail('recovery_runner_configuration_invalid');
}
async function call(path,method='GET',body=null){
  const controller=new AbortController();
  // Full, private D1 SQL export may take longer than ordinary status calls.
  // Keep a strict finite limit while allowing R2-to-R2 streaming to finish.
  const timeoutMs=PHASE==='backup' && path===base+'backup-poll' ? 180000 : 30000;
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(URL_BASE+path,{
      method,
      headers:{authorization:'Bearer '+TOKEN,
        ...(body==null?{}:{'content-type':'application/json'})},
      body:body==null?undefined:JSON.stringify(body),
      signal:controller.signal
    });
    if(!response.ok) fail('recovery_private_api_http_'+response.status);
    return await response.json();
  }finally{clearTimeout(timeout);}
}
const put=(path,body)=>call(path,'POST',body);
const base='/v1/storage-cleanup/restoration/run/';
function checkResponse(o){
  if(!o||o.mode!=='historical_provenance_recovery'||
    typeof o.phase!=='string'||typeof o.runId!=='string'||
    o.sourceIdsReturned!==false||o.rawFactsReturned!==false)
    fail('recovery_response_shape_invalid');
  return o;
}
function summarize(o,steps){
  const counts={
    phase:o.phase, steps, missing:o.originallyMissingRepresentations,
    verifiedCandidates:o.verifiedCandidateFacts,
    quarantined:o.quarantinedOrDeferredFacts,
    restored:o.restoredSourceFacts,
    remainingAfterAudit:o.postAuditRemainingMissing,
    excessAfterAudit:o.postAuditExcess
  };
  process.stdout.write(JSON.stringify(counts)+'\n');
}
async function main(){
  ensure();
  if(PHASE==='initialize'){
    if(RUN_ID && !/^[a-f0-9-]{36}$/.test(RUN_ID))fail('recovery_run_identifier_invalid');
    let report;
    if(RUN_ID) report=await call(base+'status?run_id='+encodeURIComponent(RUN_ID));
    else if(MODE==='execute'||MODE==='backup') report=await call(base+'status');
    else {
      try{ report=await call(base+'status'); }
      catch(error){
        if(error.message!=='recovery_private_api_http_409')throw error;
        report=await put(base+'start',{});
      }
    }
    report=checkResponse(report);
    if(MODE==='execute'&&!['ready','applying','verify_pending','complete','complete_with_quarantine'].includes(report.phase))
      fail('recovery_inventory_not_complete');
    if(MODE==='inventory'&&!['inventory','ready','paused'].includes(report.phase))
      fail('recovery_inventory_phase_conflict');
    if(MODE==='backup'&&report.phase!=='ready')
      fail('recovery_backup_inventory_not_ready');
    if(MODE==='execute'&&!report.backupVerified &&
      !['complete','complete_with_quarantine'].includes(report.phase))
      fail('recovery_execute_needs_separately_completed_backup');
    writeOutput('run_id',report.runId);
    writeOutput('phase',report.phase);
    writeOutput('backup_verified',report.backupVerified?'true':'false');
    summarize(report,0);
    return;
  }
  if(!RUN_ID)fail('recovery_run_identifier_required');
  if(PHASE==='backup'){
    if(MODE!=='backup')fail('recovery_backup_separate_approval_required');
    const deadline=Date.now()+4*60*1000;
    let report=checkResponse(await call(base+'status?run_id='+encodeURIComponent(RUN_ID)));
    if(report.backupVerified){
      writeOutput('backup_verified','true');
      writeOutput('continue','false');
      summarize(report,0);
      return;
    }
    const startedBackup=checkResponse(await put(base+'backup-start',{run_id:RUN_ID}));
    report=startedBackup;
    let polls=0;
    while(!report.backupVerified&&Date.now()<deadline&&polls<36){
      report=checkResponse(await put(base+'backup-poll',{run_id:RUN_ID}));
      polls++;
      if(!report.backupVerified)await new Promise(resolve=>setTimeout(resolve,4000));
    }
    writeOutput('backup_verified',report.backupVerified?'true':'false');
    writeOutput('continue',report.backupVerified?'false':'true');
    summarize(report,polls);
    return;
  }
  if(MODE==='backup')fail('recovery_backup_cannot_run_restore_steps');
  const started=Date.now();
  let steps=0;
  let totalD1RowsRead=0;
  let totalR2Bytes=0;
  let report=checkResponse(await call(base+'status?run_id='+encodeURIComponent(RUN_ID)));
  if(MODE==='execute'&&!REPAIR_TOKEN&&!['complete','complete_with_quarantine'].includes(report.phase))
    fail('recovery_execute_secret_missing');
  while(steps<MAX_STEPS&&Date.now()-started<MAX_MS){
    if(['paused','failed'].includes(report.phase))fail('recovery_run_paused_or_failed');
    if(MODE==='inventory'){
      if(report.phase==='ready')break;
      if(report.phase!=='inventory')fail('recovery_run_not_inventory');
      report=checkResponse(await put(base+'scan-step',{run_id:RUN_ID}));
    }else{
      if(['complete','complete_with_quarantine'].includes(report.phase))break;
      if(['ready','applying'].includes(report.phase)){
        report=checkResponse(await put(base+'apply-step',{
          run_id:RUN_ID,approved:true,authorization:REPAIR_TOKEN
        }));
      }else if(report.phase==='verify_pending'){
        report=checkResponse(await put(base+'post-audit-step',{run_id:RUN_ID}));
      }else fail('recovery_run_not_approved_for_execute');
    }
    steps++;
    const cost=report.budget||{};
    const rows=Number(cost.rowsRead||0);
    const bytes=Number(cost.r2BytesRead||0);
    if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(bytes)||bytes<0)
      fail('recovery_invalid_query_cost_receipt');
    totalD1RowsRead+=rows;
    totalR2Bytes+=bytes;
    if(totalD1RowsRead>1000000||totalR2Bytes>33554432)
      fail('recovery_cumulative_safety_budget_exceeded');
    if(steps%30===0) summarize(report,steps);
    // Reserve at least 25% of the cumulative budget for a safe stop.
    if(totalD1RowsRead>=750000 || totalR2Bytes>=25165824)break;
  }
  report=checkResponse(await call(base+'status?run_id='+encodeURIComponent(RUN_ID)));
  const done=MODE==='inventory'?report.phase==='ready':
    ['complete','complete_with_quarantine'].includes(report.phase);
  writeOutput('run_id',report.runId);
  writeOutput('phase',report.phase);
  writeOutput('continue',done?'false':'true');
  summarize(report,steps);
}
main().catch(error=>{
  process.stderr.write('Historical source recovery safely stopped: '+
    String(error.message).slice(0,90)+'\n');
  process.exitCode=1;
});
