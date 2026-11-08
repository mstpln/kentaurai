import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/index.js';
import {
  legacyBackupCapability, beginLegacyBackup, pollLegacyBackup, getLegacyBackupStatus
} from '../src/legacy-cleanup-backup.js';

const DEPLOY='a'.repeat(40);
const BOOKMARK='synthetic_backup_bookmark_20261108_xyz_001';
const TOKEN_TIME=()=>Date.now()+'.'+'f'.repeat(64);
const BODY='BEGIN TRANSACTION;\nCREATE TABLE synthetic_only(x INTEGER);\n'+
  'INSERT INTO synthetic_only VALUES(1);\n'+('-- synthetic test export, no real racing payload\n').repeat(90)+'COMMIT;\n';
const URL='https://download.cloudflarestorage.com/synthetic-test-export';

function fixture(){
  const f=createTestEnv();
  f.env.KENTAURAI_DEPLOY_SHA=DEPLOY;
  f.env.STORAGE_CLEANUP_TOKEN=TOKEN_TIME();
  f.env.LEGACY_BACKUP_ENABLED='true';
  f.env.HISTORICAL_RECOVERY_ACCOUNT_ID='b'.repeat(32);
  f.env.HISTORICAL_RECOVERY_DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_testing_export_token_with_32_or_more_characters';
  return f;
}
function fakeCloudflare({badUrl=null,declaredBytes=null,unfinished=false}={}){
  let starts=0,polls=0,downloads=0;
  return {
    fetch:async (url,options={})=>{
      if(String(url).endsWith('/export')){
        const request=JSON.parse(options.body);
        assert.equal(request.output_format,'polling');
        assert.equal(options.redirect,'error');
        assert.equal(options.method,'POST');
        if(!request.current_bookmark){
          starts++;
          return Response.json({success:true,result:{
            type:'export',at_bookmark:BOOKMARK,status:'active'
          }});
        }
        polls++;
        assert.equal(request.current_bookmark,BOOKMARK);
        return Response.json({success:true,result:{
          type:'export',at_bookmark:BOOKMARK,status:unfinished?'active':'complete',
          ...(!unfinished?{result:{signed_url:badUrl||URL,filename:'synthetic-only.sql'}}:{})
        }});
      }
      if(url===URL){
        downloads++;
        return new Response(BODY,{headers:{
          'content-length':String(declaredBytes??new TextEncoder().encode(BODY).byteLength),
          'content-type':'application/sql'
        }});
      }
      throw new Error('unexpected fake URL');
    },
    counts:()=>({starts,polls,downloads})
  };
}

