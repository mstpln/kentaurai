import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/worker-v079.js';
import {
  createPrivateMultipartBackup, multipartDiagnosticCapability,
  inspectMultipartBackupState, inspectMultipartD1Metadata, safeMultipartStartError
} from '../src/legacy-multipart-backup.js';

const SHA='a'.repeat(40);
const OLD='b'.repeat(40);
const ACCOUNT='c'.repeat(32);
const D1_UUID='d8189e0e-6127-4ef2-88cc-534cb2217340';
const PREFIX='https://safe.invalid/v1/storage-cleanup/legacy-backup-diagnostic/';
const CONTROL='backups/legacy-cleanup-multipart/.active-v1.json';
const stamp=()=>Date.now()+'.'+'e'.repeat(64);
function fixture(){
  const f=createTestEnv();
  // The simulated Worker must have multipart R2 capabilities even though
  // these pre-export failure scenarios never create an actual upload.
  f.env.RAW_BUCKET.createMultipartUpload=async()=>{throw Error('must_not_upload');};
  f.env.RAW_BUCKET.resumeMultipartUpload=()=>{throw Error('must_not_resume');};
  f.env.KENTAURAI_DEPLOY_SHA=SHA;
  f.env.LEGACY_MULTIPART_DIAG_ENABLED='true';
  f.env.LEGACY_MULTIPART_DIAG_TOKEN=stamp();
  f.env.LEGACY_MULTIPART_BACKUP_ENABLED='true';
  f.env.LEGACY_MULTIPART_BACKUP_TOKEN=Date.now()+'.'+'f'.repeat(64);
  f.env.STORAGE_CLEANUP_TOKEN=Date.now()+'.'+'b'.repeat(64);
  f.env.HISTORICAL_RECOVERY_ACCOUNT_ID=ACCOUNT;
  f.env.HISTORICAL_RECOVERY_DATABASE_ID=D1_UUID;
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_test_token_not_a_real_cloudflare_secret';
  const request=(path,token=f.env.LEGACY_MULTIPART_DIAG_TOKEN,method='GET')=>
    new Request(path.startsWith('https://')?path:PREFIX+path,{
      method,headers:{authorization:'Bearer '+token}
    });
  return {...f,request};
}
function syntheticStart(f, failure){
  let exportCalls=0;
  const svc=createPrivateMultipartBackup({
    partBytes:256,controlWriteSpacingMs:0,
    fetchImpl:async(url,opts)=>{
      if(opts?.method==='GET')
        return Response.json({success:true,result:{uuid:D1_UUID,file_size:5_711_183_872}});
      if(String(url).endsWith('/export')){
        exportCalls++;
        if(failure==='forbidden')
          return new Response(JSON.stringify({success:false,
            errors:[{message:'PRIVATE_SHOULD_NEVER_BE_LOGGED'}]}),{status:403,
            headers:{'content-type':'application/json'}});
        if(failure==='network')
          throw Error('PRIVATE_NETWORK_DETAIL_MUST_NEVER_LEAK');
        return Response.json({success:true,result:{
          status:'active',at_bookmark:'synthetic_bookmark_no_racing_123456789'
        }});
      }
      throw Error('unexpected synthetic URL');
    }
  });
  return {...svc,exportCalls:()=>exportCalls};
}
test('first export 403 produces a safe stage code, not Cloudflare private response',async()=>{
  const f=fixture(),svc=syntheticStart(f,'forbidden');
  await assert.rejects(svc.start(f.env),error=>{
    assert.equal(error.message,'multipart_start_failed');
    const safe=safeMultipartStartError(error);
    assert.deepEqual(safe,{stage:'request_d1_export',reason:'cloudflare_http_403'});
    assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_SHOULD_NEVER_BE_LOGGED|Bearer|synthetic_bookmark/);
    return true;
  });
  assert.equal(svc.exportCalls(),1);
  const before=f.d1Metrics.statements;
  const result=await inspectMultipartBackupState(f.env);
  assert.deepEqual(result,{
    mode:'private_multipart_status_only',
    status:'starting',
    controlExists:true,
    deploymentMatches:true,
    bookmarkSaved:false,
    exportStartUncertain:true,
    partsUploaded:0,
    completeReceiptClaimed:false,
    dataDeleted:false,
    backupExportStartedByThisCheck:false,
    d1Queried:false,
    r2Modified:false,
    rawPayloadReturned:false
  });
  assert.equal(f.d1Metrics.statements,before,'inspector must never read D1');
  assert.deepEqual(Array.from(f.objects.keys()),[CONTROL]);
  assert.equal((await svc.start(f.env)).status,'starting',
    'uncertain export state must not be reset by another start');
  assert.equal(svc.exportCalls(),1,'must not send a second export call');
  f.db.close();
});
test('missing private marker is distinguished from uncertain start without writing',async()=>{
  const f=fixture();
  const before=f.d1Metrics.statements;
  const status=await inspectMultipartBackupState(f.env);
  assert.equal(status.status,'none');
  assert.equal(status.controlExists,false);
  assert.equal(status.deploymentMatches,null);
  assert.equal(status.backupExportStartedByThisCheck,false);
  assert.equal(f.d1Metrics.statements,before);
  assert.equal(f.objects.size,0);
  f.db.close();
});
test('read-only inspection can identify a stale reservation across deployments',async()=>{
  const f=fixture(),svc=syntheticStart(f,'forbidden');
  await assert.rejects(svc.start(f.env),/multipart_start_failed/);
  f.env.KENTAURAI_DEPLOY_SHA=OLD;
  const status=await inspectMultipartBackupState(f.env);
  assert.equal(status.status,'starting');
  assert.equal(status.deploymentMatches,false);
  assert.equal(status.bookmarkSaved,false);
  assert.equal(status.exportStartUncertain,true);
  assert.equal(status.rawPayloadReturned,false);
  f.db.close();
});
test('network failures and metadata failures report sanitized start phases',async()=>{
  for(const failure of ['network','metadata']){
    const f=fixture();
    const svc=createPrivateMultipartBackup({
      partBytes:256,controlWriteSpacingMs:0,
      fetchImpl:async(url,opts)=>{
        if(opts.method==='GET'){
          if(failure==='metadata')return new Response('PRIVATE_NON_JSON',{status:503});
          return Response.json({success:true,result:{uuid:D1_UUID,file_size:5_711_183_872}});
        }
        throw Error('PRIVATE_NETWORK_DETAIL_MUST_NEVER_LEAK');
      }
    });
    await assert.rejects(svc.start(f.env),error=>{
      const safe=safeMultipartStartError(error);
      assert.equal(safe.stage,failure==='metadata'?'check_d1_size':'request_d1_export');
      assert.equal(safe.reason,failure==='metadata'?'cloudflare_http_503':'transport_unavailable');
      assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_/);
      return true;
    });
    assert.equal(f.objects.size,failure==='metadata'?0:1);
    f.db.close();
  }
});
test('diagnostic credentials authorize only GET auth-check and GET inspect',async()=>{
  const f=fixture();
  assert.equal(multipartDiagnosticCapability(f.request('auth-check'),f.env),true);
  const auth=await worker.fetch(f.request('auth-check'),f.env);
  assert.equal(auth.status,200);
  assert.deepEqual(await auth.json(),{ok:true,scope:'legacy_multipart_diagnostic_only'});
  const read=await worker.fetch(f.request('inspect'),f.env);
  assert.equal(read.status,200);
  assert.equal((await read.json()).status,'none');
  for(const path of ['inspect','auth-check','start','poll','step','finalize','refresh']){
    const denied=await worker.fetch(f.request(path,f.env.LEGACY_MULTIPART_DIAG_TOKEN,'POST'),f.env);
    assert.equal(denied.status,401,'diagnostic cannot POST to '+path);
  }
  for(const path of [
    'https://safe.invalid/v1/storage-cleanup/legacy-backup-multipart/start',
    'https://safe.invalid/v1/storage-cleanup/legacy-backup-multipart/status',
    'https://safe.invalid/v1/storage-cleanup/auth-check',
    'https://safe.invalid/v1/rounds/synthetic'
  ]){
    const denied=await worker.fetch(f.request(path),f.env);
    assert.equal(denied.status,401,'diagnostic escaped scope at '+path);
  }
  for(const token of ['wrong',f.env.ADMIN_TOKEN,
    f.env.LEGACY_MULTIPART_BACKUP_TOKEN,f.env.STORAGE_CLEANUP_TOKEN]){
    const denied=await worker.fetch(f.request('inspect',token),f.env);
    assert.equal(denied.status,401);
  }
  f.env.LEGACY_MULTIPART_DIAG_ENABLED='false';
  assert.equal((await worker.fetch(f.request('inspect'),f.env)).status,401);
  f.db.close();
});
test('diagnostic workflow never calls D1 export, R2 upload, backup or restoration',()=>{
  const workflow=readFileSync(new URL(
    '../.github/workflows/production-legacy-multipart-diagnostic.yml',
    import.meta.url),'utf8');
  const source=readFileSync(new URL('../src/legacy-multipart-backup.js',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/INSPECT_MULTIPART_ONLY/);
  assert.match(workflow,/kentaurai-production-operation/);
  assert.match(workflow,/npm run qa/);
  assert.match(workflow,/secret put LEGACY_MULTIPART_DIAG_TOKEN/);
  assert.match(workflow,/secret delete/);
  assert.match(workflow,/legacy-backup-diagnostic\/inspect/);
  assert.match(workflow,/\"GET\"|GET ONLY/);
  assert.doesNotMatch(workflow,/secret put (?:HISTORICAL_BACKUP_API_TOKEN|LEGACY_MULTIPART_BACKUP_TOKEN|STORAGE_CLEANUP_TOKEN)/);
  assert.doesNotMatch(workflow,/run-production-legacy-multipart-backup\.mjs|\/legacy-backup-multipart\/(start|poll|step|finalize|refresh)/);
  assert.doesNotMatch(workflow,/wrangler d1 execute|wrangler deploy|\/d1\/database\/.*\/export/);
  const inspected=source.slice(source.indexOf('export async function inspectMultipartBackupState'),
    source.indexOf('async function saveControl',source.indexOf('export async function inspectMultipartBackupState')));
  assert.doesNotMatch(inspected,/\b(?:INSERT|UPDATE|DELETE|SELECT)\b|\.put\(|\.delete\(|cloudflare\(|exportPolling\(/);
  assert.match(inspected,/readControl\(env,partBytes\)/);
});

test('metadata-only probe verifies exact D1 metadata GET without any D1/R2 operation',async()=>{
  const f=fixture(),before=f.d1Metrics.statements;
  const keysBefore=Array.from(f.objects.keys());
  let calls=0;
  const status=await inspectMultipartD1Metadata(f.env,{fetchImpl:async(url,opts)=>{
    calls++;
    assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
      '/d1/database/'+D1_UUID+'?fields=uuid,file_size');
    assert.equal(opts.method,'GET');
    assert.equal(opts.body,undefined);
    return Response.json({success:true,result:{uuid:D1_UUID,file_size:5_711_183_872}});
  }});
  assert.deepEqual(status,{mode:'private_multipart_metadata_only',status:'verified',
    reason:'none',d1Queried:false,exportStarted:false,r2Modified:false,
    dataDeleted:false,rawPayloadReturned:false});
  assert.equal(calls,1);
  assert.equal(f.d1Metrics.statements,before);
  assert.deepEqual(Array.from(f.objects.keys()),keysBefore);
  f.db.close();
});

test('metadata-only probe safely distinguishes absent credentials, transport and HTTP errors',async()=>{
  const f=fixture();
  f.env.HISTORICAL_BACKUP_API_TOKEN='';
  let networkCalls=0;
  const absent=await inspectMultipartD1Metadata(f.env,{fetchImpl:async()=>{
    networkCalls++;throw Error('never_call_network');
  }});
  assert.equal(absent.status,'failed');
  assert.equal(absent.reason,'credentials_unavailable');
  assert.equal(networkCalls,0);
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_test_token_not_a_real_cloudflare_secret';
  for(const [network,expected] of [
    [async()=>{throw Error('PRIVATE_D1_DETAILS_NOT_FOR_LOGS');},'transport_unavailable'],
    [async()=>new Response('PRIVATE_FORBIDDEN',{status:403}),'cloudflare_http_403'],
    [async()=>new Response('PRIVATE_UNEXPECTED',{status:530}),'cloudflare_http_other'],
    [async()=>Response.json({success:false,errors:[{message:'PRIVATE_PAYLOAD'}]}),
      'cloudflare_response_unverified']
  ]){
    const data=await inspectMultipartD1Metadata(f.env,{fetchImpl:network});
    assert.equal(data.status,'failed');
    assert.equal(data.reason,expected);
    assert.doesNotMatch(JSON.stringify(data),/PRIVATE_|Bearer|cloudflare\.com/);
  }
  assert.equal(f.objects.size,0);
  f.db.close();
});

test('metadata endpoint is strictly GET and isolated from backup mutation credentials',async()=>{
  const f=fixture();
  f.env.HISTORICAL_BACKUP_API_TOKEN='';
  const allowed=await worker.fetch(f.request('metadata'),f.env);
  assert.equal(allowed.status,200);
  const data=await allowed.json();
  assert.equal(data.mode,'private_multipart_metadata_only');
  assert.equal(data.reason,'credentials_unavailable');
  assert.equal(data.d1Queried,false);
  assert.equal(data.exportStarted,false);
  assert.equal(data.r2Modified,false);
  for(const token of ['wrong',f.env.LEGACY_MULTIPART_BACKUP_TOKEN,f.env.STORAGE_CLEANUP_TOKEN]){
    assert.equal((await worker.fetch(f.request('metadata',token),f.env)).status,401);
  }
  for(const method of ['POST','PUT','DELETE']){
    assert.equal((await worker.fetch(f.request('metadata',f.env.LEGACY_MULTIPART_DIAG_TOKEN,method),f.env)).status,401);
  }
  f.db.close();
});

test('manual D1-metadata diagnostic workflow is read-only and separate from backup execution',()=>{
  const yaml=readFileSync(new URL(
    '../.github/workflows/production-legacy-multipart-metadata-diagnostic.yml',
    import.meta.url),'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/INSPECT_D1_METADATA_ONLY/);
  assert.match(yaml,/kentaurai-production-operation/);
  assert.match(yaml,/npm run qa/);
  assert.match(yaml,/legacy-backup-diagnostic\/metadata/);
  assert.match(yaml,/secret put LEGACY_MULTIPART_DIAG_TOKEN/);
  assert.match(yaml,/secret delete/);
  assert.match(yaml,/secret put HISTORICAL_BACKUP_API_TOKEN/);
  assert.match(yaml,/secret put HISTORICAL_RECOVERY_ACCOUNT_ID/);
  assert.doesNotMatch(yaml,/secret put LEGACY_MULTIPART_BACKUP_(?:TOKEN|ENABLED)/);
  assert.doesNotMatch(yaml,/run-production-legacy-multipart-backup\.mjs|\/legacy-backup-multipart\/(?:start|poll|step|finalize|refresh)/);
  assert.doesNotMatch(yaml,/wrangler d1 execute|wrangler deploy|\/d1\/database\/.*\/export|\/d1\/database\/.*\/query/);
});

test('metadata workflow safely retries only a bounded 401 for GET after secret rollout',()=>{
  const yaml=readFileSync(new URL(
    '../.github/workflows/production-legacy-multipart-metadata-diagnostic.yml',
    import.meta.url),'utf8');
  const start=yaml.indexOf('      - name: Inspect Worker-side D1 metadata only');
  const end=yaml.indexOf('      - name: Remove all temporary diagnostic',start);
  assert.ok(start>=0&&end>start);
  const section=yaml.slice(start,end);
  assert.match(section,/for auth_try in \$\(seq 1 12\); do/);
  assert.match(section,/--write-out '%\{http_code\}'/);
  assert.match(section,/--output "\$RUNNER_TEMP\/private-d1-metadata.json"/);
  assert.match(section,/if \[ "\$code" = 200 \]; then break; fi/);
  assert.match(section,/if \[ "\$code" != 401 \]; then/);
  assert.match(section,/if \[ "\$auth_try" -eq 12 \]; then/);
  assert.match(section,/sleep 3/);
  assert.doesNotMatch(section,/curl --fail|--data-binary|--data-raw|--request POST|--request DELETE/);
  assert.doesNotMatch(section,/cat "\$RUNNER_TEMP\/private-d1-metadata.json"/);
  assert.doesNotMatch(section,/legacy-backup-multipart\/(?:start|poll|step|refresh|finalize)/);
});
