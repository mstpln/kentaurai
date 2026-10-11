import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTestEnv } from './helpers/d1.js';
import {
  startHistoricalRecoveryRun, historicalRecoveryStatus,
  stepHistoricalRecoveryInventory, startHistoricalRecoveryCloudBackup,
  pollHistoricalRecoveryCloudBackup,
  stepHistoricalRecoveryExecution, stepHistoricalRecoveryPostAudit
} from '../src/storage-historical-recovery-run.js';
import worker from '../src/index.js';
import productionWorker from '../src/worker-v079.js';

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

async function scanned(f) {
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
  return started;
}

async function ready(f) {
  const started=await scanned(f);
  f.env.HISTORICAL_RECOVERY_ACCOUNT_ID='b'.repeat(32);
  f.env.HISTORICAL_RECOVERY_DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_only_private_export_token_for_D1_testing';
  const bookmark='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
  const backedUp='BEGIN TRANSACTION;\n' +
    'CREATE TABLE restore_probe(value INTEGER PRIMARY KEY);\n' +
    'INSERT INTO restore_probe(value) VALUES (42);\n' +
    '-- SYNTHETIC BACKUP CONTENT ONLY\n'.repeat(70) +
    'COMMIT;\n';
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
          type:'export',status:'complete',at_bookmark:bookmark,
          result:{filename:'private-d1-export.sql',
            signed_url:'https://download.cloudflarestorage.com/private-synthetic-backup'}
        }}),{status:200,headers:{'content-type':'application/json'}});
      }
    }
    if(String(url)==='https://download.cloudflarestorage.com/private-synthetic-backup'){
      return new Response(backedUp,{status:200,
        headers:{'content-length':String(new TextEncoder().encode(backedUp).byteLength)}});
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
  // Rehearse a restore into an isolated synthetic SQLite database; no
  // production data is downloaded or written by this test.
  const rehearsed=new DatabaseSync(':memory:');
  try {
    rehearsed.exec(await raw.text());
    assert.equal(rehearsed.prepare('SELECT value FROM restore_probe').get().value,42);
  } finally { rehearsed.close(); }
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
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
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
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
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
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
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


test('changed private original after inventory is quarantined and independent audit reports remaining deficit',async()=>{
  const f=await fixture();
  const {runId}=await ready(f);
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  const row=f.db.prepare(
    'SELECT raw_object_key FROM source_records WHERE id=?'
  ).get(SOURCE_CURRENT);
  await f.env.RAW_BUCKET.delete(row.raw_object_key);
  const executed=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(executed.phase,'applying');
  assert.equal(executed.pageQuarantined,1);
  assert.equal(executed.inserted,0);
  assert.equal(executed.quarantinedOrDeferredFacts,1);
  assert.equal(f.db.prepare(
    "SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?"
  ).get(SOURCE_CURRENT).n,0);
  const transitioned=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(transitioned.phase,'verify_pending');
  let report=transitioned;
  for(let i=0;i<12&&report.phase==='verify_pending';i++){
    report=await stepHistoricalRecoveryPostAudit(f.env,{runId});
  }
  assert.equal(report.phase,'complete_with_quarantine');
  assert.equal(report.postAuditRemainingMissing,1);
  assert.equal(report.postAuditExcess,0);
  assert.equal(report.restoredSourceFacts,0);
  assert.equal(f.db.prepare(
    "SELECT status FROM historical_recovery_receipts WHERE run_id=? AND family='horse_profile'"
  ).get(runId).status,'quarantined');
});

test('stale original mapping pauses source restoration without touching immutable facts',async()=>{
  const f=await fixture();
  const {runId}=await ready(f);
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  f.db.prepare(
    "UPDATE horse_external_ids SET external_id='999' WHERE horse_id='horse001'"
  ).run();
  await assert.rejects(
    () => stepHistoricalRecoveryExecution(f.env,{
      runId,approved:true,authorization:TOKEN
    }), /recovery_external_mutation_paused/
  );
  const state=await historicalRecoveryStatus(f.env,{runId});
  assert.equal(state.phase,'paused');
  assert.equal(state.scanDriftDetected,true);
  assert.equal(f.db.prepare(
    "SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?"
  ).get(SOURCE_CURRENT).n,0);
});


test('crash after final atomic source INSERT but before receipt close is idempotently finalized',async()=>{
  const f=await fixture();
  const {runId}=await ready(f);
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  const restored=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(restored.inserted,1);
  assert.equal(restored.restoredSourceFacts,1);
  // Model the exact crash window: the source INSERT + journal checkpoint
  // were committed, but the separate receipt-close operation was lost.
  f.db.prepare(
    "UPDATE historical_recovery_receipts SET status='ready'"+
    " WHERE run_id=? AND family='horse_profile' AND source_record_id=?"
  ).run(runId,SOURCE_CURRENT);
  const next=await stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  });
  assert.equal(next.recoveredCommittedCheckpoint,true);
  assert.equal(next.pageApplied,true);
  assert.equal(next.inserted,0);
  assert.equal(next.restoredSourceFacts,1);
  assert.equal(next.quarantinedOrDeferredFacts,0);
  assert.equal(f.db.prepare(
    "SELECT status FROM historical_recovery_receipts WHERE run_id=?"+
    " AND family='horse_profile' AND source_record_id=?"
  ).get(runId,SOURCE_CURRENT).status,'applied');
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(SOURCE_CURRENT).n,1);
});