test('legacy backup migration stores receipts separately and refuses overlapping active exports',async()=>{
  const f=fixture();
  const schema=f.db.prepare('PRAGMA table_info(legacy_cleanup_backups)').all().map(x=>x.name);
  for(const field of ['id','source_sha','bookmark','object_key','object_etag','object_size','status'])
    assert.ok(schema.includes(field));
  f.db.prepare("INSERT INTO legacy_cleanup_backups(id,source_sha,bookmark,status) VALUES (?,?,?,'exporting')")
    .run('one',DEPLOY,BOOKMARK);
  assert.throws(()=>f.db.prepare("INSERT INTO legacy_cleanup_backups(id,source_sha,bookmark,status) VALUES (?,?,?,'exporting')")
    .run('two',DEPLOY,BOOKMARK),/UNIQUE constraint failed/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS c FROM legacy_cleanup_backups').get().c,1);
  f.db.close();
});

test('private Worker refuses admin token, stale, absent and preview mode backup requests',async()=>{
  const f=fixture();
  const url='https://safe.invalid/v1/storage-cleanup/legacy-backup/auth-check';
  const response=(token)=>worker.fetch(new Request(url,{headers:{authorization:'Bearer '+token}}),f.env);
  assert.equal((await response('wrong')).status,401);
  assert.equal((await response(f.env.ADMIN_TOKEN)).status,403);
  f.env.LEGACY_BACKUP_ENABLED='false';
  assert.equal((await response(f.env.STORAGE_CLEANUP_TOKEN)).status,403);
  f.env.LEGACY_BACKUP_ENABLED='true';
  f.env.STORAGE_CLEANUP_TOKEN=String(Date.now()-3600_001)+'.'+'c'.repeat(64);
  assert.equal((await response(f.env.STORAGE_CLEANUP_TOKEN)).status,401);
  f.env.STORAGE_CLEANUP_TOKEN=TOKEN_TIME();
  assert.equal((await response(f.env.STORAGE_CLEANUP_TOKEN)).status,200);
  assert.equal(legacyBackupCapability(new Request(url,{
    headers:{authorization:'Bearer '+f.env.STORAGE_CLEANUP_TOKEN}
  }),f.env),true);
  f.env.PREVIEW_DATA_MODE='synthetic';
  const blocked=await worker.fetch(new Request('https://safe.invalid/v1/storage-cleanup/legacy-backup/status',{
    headers:{authorization:'Bearer '+f.env.STORAGE_CLEANUP_TOKEN}
  }),f.env);
  assert.equal(blocked.status,409);
  f.db.close();
});

test('full D1 export is streamed to private R2; receipts are verified and not returned',async()=>{
  const f=fixture();
  const api=fakeCloudflare();
  const start=await beginLegacyBackup(f.env,{fetchImpl:api.fetch});
  assert.equal(start.status,'exporting');
  assert.equal(start.backupVerified,false);
  assert.equal(start.rawPayloadReturned,false);
  assert.equal(start.dataDeletionEnabled,false);
  assert.equal((await beginLegacyBackup(f.env,{fetchImpl:api.fetch})).status,'exporting');
  assert.equal(api.counts().starts,1,'retries must not create duplicate exports');
  const result=await pollLegacyBackup(f.env,{fetchImpl:api.fetch});
  assert.equal(result.status,'complete');
  assert.equal(result.backupVerified,true);
  assert.equal(result.sizeBytes,new TextEncoder().encode(BODY).byteLength);
  const row=f.db.prepare('SELECT * FROM legacy_cleanup_backups').get();
  assert.equal(row.source_sha,DEPLOY);
  assert.equal(row.status,'complete');
  assert.match(row.object_key,/^backups\/legacy-cleanup\//);
  const object=await f.env.RAW_BUCKET.get(row.object_key);
  assert.equal(await object.text(),BODY);
  assert.deepEqual((await getLegacyBackupStatus(f.env)),result);
  const again=await pollLegacyBackup(f.env,{fetchImpl:api.fetch});
  assert.deepEqual(again,result);
  assert.equal(api.counts().downloads,1);
  assert.doesNotMatch(JSON.stringify(result),/signed_url|synthetic_only|object_key|bookmark/);
  const isolated=new DatabaseSync(':memory:');
  isolated.exec(await object.text());
  assert.equal(isolated.prepare('SELECT x FROM synthetic_only').get().x,1);
  isolated.close();f.db.close();
});

test('missing or changed private R2 object invalidates even a completed receipt',async()=>{
  const f=fixture(),api=fakeCloudflare();
  await beginLegacyBackup(f.env,{fetchImpl:api.fetch});
  await pollLegacyBackup(f.env,{fetchImpl:api.fetch});
  const key=f.db.prepare('SELECT object_key FROM legacy_cleanup_backups').get().object_key;
  await f.env.RAW_BUCKET.delete(key);
  await assert.rejects(getLegacyBackupStatus(f.env),/legacy_backup_r2_receipt_invalid/);
  f.db.close();
});

test('wrong signed hosts and truncated export cannot produce a completed receipt',async()=>{
  for(const options of [
    {badUrl:'https://attacker.invalid/private.sql'},
    {declaredBytes:new TextEncoder().encode(BODY).byteLength+50}
  ]){
    const f=fixture(),api=fakeCloudflare(options);
    await beginLegacyBackup(f.env,{fetchImpl:api.fetch});
    await assert.rejects(pollLegacyBackup(f.env,{fetchImpl:api.fetch}),
      /legacy_backup_signed_url_refused|legacy_backup_r2_write_unverified/);
    assert.equal(f.db.prepare('SELECT status FROM legacy_cleanup_backups').get().status,'exporting');
    f.db.close();
  }
});

test('invalid export API results stop without database receipt or R2 writes',async()=>{
  const f=fixture();
  const bad={fetch:async()=>Response.json({success:true,result:{status:'complete',at_bookmark:BOOKMARK}})};
  await assert.rejects(beginLegacyBackup(f.env,{fetchImpl:bad.fetch}),
    /legacy_backup_export_unsigned_completion/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS c FROM legacy_cleanup_backups').get().c,0);
  f.db.close();
});

test('backup-only code and workflow include no production delete or upload-to-runner path',()=>{
  const script=readFileSync(new URL('../src/legacy-cleanup-backup.js',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../.github/workflows/production-legacy-cleanup-backup.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/BACKUP_D1_ONLY/);
  assert.match(workflow,/kentaurai-production-operation/);
  assert.match(workflow,/npm run qa/);
  assert.match(workflow,/secret delete/);
  assert.doesNotMatch(workflow,/d1 export\s+|wrangler d1 execute.+DELETE|restoration\/run\/apply-step|HISTORICAL_REPAIR_ENABLED/);
  assert.doesNotMatch(script,/\bDELETE FROM\b|\bDROP TABLE\b|\.delete\(/);
  assert.match(script,/redirect:'error'/);
  assert.match(script,/MAX_SINGLE_R2_OBJECT_BYTES/);
});
