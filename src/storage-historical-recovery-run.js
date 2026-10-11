// Durable private historical source-provenance inventory and guarded restore.
// Source IDs, snapshot IDs and raw facts live only in private D1/R2. HTTP
// responses contain aggregate counters, never private identities or payloads.
import { planInternalHistoricalRestoration } from './storage-historical-recovery-page.js';
import { applyVerifiedHistoricalRestoration } from './storage-historical-provenance-restoration.js';

const FAMILIES = Object.freeze(['horse_profile','horse_stat','horse_record','person_stat']);
const TABLES = Object.freeze({
  horse_profile: ['horse_profile_snapshots','horse_profile_count'],
  horse_stat: ['horse_stat_snapshots','horse_stat_count'],
  horse_record: ['horse_record_snapshots','horse_record_count'],
  person_stat: ['person_stat_snapshots','person_stat_count']
});
const BACKUP_PREFIX = 'backups/historical-recovery/';
const MAX_VERIFY_PAGE = 25;
const MAX_APPLY_PAGE = 4;
const D1_READ_LIMIT = 250000;

function validSha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function validHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function nonnegative(value) { const n=Number(value); return Number.isSafeInteger(n) && n>=0?n:null; }
function requireEnv(env) {
  if (!env?.DB?.prepare || !env?.DB?.batch || !env?.RAW_BUCKET?.head) {
    throw new Error('recovery_private_bindings_unavailable');
  }
  if (!validSha(env.KENTAURAI_DEPLOY_SHA)) throw new Error('recovery_deployed_sha_missing');
}
async function first(env,query,...bind) {
  return env.DB.prepare(query).bind(...bind).first();
}
async function allBounded(env,query,...bind) {
  const response = await env.DB.prepare(query).bind(...bind).all();
  if (!response?.success && response?.success !== undefined) throw new Error('recovery_query_failed');
  const rows = nonnegative(response?.meta?.rows_read);
  if (rows === null || rows > D1_READ_LIMIT) throw new Error('recovery_query_budget_exceeded');
  return response.results || [];
}
async function epoch(env) {
  const row = await first(env,'SELECT revision FROM historical_recovery_epoch WHERE singleton=1');
  const value = nonnegative(row?.revision);
  if (value === null) throw new Error('recovery_epoch_unavailable');
  return value;
}
async function loadRun(env,id) {
  if (!validId(id)) throw new Error('recovery_run_id_invalid');
  const row = await first(env,'SELECT * FROM historical_recovery_runs WHERE id=?',id);
  if (!row) throw new Error('recovery_run_not_found');
  if (row.source_sha !== env.KENTAURAI_DEPLOY_SHA) {
    throw new Error('recovery_run_deployment_changed');
  }
  return row;
}
function totals(run) {
  return {
    mode:'historical_provenance_recovery',
    runId:run.id, phase:run.phase, familyIndex:Number(run.family_index),
    scannedDeficientSources:Number(run.scanned_sources),
    deficientSources:Number(run.deficient_sources),
    originallyMissingRepresentations:Number(run.missing_count),
    verifiedCandidateFacts:Number(run.ready_count),
    quarantinedOrDeferredFacts:Number(run.quarantined_count),
    restoredSourceFacts:Number(run.restored_count),
    postAuditRemainingMissing:Number(run.post_remaining_missing),
    postAuditExcess:Number(run.post_excess),
    scanDriftDetected:run.scan_drift===1,
    backupVerified:Boolean(run.backup_key && run.backup_sha256),
    sourceIdsReturned:false, rawFactsReturned:false
  };
}
function sourceCountSql(family) {
  const [table] = TABLES[family];
  if (!table) throw new Error('recovery_invalid_family');
  return '(' +
    '(SELECT COUNT(*) FROM '+table+' direct INDEXED BY idx_'+table+
      '_source_record WHERE direct.source_record_id=sync.source_record_id)' +
    ' + (SELECT COUNT(*) FROM official_snapshot_observations obs' +
      ' INDEXED BY sqlite_autoindex_official_snapshot_observations_1' +
      ' WHERE obs.source_record_id=sync.source_record_id AND obs.snapshot_family=?' +
      ' AND NOT EXISTS(SELECT 1 FROM '+table+' same_source' +
      ' WHERE same_source.id=obs.snapshot_id AND same_source.source_record_id=obs.source_record_id))' +
    ')';
}
function selector(family, deficitsOnly, limit) {
  const [, count] = TABLES[family];
  if (!count) throw new Error('recovery_invalid_family');
  const represented = sourceCountSql(family);
  return [
    'SELECT sync.source_record_id, sync.'+count+' AS expected_count,',
      represented+' AS actual_count, sr.content_hash',
    'FROM official_snapshot_source_sync sync',
      'INDEXED BY idx_official_snapshot_source_sync_status_source',
    'JOIN source_records sr ON sr.id=sync.source_record_id',
    "WHERE sync.status='complete' AND sr.source_type='official_provider'",
      'AND sync.source_record_id>?',
    deficitsOnly ? 'AND sync.'+count+'>'+represented : '',
    'ORDER BY sync.source_record_id LIMIT '+limit
  ].join(' ');
}
async function markPaused(env,runId) {
  await env.DB.prepare(
    "UPDATE historical_recovery_runs SET phase='paused',scan_drift=1,updated_at=CURRENT_TIMESTAMP" +
    " WHERE id=? AND phase IN ('inventory','ready','applying','verify_pending')"
  ).bind(runId).run();
}
function verifyEpoch(run, currentEpoch) {
  if (Number(run.expected_epoch)!==currentEpoch) throw new Error('recovery_epoch_changed');
}
export async function startHistoricalRecoveryRun(env) {
  requireEnv(env);
  const revision=await epoch(env);
  const id=crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO historical_recovery_runs(id,source_sha,expected_epoch,started_epoch)' +
    " VALUES (?,?,?,?)"
  ).bind(id,env.KENTAURAI_DEPLOY_SHA,revision,revision).run();
  return totals(await loadRun(env,id));
}
export async function historicalRecoveryStatus(env,{runId}={}) {
  requireEnv(env);
  return totals(await loadRun(env,runId));
}
export async function stepHistoricalRecoveryInventory(env,{runId}={}) {
  requireEnv(env);
  const run=await loadRun(env,runId);
  if(run.phase!=='inventory') return totals(run);
  const current=await epoch(env);
  if(current!==Number(run.expected_epoch)){
    await markPaused(env,run.id);
    throw new Error('recovery_inventory_mutated_restart_required');
  }
  const index=Number(run.family_index);
  if(index>=FAMILIES.length)throw new Error('recovery_inventory_cursor_invalid');
  const family=FAMILIES[index];
  const rows=await allBounded(env,selector(family,true,1),
    family,run.after_source_id, family);
  if(!rows.length){
    const finalEpoch=await epoch(env);
    verifyEpoch(run,finalEpoch);
    const last=index===FAMILIES.length-1;
    const result=await env.DB.prepare(
      'UPDATE historical_recovery_runs SET family_index=family_index+1,' +
      " after_source_id='',phase=?,updated_at=CURRENT_TIMESTAMP" +
      " WHERE id=? AND phase='inventory' AND family_index=? AND expected_epoch=?" +
      ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
    ).bind(last?'ready':'inventory',run.id,index,current,current).run();
    if(Number(result.meta?.changes)!==1)throw new Error('recovery_checkpoint_conflict');
    return {...totals(await loadRun(env,run.id)),pageFamily:family,pageDone:true};
  }
  const item=rows[0];
  const { candidates,report,discardedCandidates }=await planInternalHistoricalRestoration(
    env,family,null,item.source_record_id
  );
  if(!report.liveSourceReverified||report.liveRevision!==current ||
      report.sourcesExamined!==1||report.ledgerShortfall<=0||
      !report.revisionCounterMatchesProof || report.budget?.rowsWritten!==0||
      candidates.length>24)throw new Error('recovery_source_proof_incomplete');
  const shortfall=Number(report.ledgerShortfall);
  const ready=report.auditLedgerVerified && report.originalVerified===1
    ? candidates.length:0;
  const quarantined=Math.max(0,shortfall-ready);
  const finalEpoch=await epoch(env);
  verifyEpoch(run,finalEpoch);
  const stored=await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO historical_recovery_receipts' +
      '(run_id,family,source_record_id,status,missing_count,candidate_count,' +
      'source_hash,checked_epoch) SELECT ?,?,?,?,?,?,?,?' +
      ' WHERE EXISTS(SELECT 1 FROM historical_recovery_runs r' +
      " WHERE r.id=? AND r.phase='inventory' AND r.family_index=?" +
      ' AND r.after_source_id=? AND r.expected_epoch=?)' +
      ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
    ).bind(run.id,family,item.source_record_id,
      ready?'ready':'quarantined',shortfall,ready,
      String(item.content_hash||''),current,
      run.id,index,run.after_source_id,current,current),
    env.DB.prepare(
      'UPDATE historical_recovery_runs SET after_source_id=?,scanned_sources=scanned_sources+1,' +
      'deficient_sources=deficient_sources+1,missing_count=missing_count+?,' +
      'ready_count=ready_count+?,quarantined_count=quarantined_count+?,' +
      "updated_at=CURRENT_TIMESTAMP WHERE id=? AND phase='inventory' AND changes()=1"
    ).bind(item.source_record_id,shortfall,ready,quarantined,run.id)
  ]);
  if(Number(stored[0]?.meta?.changes)!==1 ||
      Number(stored[1]?.meta?.changes)!==1)throw new Error('recovery_checkpoint_conflict');
  return {
    ...totals(await loadRun(env,run.id)), pageFamily:family,
    pageDeficit:shortfall,pageVerified:ready,pageQuarantined:quarantined,
    examinedOlderOriginals:report.predecessorHints?.earlierOriginalVerifiedSources??0,
    dismissedContradictoryCandidates:discardedCandidates,
    budget:report.budget
  };
}
async function verifiedBackup(env,run) {
  const key=run.backup_key;
  if(typeof key!=='string'||!key.startsWith(BACKUP_PREFIX) ||
    key.includes('..') || !/^[a-zA-Z0-9_./-]+$/.test(key) ||
    !validHash(run.backup_sha256) ||
    !key.includes('/'+run.id+'/') || !key.endsWith('/'+run.backup_sha256+'.sql') ||
    !Number.isSafeInteger(Number(run.backup_size)) || Number(run.backup_size)<1024) {
    throw new Error('recovery_backup_not_verified');
  }
  const head=await env.RAW_BUCKET.head(key);
  if(!head || Number(head.size)!==Number(run.backup_size))
    throw new Error('recovery_backup_missing_or_changed');
}
export async function attachHistoricalRecoveryBackup(env,{
  runId, key, sha256, size
}={}) {
  requireEnv(env);
  const run=await loadRun(env,runId);
  if(run.phase!=='ready'||run.scan_drift===1)throw new Error('recovery_not_ready_for_backup');
  verifyEpoch(run,await epoch(env));
  if(!validHash(sha256)||!nonnegative(size)||size<1024||
    typeof key!=='string'||key!==BACKUP_PREFIX+run.id+'/'+sha256+'.sql'){
    throw new Error('recovery_backup_invalid');
  }
  const head=await env.RAW_BUCKET.head(key);
  if(!head||Number(head.size)!==size)throw new Error('recovery_backup_missing_or_changed');
  const result=await env.DB.prepare(
    'UPDATE historical_recovery_runs SET backup_key=?,backup_sha256=?,backup_size=?,'+
    "updated_at=CURRENT_TIMESTAMP WHERE id=? AND phase='ready' AND expected_epoch=?" +
    ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
  ).bind(key,sha256,size,run.id,run.expected_epoch,run.expected_epoch).run();
  if(Number(result.meta?.changes)!==1)throw new Error('recovery_backup_attach_conflict');
  return {...totals(await loadRun(env,run.id)),backupVerified:true};
}
function requireRepairPermission(env,{approved,authorization}) {
  if(approved!==true || env.HISTORICAL_REPAIR_ENABLED!=='true' ||
    typeof env.HISTORICAL_REPAIR_TOKEN!=='string' ||
    env.HISTORICAL_REPAIR_TOKEN.length<32 ||
    authorization!==env.HISTORICAL_REPAIR_TOKEN) {
    throw new Error('historical_restoration_not_authorized');
  }
}
async function readyReceipt(env,runId){
  return first(env,
    "SELECT * FROM historical_recovery_receipts WHERE run_id=? AND status='ready'"+
    ' ORDER BY family,source_record_id LIMIT 1',runId);
}
export async function stepHistoricalRecoveryExecution(env,{
  runId,approved=false,authorization=null
}={}) {
  requireEnv(env);
  requireRepairPermission(env,{approved,authorization});
  let run=await loadRun(env,runId);
  if(!['ready','applying'].includes(run.phase))throw new Error('recovery_run_not_applicable');
  await verifiedBackup(env,run);
  const current=await epoch(env);
  if(current!==Number(run.expected_epoch)){
    await markPaused(env,run.id);
    throw new Error('recovery_external_mutation_paused');
  }
  if(run.phase==='ready'){
    const transition=await env.DB.prepare(
      "UPDATE historical_recovery_runs SET phase='applying',updated_at=CURRENT_TIMESTAMP"+
      " WHERE id=? AND phase='ready' AND expected_epoch=?"+
      ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
    ).bind(run.id,current,current).run();
    if(Number(transition.meta?.changes)!==1)throw new Error('recovery_execution_race');
    run=await loadRun(env,run.id);
  }
  const receipt=await readyReceipt(env,run.id);
  if(!receipt){
    const moved=await env.DB.prepare(
      "UPDATE historical_recovery_runs SET phase='verify_pending',family_index=0,"+
      "after_source_id='',updated_at=CURRENT_TIMESTAMP"+
      " WHERE id=? AND phase='applying' AND expected_epoch=?"+
      ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
    ).bind(run.id,current,current).run();
    if(Number(moved.meta?.changes)!==1)throw new Error('recovery_final_audit_race');
    return {...totals(await loadRun(env,run.id)),applicationCompleted:true};
  }
  const evidence=await planInternalHistoricalRestoration(
    env,receipt.family,null,receipt.source_record_id
  );
  const {candidates,report}=evidence;
  if(!report.liveSourceReverified || report.liveRevision!==current ||
     !report.revisionCounterMatchesProof || !report.auditLedgerVerified ||
     report.originalVerified!==1 || report.classifications.conflict!==0 ||
     report.classifications.identity_ambiguous!==0 ||
     report.classifications.invalid_evidence!==0 ||
     candidates.length>Number(receipt.candidate_count) ||
     Number(report.ledgerShortfall)>Number(receipt.missing_count)){
    await markPaused(env,run.id);
    throw new Error('recovery_receipt_drift_or_ambiguous');
  }
  const currentMeta=await first(env,'SELECT content_hash FROM source_records WHERE id=?',
    receipt.source_record_id);
  if(!currentMeta || currentMeta.content_hash!==receipt.source_hash){
    await markPaused(env,run.id);
    throw new Error('recovery_original_hash_changed');
  }
  let inserted=0,reused=0;
  for (const candidate of candidates.slice(0,MAX_APPLY_PAGE)){
    // Each insertion and the job epoch/receipt progress are one D1 transaction.
    // A lost HTTP response therefore replays idempotently against checkpointed
    // evidence rather than silently losing track of a committed write.
    const response=await applyVerifiedHistoricalRestoration(env,candidate,{
      approved:true,authorization,runId:run.id,expectedEpoch:current+inserted
    });
    inserted+=Number(response.restored||0);
    reused+=Number(response.reused||0);
  }
  if (candidates.length<=MAX_APPLY_PAGE) {
    const remaining=await planInternalHistoricalRestoration(
      env,receipt.family,null,receipt.source_record_id
    );
    const residual=remaining.report;
    if(!residual.liveSourceReverified ||
      Number(residual.liveRevision)!==Number(current+inserted) ||
      remaining.candidates.length>0) {
      await markPaused(env,run.id);
      throw new Error('recovery_residual_proof_mismatch');
    }
    const done=await env.DB.prepare(
      "UPDATE historical_recovery_receipts SET status='applied',"+
      "updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND family=? AND source_record_id=?"+
      " AND status='ready' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?"
    ).bind(run.id,receipt.family,receipt.source_record_id,current+inserted).run();
    if(Number(done.meta?.changes)!==1)throw new Error('recovery_receipt_completion_conflict');
  }
  return {...totals(await loadRun(env,run.id)),pageFamily:receipt.family,
    inserted,reused,pageApplied:candidates.length<=MAX_APPLY_PAGE,
    budget:report.budget};
}
export async function stepHistoricalRecoveryPostAudit(env,{runId}={}) {
  requireEnv(env);
  const run=await loadRun(env,runId);
  if(run.phase!=='verify_pending') return totals(run);
  const current=await epoch(env);
  if(current!==Number(run.expected_epoch)){
    await markPaused(env,run.id);
    throw new Error('recovery_postaudit_mutated');
  }
  const index=Number(run.family_index);
  if(index>=FAMILIES.length)throw new Error('recovery_post_audit_cursor_invalid');
  const family=FAMILIES[index];
  const rows=await allBounded(env,selector(family,false,MAX_VERIFY_PAGE),
    family,run.after_source_id);
  const complete=rows.length===0;
  const missing=rows.reduce((sum,row)=>sum+
    Math.max(0,Number(row.expected_count)-Number(row.actual_count)),0);
  const excess=rows.reduce((sum,row)=>sum+
    Math.max(0,Number(row.actual_count)-Number(row.expected_count)),0);
  if((await epoch(env))!==current)throw new Error('recovery_postaudit_source_mutated');
  const last=complete && index===FAMILIES.length-1;
  const finalPhase=last ?
    (Number(run.post_remaining_missing)+missing===0 &&
      Number(run.post_excess)+excess===0 ? 'complete':'complete_with_quarantine') :
    'verify_pending';
  const changed=await env.DB.prepare(
    'UPDATE historical_recovery_runs SET phase=?,family_index=?,'+
    'after_source_id=?,post_remaining_missing=post_remaining_missing+?,'+
    'post_excess=post_excess+?,updated_at=CURRENT_TIMESTAMP,'+
    "completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END"+
    " WHERE id=? AND phase='verify_pending' AND family_index=?"+
    ' AND after_source_id=? AND expected_epoch=?'+
    ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?'
  ).bind(finalPhase,complete?index+1:index,complete?'':rows.at(-1).source_record_id,
    missing,excess,last?1:0,run.id,index,run.after_source_id,current,current).run();
  if(Number(changed.meta?.changes)!==1)throw new Error('recovery_post_audit_checkpoint_conflict');
  return {...totals(await loadRun(env,run.id)),pageFamily:family,
    postAuditSourcesChecked:rows.length,pageMissing:missing,pageExcess:excess,
    pageDone:complete};
}
