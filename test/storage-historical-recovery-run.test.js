import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import {
  startHistoricalRecoveryRun, historicalRecoveryStatus,
  stepHistoricalRecoveryInventory, startHistoricalRecoveryCloudBackup,
  pollHistoricalRecoveryCloudBackup,
  stepHistoricalRecoveryExecution, stepHistoricalRecoveryPostAudit
} from '../src/storage-historical-recovery-run.js';
import worker from '../src/index.js';

const DEPLOY = 'a'.repeat(40);
const EARLIER = '2026-09-10T10:00:00Z';
const CURRENT = '2026-09-11T10:00:00Z';
const SOURCE_CURRENT = 'z-later-source';
const SOURCE_PRIOR = 'a-earlier-source';
const TOKEN = 'synthetic-only-private-repair-token-with-32-characters';

async function fixture() {
  const f=createTestEnv();
  f.env.KENTAURAI_DEPLOY_SHA=DEPLOY;
  f.db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('horse001','Synthetic Horse')").run();
  f.db.prepare("INSERT INTO horse_external_ids(horse_id,source_type,external_id)" +
    " VALUES ('horse001','official','101')").run();
  const body=JSON.stringify({ races:[{starts:[{ horse:{id:101,age:5} }]}] });
  const hash=createHash('sha256').update(body).digest('hex');
  const key='raw/official_provider/'+hash+'.json';
  await f.env.RAW_BUCKET.put(key,body,{
    customMetadata:{contentHash:hash,sourceType:'official_provider'}
  });
  for(const [id,at] of [[SOURCE_PRIOR,EARLIER],[SOURCE_CURRENT,CURRENT]]) {
    f.db.prepare(
      'INSERT INTO source_records(id,source_type,fetched_at,raw_object_key,content_hash,quality_status)' +
      " VALUES (?,'official_provider',?,?,?,'normalized_verified_subset')"
    ).run(id,at,key,hash);
    f.db.prepare(
      'INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)' +
      " VALUES (?,'complete',1)"
    ).run(id);
  }
  f.db.prepare(
    'INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,' +
    "source_record_id,quality_status) VALUES ('prior-snap','horse001',?,5,?," +
    "'verified_official_snapshot')"
  ).run(EARLIER,SOURCE_PRIOR);
  return {...f,originalHash:hash};
}

async function ready(f) {
  const started=await startHistoricalRecoveryRun(f.env);
  assert.equal(started.phase,'inventory');
  assert.equal(started.scannedDeficientSources,0);
  const first=await stepHistoricalRecoveryInventory(f.env,{runId:started.runId});
  assert.equal(first.pageDeficit,1);
  assert.equal(first.pageVerified,1);
  assert.equal(first.pageQuarantined,0);
  assert.equal(first.pageFamily,'horse_profile');
  assert.equal(first.phase,'inventory');
  let report=first;
  for(let i=0;i<5&&report.phase==='inventory';i++){
    report=await stepHistoricalRecoveryInventory(f.env,{runId:started.runId});
  }
  assert.equal(report.phase,'ready');
  assert.equal(report.verifiedCandidateFacts,1);
  assert.equal(report.originallyMissingRepresentations,1);
  f.env.HISTORICAL_RECOVERY_ACCOUNT_ID='b'.repeat(32);
  f.env.HISTORICAL_RECOVERY_DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_only_private_export_token_for_D1_testing';
  const bookmark='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
  const backedUp='SYNTHETIC SQL PRIVATE BACKUP'.repeat(60);
  const priorFetch=globalThis.fetch;
  let startedExport=false;
  let polledExport=false;
  globalThis.fetch=async (url,options={})=>{
    if(String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/')){
      const data=JSON.parse(options.body);
      if(data.output_format==='polling' && !data.current_bookmark){
        startedExport=true;
        return new Response(JSON.stringify({success:true,result:{at_bookmark:bookmark}}),{
          status:200,headers:{'content-type':'application/json'}
        });
      }
      if(data.output_format==='polling' && data.current_bookmark===bookmark){
        polledExport=true;
        return new Response(JSON.stringify({success:true,result:{
          signed_url:'https://download.cloudflarestorage.com/private-synthetic-backup'
        }}),{status:200,headers:{'content-type':'application/json'}});
      }
    }
    if(String(url)==='https://download.cloudflarestorage.com/private-synthetic-backup'){
      return new Response(backedUp,{status:200});
    }
    return priorFetch(url,options);
  };
  let backup;
  try{
    const begun=await startHistoricalRecoveryCloudBackup(f.env,{runId:started.runId});
    assert.equal(begun.backupPending,true);
    backup=await pollHistoricalRecoveryCloudBackup(f.env,{runId:started.runId});
    assert.equal(startedExport,true);
    assert.equal(polledExport,true);
    assert.equal(backup.backupVerified,true);
  }finally{
    globalThis.fetch=priorFetch;
  }
  const key='backups/historical-recovery/'+started.runId+'/'+bookmark+'.sql';
  const raw=await f.env.RAW_BUCKET.get(key);
  assert.equal(await raw.text(),backedUp);
  return {runId:started.runId,backupKey:key};
}

