import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { inspectMultipartCapacity } from '../scripts/check-legacy-multipart-capacity.mjs';
import { MULTIPART_PART_BYTES, MULTIPART_MAX_BYTES } from '../src/legacy-multipart-backup.js';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const ACCOUNT='a'.repeat(32),TOKEN='synthetic_test_token_not_a_real_private_secret';
const UUID='d8189e0e-6127-4ef2-88cc-534cb2217340';
const fake=size=>async()=>Response.json({success:true,result:{uuid:UUID,file_size:size}});

test('GET-only multipart preflight accepts measured 5.32 GiB but never starts export',async()=>{
  const r=await inspectMultipartCapacity({
    accountId:ACCOUNT,apiToken:TOKEN,fetchImpl:fake(5_711_183_872)
  });
  assert.equal(r.mode,'read_only_multipart_backup_capacity');
  assert.equal(r.noDataDeletion,true);
  assert.equal(r.noDataMutation,true);
  assert.equal(r.noExportStarted,true);
  assert.equal(r.actualSqlExportSizeUnknown,true);
  assert.equal(r.sourceSizeBytes,5_711_183_872);
  assert.equal(JSON.stringify(r).includes(UUID),false);
});

test('source too large or inaccurate metadata fails closed',async()=>{
  for(const size of [0,-1,32*1024**3+1]){
    await assert.rejects(inspectMultipartCapacity({
      accountId:ACCOUNT,apiToken:TOKEN,fetchImpl:fake(size)
    }),/multipart_source_db_size_exceeds_reviewed_limit|legacy_capacity_metadata_unverified/);
  }
});

test('new backup workflow requires explicit typed approval and never deploys or deletes',()=>{
  const workflow=read('../.github/workflows/production-legacy-cleanup-multipart-backup.yml');
  const module=read('../src/legacy-multipart-backup.js');
  const runner=read('../scripts/run-production-legacy-multipart-backup.mjs');
  const release=read('../.github/workflows/production-release-v060.yml');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/BACKUP_MULTIPART_ONLY/);
  assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/kentaurai-production-operation/);
  assert.match(workflow,/npm run qa/);
  assert.match(workflow,/legacy_multipart_backup_only/);
  assert.match(release,/\/v1\/storage-cleanup\/legacy-backup-multipart\/status/);
  assert.match(workflow,/secret put LEGACY_MULTIPART_BACKUP_TOKEN/);
  assert.match(workflow,/secret delete/);
  assert.ok(workflow.indexOf('check-legacy-multipart-capacity.mjs')<
    workflow.indexOf('secret put LEGACY_MULTIPART_BACKUP_TOKEN'));
  assert.doesNotMatch(workflow,/wrangler deploy|wrangler d1 execute|migrations apply/);
  assert.doesNotMatch(workflow,/secret put STORAGE_CLEANUP_TOKEN/);
  assert.doesNotMatch(module,/\b(?:DELETE FROM|DROP TABLE|TRUNCATE TABLE)\b|RAW_BUCKET\.delete\(/);
  assert.doesNotMatch(runner,/arrayBuffer\(|\.text\(\).*signed_url|console\.log.*signed_url/);
  assert.match(module,/multipart_source_byte_ranges_unsupported/);
  assert.match(module,/multipart_range_or_source_mismatch/);
  assert.match(module,/multipart_source_part_truncated/);
  assert.match(module,/multipart_d1_receipt_unverified/);
  assert.ok(MULTIPART_PART_BYTES>=5*1024**2);
  assert.ok(MULTIPART_MAX_BYTES>5*1024**3);
});

test('runner rejects starting a fresh export in resume-only mode',()=>{
  const moduleUrl=new URL('../scripts/run-production-legacy-multipart-backup.mjs',import.meta.url).href;
  const code=[
    'globalThis.fetch=async()=>Response.json({mode:"private_multipart_backup_only",status:"none",',
    'rawPayloadReturned:false,dataDeletionEnabled:false,sourceSha:null});',
    'await import('+JSON.stringify(moduleUrl)+');'
  ].join('\n');
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{
    timeout:10000,encoding:'utf8',
    env:{...process.env,WORKER_URL:'https://synthetic.invalid',
      CLEANUP_TOKEN:'synthetic-only',GITHUB_SHA:'a'.repeat(40),
      MULTIPART_BACKUP_MODE:'resume_only',GITHUB_STEP_SUMMARY:''}
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/multipart_runner_no_active_backup_to_resume/);
  assert.doesNotMatch(r.stderr,/signed_url|r2_object_key|source_record_id/);
});

test('multipart runner displays sanitized first-start diagnostics without retrying',()=>{
  const moduleUrl=new URL('../scripts/run-production-legacy-multipart-backup.mjs',import.meta.url).href;
  const code=[
    'let calls=0;',
    'globalThis.fetch=async(url)=>{',
    'calls++;',
    'if(calls===1)return Response.json({mode:"private_multipart_backup_only",',
    'status:"none",rawPayloadReturned:false,dataDeletionEnabled:false,sourceSha:null});',
    'if(String(url).endsWith("/start"))return Response.json({',
    'error:"legacy_multipart_backup_unavailable",stage:"check_d1_size",',
    'reason:"cloudflare_http_403",payload:"SECRET_PRIVATE_ERROR"},',
    '{status:409});',
    'throw Error("unexpected_request");',
    '};',
    'await import('+JSON.stringify(moduleUrl)+');'
  ].join('\n');
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{
    timeout:10000,encoding:'utf8',
    env:{...process.env,WORKER_URL:'https://synthetic.invalid',
      CLEANUP_TOKEN:'synthetic-only',GITHUB_SHA:'a'.repeat(40),
      MULTIPART_BACKUP_MODE:'start_or_resume',GITHUB_STEP_SUMMARY:''}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,
    /recovery_private_api_http_409_stage_check_d1_size_reason_cloudflare_http_403/);
  assert.doesNotMatch(result.stderr,/SECRET_PRIVATE_ERROR|signed_url|source_record_id/);
});