test('expired recovery capability cannot restore historical facts',async()=>{
  const f=await fixture();
  const {runId}=await ready(f);
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)+1200);
  f.env.HISTORICAL_REPAIR_ENABLED='true';
  f.env.HISTORICAL_REPAIR_TOKEN=TOKEN;
  f.env.HISTORICAL_REPAIR_EXPIRES_AT=String(Math.floor(Date.now()/1000)-1);
  await assert.rejects(()=>stepHistoricalRecoveryExecution(f.env,{
    runId,approved:true,authorization:TOKEN
  }),/historical_restoration_not_authorized/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?').get(SOURCE_CURRENT).n,0);
});


const CLOUD_EXPORT_BOOKMARK='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
const CLOUD_EXPORT_URL='https://download.cloudflarestorage.com/private-synthetic-backup';

async function withSyntheticCloudExport(pollResult,{downloadBody='SYNTHETIC SQL BACKUP'.repeat(90),
  advertisedLength=null,omitLength=false,contentType=null}={},callback){
  const previous=globalThis.fetch;
  let downloaded=0;
  globalThis.fetch=async(url,options={})=>{
    if(String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/')){
      const body=JSON.parse(options.body);
      return new Response(JSON.stringify({success:true,result:body.current_bookmark ?
        pollResult : {type:'export',at_bookmark:CLOUD_EXPORT_BOOKMARK}}),{status:200,
        headers:{'content-type':'application/json'}});
    }
    if(String(url)===CLOUD_EXPORT_URL){
      downloaded++;
      const headers=omitLength?{}:{'content-length':String(advertisedLength ??
        new TextEncoder().encode(downloadBody).byteLength)};
      if(contentType)headers['content-type']=contentType;
      return new Response(downloadBody,{status:200,headers});
    }
    return previous(url,options);
  };
  try{return await callback(()=>downloaded);}
  finally{globalThis.fetch=previous;}
}

test('Cloudflare D1 export status and nested signed URL must agree before backup creation',async()=>{
  const invalid=[
    ['signed URL on an unfinished export',
      {type:'export',at_bookmark:CLOUD_EXPORT_BOOKMARK,
        result:{signed_url:CLOUD_EXPORT_URL}},/recovery_backup_export_state_conflict/],
    ['explicit Cloudflare export failure',
      {type:'export',status:'error',error:'synthetic private failure',
        at_bookmark:CLOUD_EXPORT_BOOKMARK},/recovery_backup_export_api_failed/],
    ['explicit nested Cloudflare export failure',
      {type:'export',success:false,status:'complete',at_bookmark:CLOUD_EXPORT_BOOKMARK,
        result:{signed_url:CLOUD_EXPORT_URL}},/recovery_backup_export_api_failed/],
    ['complete export missing its nested signed URL',
      {type:'export',status:'complete',at_bookmark:CLOUD_EXPORT_BOOKMARK},
      /recovery_backup_export_completion_invalid/],
    ['completed export for a different bookmark',
      {type:'export',status:'complete',at_bookmark:'other-valid-bookmark-12345',
        result:{signed_url:CLOUD_EXPORT_URL}},/recovery_backup_bookmark_conflict/]
  ];
  for(const [label,pollResult,expectedError] of invalid){
    const f=await fixture();
    const {runId}=await scanned(f);
    await withSyntheticCloudExport(pollResult,{},async(downloaded)=>{
      await startHistoricalRecoveryCloudBackup(f.env,{runId});
      await assert.rejects(()=>pollHistoricalRecoveryCloudBackup(f.env,{runId}),
        expectedError,label);
      assert.equal(downloaded(),0,label);
      const row=f.db.prepare(
        'SELECT backup_key,backup_etag FROM historical_recovery_runs WHERE id=?'
      ).get(runId);
      assert.equal(row.backup_key,null,label);
      assert.equal(row.backup_etag,null,label);
    });
  }
});

