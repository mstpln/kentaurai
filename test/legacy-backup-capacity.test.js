import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inspectLegacyBackupCapacity, LEGACY_BACKUP_DATABASE_ID,
  LEGACY_BACKUP_DB_SIZE_GUARD_BYTES, R2_SINGLE_UPLOAD_LIMIT_BYTES
} from '../scripts/check-legacy-backup-capacity.mjs';

const ACCOUNT='a'.repeat(32);
const TOKEN='synthetic_example_token_only_not_a_real_secret_20261108';
const response=(size, extras={})=>Response.json({
  success:true, result:{uuid:LEGACY_BACKUP_DATABASE_ID,file_size:size}, ...extras
});

test('capacity check uses only Cloudflare GET metadata; no D1 export is started',async()=>{
  const calls=[];
  const report=await inspectLegacyBackupCapacity({
    accountId:ACCOUNT,apiToken:TOKEN,
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return response(2*1024**3);
    }
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.authorization,'Bearer '+TOKEN);
  assert.ok(calls[0].url.endsWith('/d1/database/'+LEGACY_BACKUP_DATABASE_ID+'?fields=uuid,file_size'));
  assert.deepEqual(report,{
    mode:'read_only_legacy_backup_capacity',
    d1FileSizeBytes:2*1024**3,
    d1FileSizeGiB:2,
    r2SingleUploadMaxBytes:R2_SINGLE_UPLOAD_LIMIT_BYTES,
    conservativeD1SizeGuardBytes:LEGACY_BACKUP_DB_SIZE_GUARD_BYTES,
    backupEligibleBySize:true,
    sqlExportSizeNotMeasured:true,
    deletionAuthorized:false,
    databaseReads:0,
    databaseWrites:0
  });
  assert.doesNotMatch(JSON.stringify(report),/synthetic_example_token|d8189e0e|aaaaaa|source_id|r2_key/);
});

test('a reported file size >= conservative capacity guard always blocks export preflight',async()=>{
  for(const size of [
    LEGACY_BACKUP_DB_SIZE_GUARD_BYTES,
    LEGACY_BACKUP_DB_SIZE_GUARD_BYTES+1,
    5*1024**3,
    10*1024**3
  ]){
    const result=await inspectLegacyBackupCapacity({
      accountId:ACCOUNT,apiToken:TOKEN,fetchImpl:async()=>response(size)
    });
    assert.equal(result.backupEligibleBySize,false);
    assert.equal(result.deletionAuthorized,false);
  }
});

test('missing or conflicting metadata fails closed without inventing size',async()=>{
  const broken=[
    response(undefined),
    response(-1),
    response('6000000000'),
    response(1.5),
    Response.json({success:false,result:{uuid:LEGACY_BACKUP_DATABASE_ID,file_size:1}}),
    Response.json({success:true,result:{uuid:'b'.repeat(36),file_size:1}}),
    Response.json({success:true,errors:[{code:1}],result:{uuid:LEGACY_BACKUP_DATABASE_ID,file_size:1}}),
    new Response('not json',{status:200,headers:{'content-type':'application/json'}}),
    new Response('not found',{status:404})
  ];
  for(const reply of broken){
    await assert.rejects(inspectLegacyBackupCapacity({
      accountId:ACCOUNT,apiToken:TOKEN,fetchImpl:async()=>reply
    }),/legacy_capacity_metadata_/);
  }
  await assert.rejects(inspectLegacyBackupCapacity({
    accountId:'',apiToken:TOKEN,fetchImpl:async()=>{throw Error('must not make external request');}
  }),/credentials_unavailable/);
});

test('HTTP transport errors never include untrusted secret or response body',async()=>{
  const sensitive='SECRET_NEVER_LOG_THIS';
  await assert.rejects(inspectLegacyBackupCapacity({
    accountId:ACCOUNT,apiToken:TOKEN,
    fetchImpl:async()=>{throw new Error(sensitive);}
  }),error=>{
    assert.equal(error.message,'legacy_capacity_metadata_transport_unavailable');
    assert.doesNotMatch(error.message,new RegExp(sensitive));
    return true;
  });
});

test('production inventory is read-only and backup size guard precedes secret installation',()=>{
  const inventory=readFileSync(new URL('../.github/workflows/production-legacy-data-inventory.yml',import.meta.url),'utf8');
  const backup=readFileSync(new URL('../.github/workflows/production-legacy-cleanup-backup.yml',import.meta.url),'utf8');
  const script=readFileSync(new URL('../scripts/check-legacy-backup-capacity.mjs',import.meta.url),'utf8');
  assert.match(inventory,/check-legacy-backup-capacity\.mjs/);
  assert.match(inventory,/workflow_dispatch:/);
  assert.match(backup,/check-legacy-backup-capacity\.mjs --require-backup-eligible/);
  assert.ok(backup.indexOf('check-legacy-backup-capacity.mjs --require-backup-eligible')<
    backup.indexOf('secret put LEGACY_BACKUP_TOKEN'));
  assert.doesNotMatch(script,/\b(?:DELETE FROM|UPDATE |INSERT INTO|DROP TABLE|POST\s*\/.*export)\b|\.delete\(/i);
  assert.doesNotMatch(inventory,/wrangler deploy|wrangler d1 execute|secret put/i);
});
