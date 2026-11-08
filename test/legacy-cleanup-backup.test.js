import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/index.js';
import deployedWorker from '../src/worker-v079.js';
import {
  legacyBackupCapability, beginLegacyBackup, pollLegacyBackup, getLegacyBackupStatus
} from '../src/legacy-cleanup-backup.js';

const DEPLOY='a'.repeat(40);
const BOOKMARK='synthetic_backup_bookmark_20261108_xyz_001';
const TOKEN_TIME=()=>Date.now()+'.'+'f'.repeat(64);
const BODY='BEGIN TRANSACTION;\nCREATE TABLE synthetic_only(x INTEGER);\n'+
  'INSERT INTO synthetic_only VALUES(1);\n'+('-- synthetic test export, no real racing payload\n').repeat(90)+'COMMIT;\n';
const SIGNED_URL='https://download.cloudflarestorage.com/synthetic-test-export';

function fixture(){
  const f=createTestEnv();
  f.env.KENTAURAI_DEPLOY_SHA=DEPLOY;
  f.env.LEGACY_BACKUP_TOKEN=TOKEN_TIME();
  f.env.STORAGE_CLEANUP_TOKEN=Date.now()+'.'+'e'.repeat(64);
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
          ...(!unfinished?{result:{signed_url:badUrl||SIGNED_URL,filename:'synthetic-only.sql'}}:{})
        }});
      }
      if(url===SIGNED_URL){
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

test('legacy backup schema stores only finished private export receipts',async()=>{
  const f=fixture();
  const schema=f.db.prepare('PRAGMA table_info(legacy_cleanup_backups)').all().map(x=>x.name);
  for(const field of ['id','source_sha','bookmark','object_key','object_etag','object_size','status'])
    assert.ok(schema.includes(field));
  assert.throws(()=>f.db.prepare(
    "INSERT INTO legacy_cleanup_backups(id,source_sha,bookmark,object_key,object_etag,object_size,status)"+
    " VALUES (? , ? , ? , 'synthetic', 'etagvalue', 2048, 'exporting')"
  ).run('one',DEPLOY,BOOKMARK),/CHECK constraint failed/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS c FROM legacy_cleanup_backups').get().c,0);
  f.db.close();
});

test('private Worker refuses admin token, stale, absent and preview mode backup requests',async()=>{
  const f=fixture();
  const url='https://safe.invalid/v1/storage-cleanup/legacy-backup/auth-check';
  const response=(token)=>worker.fetch(new Request(url,{headers:{authorization:'Bearer '+token}}),f.env);
  assert.equal((await response('wrong')).status,401);
  assert.equal((await response(f.env.ADMIN_TOKEN)).status,401);
  // A previously authorized cleanup token must never authorize a backup.
  assert.equal((await response(f.env.STORAGE_CLEANUP_TOKEN)).status,401);
  f.env.LEGACY_BACKUP_ENABLED='false';
  assert.equal((await response(f.env.LEGACY_BACKUP_TOKEN)).status,401);
  f.env.LEGACY_BACKUP_ENABLED='true';
  f.env.LEGACY_BACKUP_TOKEN=String(Date.now()-3600_001)+'.'+'c'.repeat(64);
  assert.equal((await response(f.env.LEGACY_BACKUP_TOKEN)).status,401);
  f.env.LEGACY_BACKUP_TOKEN=TOKEN_TIME();
  assert.equal((await response(f.env.LEGACY_BACKUP_TOKEN)).status,200);
  assert.equal(legacyBackupCapability(new Request(url,{
    headers:{authorization:'Bearer '+f.env.LEGACY_BACKUP_TOKEN}
  }),f.env),true);
  f.env.PREVIEW_DATA_MODE='synthetic';
  const blocked=await worker.fetch(new Request('https://safe.invalid/v1/storage-cleanup/legacy-backup/status',{
    headers:{authorization:'Bearer '+f.env.LEGACY_BACKUP_TOKEN}
  }),f.env);
  assert.equal(blocked.status,409);
  f.db.close();
});

test('full production Worker stack enforces the same capability gate',async()=>{
  const f=fixture();
  const url='https://safe.invalid/v1/storage-cleanup/legacy-backup/auth-check';
  const admin=await deployedWorker.fetch(new Request(url,{headers:{
    authorization:'Bearer '+f.env.ADMIN_TOKEN
  }}),f.env);
  assert.equal(admin.status,401);
  const authorized=await deployedWorker.fetch(new Request(url,{headers:{
    authorization:'Bearer '+f.env.LEGACY_BACKUP_TOKEN
  }}),f.env);
  assert.equal(authorized.status,200);
  assert.deepEqual(await authorized.json(),{ok:true,scope:'legacy_backup_only'});
  const cleanupAllowed=await deployedWorker.fetch(new Request(
    'https://safe.invalid/v1/storage-cleanup/auth-check',{headers:{
      authorization:'Bearer '+f.env.STORAGE_CLEANUP_TOKEN
    }}),f.env);
  assert.equal(cleanupAllowed.status,200,'the control cleanup credential must be valid');
  // The dedicated backup token cannot access ANY shared cleanup or restore route.
  for (const p of ['/v1/storage-cleanup/auth-check',
    '/v1/storage-cleanup/restoration/run/status',
    '/v1/storage-cleanup/restoration/run/start',
    '/v1/storage-cleanup/session/start',
    '/v1/rounds/synthetic-round']) {
    const response=await deployedWorker.fetch(new Request('https://safe.invalid'+p,{
      method:p.endsWith('/start')?'POST':'GET',
      headers:{authorization:'Bearer '+f.env.LEGACY_BACKUP_TOKEN,
        'content-type':'application/json'},
      ...(p.endsWith('/start')?{body:'{}'}:{})
    }),f.env);
    assert.equal(response.status,401,'backup token escaped scope at '+p);
  }
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

test('after a later deployment, completed old receipts do not count as fresh backup',async()=>{
  const f=fixture(),api=fakeCloudflare();
  await beginLegacyBackup(f.env,{fetchImpl:api.fetch});
  await pollLegacyBackup(f.env,{fetchImpl:api.fetch});
  f.env.KENTAURAI_DEPLOY_SHA='b'.repeat(40);
  const status=await getLegacyBackupStatus(f.env);
  assert.equal(status.status,'none');
  assert.equal(status.backupVerified,false);
  const fresh=await beginLegacyBackup(f.env,{fetchImpl:api.fetch});
  assert.equal(fresh.status,'exporting');
  const finished=await pollLegacyBackup(f.env,{fetchImpl:api.fetch});
  assert.equal(finished.sourceSha,'b'.repeat(40));
  assert.equal(finished.backupVerified,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,2);
  f.db.close();
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
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
    assert.equal((await getLegacyBackupStatus(f.env)).status,'exporting');
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
  assert.doesNotMatch(workflow.slice(0,workflow.indexOf('    steps:')),
    /secrets\.CLOUDFLARE_API_TOKEN/,
    'Cloudflare production token must not be inherited by the QA job');
  assert.match(workflow,/secret delete/);
  assert.match(workflow,/secret put LEGACY_BACKUP_TOKEN/);
  assert.doesNotMatch(workflow,/secret put STORAGE_CLEANUP_TOKEN/);
  assert.doesNotMatch(workflow,/d1 export\s+|wrangler d1 execute.+DELETE|restoration\/run\/apply-step|HISTORICAL_REPAIR_ENABLED/);
  assert.doesNotMatch(script,/\bDELETE FROM\b|\bDROP TABLE\b|\.delete\(/);
  assert.match(script,/redirect:'error'/);
  assert.match(script,/MAX_SINGLE_R2_OBJECT_BYTES/);
});

test('manual backup runner takes a fresh snapshot after an older verified one',()=>{
  const script=new URL('../scripts/run-production-legacy-cleanup-backup.mjs',import.meta.url).href;
  const js=[
    'let starts=0;',
    'globalThis.fetch=async(url)=>{',
    "  const key=String(url).split('/').at(-1);",
    "  const common={mode:'private_legacy_backup_only',sourceSha:'"+DEPLOY+"',",
    '    rawPayloadReturned:false,dataDeletionEnabled:false};',
    "  if(key==='status')return Response.json({...common,status:'complete',backupVerified:true,sizeBytes:3200});",
    "  if(key==='start'){starts++;return Response.json({...common,status:'exporting',backupVerified:false,sizeBytes:null});}",
    "  if(key==='poll')return Response.json({...common,status:'complete',backupVerified:true,sizeBytes:3300});",
    "  throw new Error('unexpected route');",
    '};',
    'await import('+JSON.stringify(script)+');',
    "console.log('fresh_start_count='+starts);"
  ].join('\n');
  const result=spawnSync(process.execPath,['--input-type=module','-e',js],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,WORKER_URL:'https://synthetic.invalid',
      CLEANUP_TOKEN:'synthetic-runner-token',GITHUB_SHA:DEPLOY,GITHUB_STEP_SUMMARY:''}
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/fresh_start_count=1/);
  assert.match(result.stdout,/"sqlBytes":3300/);
});