test('backup must match signed file byte length before obtaining a valid R2 receipt',async()=>{
  const complete={type:'export',status:'complete',at_bookmark:CLOUD_EXPORT_BOOKMARK,
    result:{filename:'private-d1.sql',signed_url:CLOUD_EXPORT_URL}};
  for(const scenario of [
    {omitLength:true,expected:/recovery_backup_length_unverifiable/},
    {advertisedLength:2048,expected:/recovery_backup_r2_verification_failed/},
    {contentType:'text/html',expected:/recovery_backup_dump_unexpected_media_type/}
  ]){
    const f=await fixture();
    const {runId}=await scanned(f);
    await withSyntheticCloudExport(complete,scenario,async(downloaded)=>{
      await startHistoricalRecoveryCloudBackup(f.env,{runId});
      await assert.rejects(()=>pollHistoricalRecoveryCloudBackup(f.env,{runId}),
        scenario.expected);
      assert.equal(downloaded(),1);
      const stored=f.db.prepare(
        'SELECT backup_key,backup_etag,backup_size FROM historical_recovery_runs WHERE id=?'
      ).get(runId);
      assert.equal(stored.backup_key,null);
      assert.equal(stored.backup_etag,null);
      assert.equal(stored.backup_size,null);
    });
  }
});


test('raw original with more unique facts than completed sync count is quarantined',async()=>{
  const f=await fixture();
  const expandedBody=JSON.stringify({races:[{starts:[
    {horse:{id:101,age:5}},
    {horse:{id:202,age:6}}
  ]}]});
  const changedHash=createHash('sha256').update(expandedBody).digest('hex');
  const key='raw/official_provider/'+changedHash+'.json';
  await f.env.RAW_BUCKET.put(key,expandedBody,{
    customMetadata:{contentHash:changedHash,sourceType:'official_provider'}
  });
  f.db.prepare('UPDATE source_records SET raw_object_key=?,content_hash=? WHERE id=?')
    .run(key,changedHash,SOURCE_CURRENT);
  const started=await startHistoricalRecoveryRun(f.env);
  const page=await stepHistoricalRecoveryInventory(f.env,{runId:started.runId});
  assert.equal(page.pageDeficit,1);
  assert.equal(page.pageVerified,0);
  assert.equal(page.pageQuarantined,1);
  assert.equal(page.verifiedCandidateFacts,0);
  const receipt=f.db.prepare(
    'SELECT status,missing_count,candidate_count FROM historical_recovery_receipts WHERE run_id=?'
  ).get(started.runId);
  assert.equal(receipt.status,'quarantined');
  assert.equal(receipt.missing_count,1);
  assert.equal(receipt.candidate_count,0);
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(SOURCE_CURRENT).n,0);
});

test('production entrypoint accepts the same temporary token on auth-check and real recovery routes',async()=>{
  const f=await fixture();
  const prefix='https://synthetic.example.invalid/v1/storage-cleanup/';
  const temporary=String(Date.now())+'.'+'a'.repeat(64);
  f.env.STORAGE_CLEANUP_TOKEN=temporary;
  const headers={authorization:'Bearer '+temporary};
  const auth=await productionWorker.fetch(new Request(prefix+'auth-check',{headers}),f.env);
  assert.equal(auth.status,200);
  assert.deepEqual(await auth.json(),{ok:true,scope:'storage_cleanup'});
  // With no active inventory, the route must give a protected 409, not 401.
  const absent=await productionWorker.fetch(new Request(
    prefix+'restoration/run/status',{headers}
  ),f.env);
  assert.equal(absent.status,409);
  assert.deepEqual(await absent.json(),{
    error:'historical_recovery_not_authorized_or_unavailable'
  });
  const started=await productionWorker.fetch(new Request(
    prefix+'restoration/run/start',{
      method:'POST',
      headers:{...headers,'content-type':'application/json'},
      body:'{}'
    }
  ),f.env);
  assert.equal(started.status,200);
  assert.equal((await started.json()).phase,'inventory');
  const active=await productionWorker.fetch(new Request(
    prefix+'restoration/run/status',{headers}
  ),f.env);
  assert.equal(active.status,200);
  const state=await active.json();
  assert.equal(state.mode,'historical_provenance_recovery');
  assert.equal(state.sourceIdsReturned,false);
  assert.equal(state.rawFactsReturned,false);
  for(const path of ['auth-check','restoration/run/status']){
    const denied=await productionWorker.fetch(new Request(prefix+path,{
      headers:{authorization:'Bearer invalid-temporary-token'}
    }),f.env);
    assert.equal(denied.status,401);
  }
});