test('durable scan and source-owned restoration complete with independent source-by-source audit',async()=>{
  const f=await fixture();
  const {runId}=await ready(f);
  await assert.rejects(
    () => startHistoricalRecoveryRun(f.env),
    /UNIQUE constraint failed/
  );
  await assert.rejects(
    () => stepHistoricalRecoveryExecution(f.env,{runId,approved:true,authorization:TOKEN}),
    /historical_restoration_not_authorized/
  );
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  let applied=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(applied.phase,'applying');
  assert.equal(applied.inserted,1);
  assert.equal(applied.restoredSourceFacts,1);
  assert.equal(applied.pageApplied,true);
  const original=f.db.prepare(
    "SELECT age_years,source_record_id FROM horse_profile_snapshots WHERE source_record_id=?"
  ).get(SOURCE_PRIOR);
  const restored=f.db.prepare(
    "SELECT age_years,source_record_id FROM horse_profile_snapshots WHERE source_record_id=?"
  ).get(SOURCE_CURRENT);
  assert.equal(original.age_years,5);
  assert.equal(restored.age_years,5);
  assert.equal(restored.source_record_id,SOURCE_CURRENT);
  let next=await stepHistoricalRecoveryExecution(f.env,{runId,approved:true,authorization:TOKEN});
  assert.equal(next.phase,'verify_pending');
  for(let i=0;i<12&&next.phase==='verify_pending';i++){
    next=await stepHistoricalRecoveryPostAudit(f.env,{runId});
  }
  assert.equal(next.phase,'complete');
  assert.equal(next.postAuditRemainingMissing,0);
  assert.equal(next.postAuditExcess,0);
  assert.equal(next.restoredSourceFacts,1);
  const journal=f.db.prepare(
    'SELECT status,restored_count FROM historical_recovery_receipts WHERE run_id=?'
  ).get(runId);
  assert.equal(journal.status,'applied');
  assert.equal(journal.restored_count,1);
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots'
  ).get().n,2);
  assert.equal((await historicalRecoveryStatus(f.env,{runId})).phase,'complete');
  const serialized=JSON.stringify(next);
  for(const privateString of [SOURCE_PRIOR,SOURCE_CURRENT,f.originalHash,'horse001','prior-snap']){
    assert.equal(serialized.includes(privateString),false);
  }
});

test('restore journal and snapshot INSERT roll back together on D1 batch failure',async()=>{
  const f=await fixture(); const {runId}=await ready(f);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  f.d1Faults.batchAfterStatement=0;
  await assert.rejects(
    () => stepHistoricalRecoveryExecution(f.env,{runId,approved:true,authorization:TOKEN}),
    /injected D1 batch failure/
  );
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(SOURCE_CURRENT).n,0);
  assert.equal(f.db.prepare(
    'SELECT restored_count FROM historical_recovery_runs WHERE id=?'
  ).get(runId).restored_count,0);
  const recovered=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(recovered.inserted,1);
});

test('inventory halts safely when underlying official data changes between pages',async()=>{
  const f=await fixture();const started=await startHistoricalRecoveryRun(f.env);
  await stepHistoricalRecoveryInventory(f.env,{runId:started.runId});
  f.db.prepare("UPDATE source_records SET quality_status='captured_unmapped' WHERE id=?")
    .run(SOURCE_PRIOR);
  await assert.rejects(
    () => stepHistoricalRecoveryInventory(f.env,{runId:started.runId}),
    /recovery_inventory_mutated_restart_required/
  );
  const paused=await historicalRecoveryStatus(f.env,{runId:started.runId});
  assert.equal(paused.phase,'paused');
  assert.equal(paused.scanDriftDetected,true);
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(SOURCE_CURRENT).n,0);
});

test('restore cannot start without a matching private R2 backup object',async()=>{
  const f=await fixture();const {runId,backupKey}=await ready(f);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  await f.env.RAW_BUCKET.delete(backupKey);
  await assert.rejects(
    () => stepHistoricalRecoveryExecution(f.env,{
      runId,approved:true,authorization:TOKEN
    }),/recovery_backup_missing_or_changed/
  );
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(SOURCE_CURRENT).n,0);
});

test('private recovery run API requires authentication and rejects writes without capability',async()=>{
  const f=await fixture();const url='https://example.invalid/v1/storage-cleanup/restoration/run/';
  const denied=await worker.fetch(new Request(url+'start',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'
  }),f.env);
  assert.equal(denied.status,401);
  const allowed=await worker.fetch(new Request(url+'start',{
    method:'POST',headers:{
      'content-type':'application/json',
      authorization:'Bearer '+f.env.ADMIN_TOKEN
    },body:'{}'
  }),f.env);
  assert.equal(allowed.status,200);
  const start=await allowed.json();
  assert.equal(start.phase,'inventory');
  assert.equal(start.rawFactsReturned,false);
  const apply=await worker.fetch(new Request(url+'apply-step',{
    method:'POST',headers:{
      'content-type':'application/json',
      authorization:'Bearer '+f.env.ADMIN_TOKEN
    },body:JSON.stringify({run_id:start.runId,approved:true,authorization:'faked'})
  }),f.env);
  assert.equal(apply.status,409);
  assert.deepEqual(await apply.json(),{
    error:'historical_recovery_not_authorized_or_unavailable'
  });
});
