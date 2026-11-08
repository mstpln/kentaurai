import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/worker-v079.js';
import {
  createPrivateMultipartBackup,multipartBackupCapability,MULTIPART_PART_BYTES,
  safeMultipartStartError
} from '../src/legacy-multipart-backup.js';

const SHA='a'.repeat(40),OTHER_SHA='b'.repeat(40);
const BOOKMARK='private_synthetic_export_bookmark_00001';
const SIGNED='https://signed.cloudflarestorage.com/private/synthetic.sql?X-Amz-Signature=synthetic';
const SIGNED_REFRESHED='https://signed.cloudflarestorage.com/private/synthetic.sql?X-Amz-Signature=refreshed';
const PAYLOAD=new TextEncoder().encode("BEGIN TRANSACTION;\n"+
  ("INSERT INTO synthetic_backups VALUES (1,'not-real-racing-data');\n").repeat(24)+"COMMIT;\n");

function fixture({wrongRange=false,badEtag=false,truncated=false,metadataSize=5_711_183_872,
  changedSource=false,sourceUrl=SIGNED,onePollActive=false,
  controlWriteSpacingMs=0,sleep,now}={}){
  const f=createTestEnv();
  const backupObjects=new Map(),uploads=new Map(),events=[];
  let completeCalls=0;
  f.env.KENTAURAI_DEPLOY_SHA=SHA;
  f.env.LEGACY_MULTIPART_BACKUP_ENABLED='true';
  f.env.LEGACY_MULTIPART_BACKUP_TOKEN=Date.now()+'.'+'a'.repeat(64);
  f.env.LEGACY_BACKUP_TOKEN=Date.now()+'.'+'b'.repeat(64);
  f.env.STORAGE_CLEANUP_TOKEN=Date.now()+'.'+'c'.repeat(64);
  f.env.HISTORICAL_RECOVERY_ACCOUNT_ID='d'.repeat(32);
  f.env.HISTORICAL_RECOVERY_DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';
  f.env.HISTORICAL_BACKUP_API_TOKEN='synthetic_only_testing_cloudflare_token_123456';
  const bucket=f.env.RAW_BUCKET;
  const originalPut=bucket.put.bind(bucket),originalHead=bucket.head.bind(bucket);
  bucket.createMultipartUpload=async (key,options)=>{
    const uploadId='synthetic_upload_0000000001';
    assert.ok(key.startsWith('backups/legacy-cleanup-multipart/'));
    assert.equal(options.customMetadata.sourceSha,SHA);
    uploads.set(uploadId,{key,options,parts:new Map()});
    events.push('create');
    return {uploadId};
  };
  bucket.resumeMultipartUpload=(key,id)=>{
    const value=uploads.get(id);
    if(!value||value.key!==key)throw Error('synthetic multipart not active');
    return {
      async uploadPart(num,bytes){
        assert.ok(bytes instanceof Uint8Array);
        const etag=createHash('md5').update(bytes).digest('hex');
        value.parts.set(num,{bytes:Uint8Array.from(bytes),etag});
        events.push('part:'+num);
        return {partNumber:num,etag};
      },
      async complete(parts){
        assert.equal(parts.length,value.parts.size);
        const chunks=parts.map(({partNumber,etag})=>{
          const p=value.parts.get(partNumber);
          assert.equal(p.etag,etag);
          return p.bytes;
        });
        await originalPut(key,Buffer.concat(chunks.map(c=>Buffer.from(c))),value.options);
        events.push('complete');
        return originalHead(key);
      }
    };
  };
  const api=async (url,options={})=>{
    assert.equal(options.redirect,'manual','Cloudflare Workers rejects redirect:error');
    if(String(url).includes('/d1/database/')&&!String(url).endsWith('/export')){
      events.push('size');
      assert.equal(options.method,'GET');
      return Response.json({success:true,result:{
        uuid:'d8189e0e-6127-4ef2-88cc-534cb2217340',file_size:metadataSize
      }});
    }
    if(String(url).endsWith('/export')){
      const body=JSON.parse(options.body);
      assert.equal(options.method,'POST');
      if(!body.current_bookmark){
        events.push('export:start');
        return Response.json({success:true,result:{
          type:'export',at_bookmark:BOOKMARK,status:'active'
        }});
      }
      events.push('export:poll');
      if(onePollActive){
        onePollActive=false;
        return Response.json({success:true,result:{
          type:'export',at_bookmark:BOOKMARK,status:'active'
        }});
      }
      return Response.json({success:true,result:{
        type:'export',at_bookmark:BOOKMARK,status:'complete',
        result:{signed_url:changedSource&&completeCalls++>0?SIGNED_REFRESHED:sourceUrl}
      }});
    }
    if(String(url).startsWith('https://')){
      events.push('range');
      const range=options.headers?.Range||'';
      assert.match(range,/^bytes=\d+-\d+$/);
      const [,from,to]=/^bytes=(\d+)-(\d+)$/.exec(range);
      const begin=Number(from),end=Number(to);
      const bytes=PAYLOAD.slice(begin,end+1);
      const reply=truncated&&begin!==0?bytes.slice(0,-1):bytes;
      return new Response(reply,{status:wrongRange?200:206,
        headers:{
          'content-length':String(bytes.length),
          'content-range':'bytes '+begin+'-'+end+'/'+PAYLOAD.length,
          'content-type':'application/sql',
          etag:badEtag&&begin!==0?'"altered-etag"':'"synthetic-source-etag"'
        }});
    }
    throw Error('unexpected fetch');
  };
  return {...f,bucket,backupObjects,events,api,
    service:createPrivateMultipartBackup({partBytes:256,fetchImpl:api,
      controlWriteSpacingMs,sleep,now})};
}
async function ready(f){
  assert.equal((await f.service.start(f.env)).status,'exporting');
  const status=await f.service.poll(f.env);
  assert.equal(status.status,'uploading');
  assert.equal(status.totalBytes,PAYLOAD.length);
  return status;
}
async function uploadAll(f){
  while(true){
    const status=await f.service.status(f.env);
    if(status.partsUploaded===status.totalParts)break;
    await f.service.step(f.env);
  }
}
test('isolated multipart credential cannot reach cleanup, admin, or old backup routes',async()=>{
  const f=fixture();
  const p='/v1/storage-cleanup/legacy-backup-multipart/';
  const req=(path,token,method='GET')=>new Request('https://safe.invalid'+path,{
    method,headers:{authorization:'Bearer '+token},
    ...(method==='POST'?{body:'{}'}:{})
  });
  const token=f.env.LEGACY_MULTIPART_BACKUP_TOKEN;
  assert.equal(multipartBackupCapability(req(p+'auth-check',token),f.env),true);
  const allowed=await worker.fetch(req(p+'auth-check',token),f.env);
  assert.equal(allowed.status,200);
  assert.deepEqual(await allowed.json(),{ok:true,scope:'legacy_multipart_backup_only'});
  for(const other of ['wrong',f.env.ADMIN_TOKEN,f.env.STORAGE_CLEANUP_TOKEN,
    f.env.LEGACY_BACKUP_TOKEN]){
    const response=await worker.fetch(req(p+'auth-check',other),f.env);
    assert.equal(response.status,401);
  }
  for(const path of ['/v1/storage-cleanup/auth-check',
    '/v1/storage-cleanup/legacy-backup/status','/v1/storage-cleanup/restoration/run/status',
    '/v1/rounds/private-round']){
    const response=await worker.fetch(req(path,token),f.env);
    assert.equal(response.status,401,'backup token escaped scope: '+path);
  }
  f.env.LEGACY_MULTIPART_BACKUP_ENABLED='false';
  assert.equal((await worker.fetch(req(p+'auth-check',token),f.env)).status,401);
  f.env.LEGACY_MULTIPART_BACKUP_ENABLED='true';
  f.env.LEGACY_MULTIPART_BACKUP_TOKEN=Date.now()-3600_001+'.'+'c'.repeat(64);
  assert.equal((await worker.fetch(req(p+'auth-check',
    f.env.LEGACY_MULTIPART_BACKUP_TOKEN),f.env)).status,401);
  f.db.close();
});
test('fresh verified D1 metadata precedes a new long-running export; never query locked D1',async()=>{
  const f=fixture({onePollActive:true});
  const old=f.env.DB;let blocked=false,d1AccessWhileLocked=0;
  f.env.DB={prepare(sql){
    if(blocked){d1AccessWhileLocked++;throw Error('D1 source locked');}
    return old.prepare(sql);
  }};
  const begun=await f.service.start(f.env);
  assert.equal(begun.status,'exporting');
  assert.deepEqual(f.events.slice(0,2),['size','export:start']);
  blocked=true;
  assert.equal((await f.service.status(f.env)).status,'exporting');
  assert.equal((await f.service.poll(f.env)).status,'exporting');
  const readyState=await f.service.poll(f.env);
  assert.equal(readyState.status,'uploading');
  await uploadAll(f);
  assert.equal((await f.service.status(f.env)).partsUploaded,readyState.totalParts);
  assert.equal(d1AccessWhileLocked,0);
  blocked=false;
  const done=await f.service.finalize(f.env);
  assert.equal(done.status,'complete');
  assert.equal(done.backupVerified,true);
  assert.equal(done.totalBytes,PAYLOAD.length);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,1);
  assert.equal(f.events.filter(x=>x==='complete').length,1);
  const row=f.db.prepare('SELECT * FROM legacy_cleanup_backups').get();
  assert.ok(row.object_key.startsWith('backups/legacy-cleanup-multipart/'));
  const source=await f.env.RAW_BUCKET.get(row.object_key);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()),PAYLOAD);
  const status=await f.service.finalize(f.env);
  assert.deepEqual(status,done);
  assert.doesNotMatch(JSON.stringify(done),/signed_url|signedUrl|sql|objectKey|uploadId|bookmark|sha256/i);
  f.db.close();
});
test('initial D1 metadata above the safe cap refuses export without D1 writes',async()=>{
  const f=fixture({metadataSize:33*1024**3});
  await assert.rejects(f.service.start(f.env),error=>{
    assert.deepEqual(safeMultipartStartError(error),{
      stage:'check_d1_size',reason:'source_size_out_of_bounds'
    });
    return true;
  });
  assert.equal(f.events.filter(x=>x.startsWith('export')).length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
  f.db.close();
});
test('signed SQL source MUST provide strict 206 partial content',async()=>{
  for(const options of [{wrongRange:true},{sourceUrl:'https://attacker.invalid/file.sql'}]){
    const f=fixture(options);
    await f.service.start(f.env);
    await assert.rejects(f.service.poll(f.env),
      /multipart_source_byte_ranges_unsupported|multipart_export_response_unverified/);
    assert.equal(f.events.filter(x=>x==='create').length,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
    f.db.close();
  }
});
test('changed ETag or a truncated part cannot be recorded as completed',async()=>{
  for(const options of [{badEtag:true},{truncated:true}]){
    const f=fixture(options);
    await ready(f);
    await f.service.step(f.env); // first range is correct; subsequent ranges fail
    await assert.rejects(f.service.step(f.env),
      /multipart_range_or_source_mismatch|multipart_source_part_truncated/);
    assert.equal((await f.service.status(f.env)).partsUploaded,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
    f.db.close();
  }
});
test('a source link refresh is allowed only for the SAME export object path',async()=>{
  const f=fixture({changedSource:true});
  await ready(f);
  await f.service.step(f.env);
  const updated=await f.service.refresh(f.env);
  assert.equal(updated.partsUploaded,1);
  await uploadAll(f);
  assert.equal((await f.service.finalize(f.env)).complete,true);
  f.db.close();
  const g=fixture({sourceUrl:'https://signed.cloudflarestorage.com/private/path-a.sql?X-Amz-Signature=synth',changedSource:true});
  await ready(g);
  await assert.rejects(g.service.refresh(g.env),/multipart_export_source_changed/);
  g.db.close();
});
test('a source deployment change cannot resume an older unfinished multipart task',async()=>{
  const f=fixture();
  await ready(f);
  f.env.KENTAURAI_DEPLOY_SHA=OTHER_SHA;
  await assert.rejects(f.service.step(f.env),/multipart_deployment_changed_manual_review/);
  await assert.rejects(f.service.finalize(f.env),/multipart_deployment_changed_manual_review/);
  f.db.close();
});
test('R2 artifact removal after completed receipt invalidates backup verification',async()=>{
  const f=fixture();
  await ready(f);await uploadAll(f);await f.service.finalize(f.env);
  const row=f.db.prepare('SELECT * FROM legacy_cleanup_backups').get();
  await f.env.RAW_BUCKET.delete(row.object_key); // synthetic-only tampering
  await assert.rejects(f.service.status(f.env),/multipart_object_receipt_unverified/);
  f.db.close();
});
test('finalize refuses a missing part and writes no D1 completion receipt',async()=>{
  const f=fixture();
  await ready(f);await f.service.step(f.env);
  await assert.rejects(f.service.finalize(f.env),/multipart_upload_incomplete/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
  f.db.close();
});
test('production part size is >= R2 minimum 5 MiB and <= Worker safe buffer',()=>{
  assert.ok(MULTIPART_PART_BYTES>=5*1024*1024);
  assert.ok(MULTIPART_PART_BYTES<=32*1024*1024);
});


test('ambiguous first multipart part is safely re-uploaded at the SAME part index',async()=>{
  const f=fixture();
  await ready(f);
  const raw=f.bucket.resumeMultipartUpload.bind(f.bucket);
  let first=true;
  f.bucket.resumeMultipartUpload=(key,id)=>{
    const upload=raw(key,id);
    return {...upload,uploadPart:async(number,data)=>{
      const completed=await upload.uploadPart(number,data);
      if(first){first=false;throw Error('synthetic ambiguous part result');}
      return completed;
    }};
  };
  await assert.rejects(f.service.step(f.env),/synthetic ambiguous part result/);
  assert.equal((await f.service.status(f.env)).partsUploaded,0);
  await uploadAll(f);
  const output=await f.service.finalize(f.env);
  assert.equal(output.backupVerified,true);
  assert.equal(f.events.filter(x=>x==='part:1').length,2,
    'retry replaces part 1 instead of silently skipping bytes');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,1);
  f.db.close();
});
test('ambiguous D1 receipt commit resumes without re-uploading private SQL',async()=>{
  const f=fixture();
  await ready(f);await uploadAll(f);
  const db=f.env.DB;
  let first=true;
  f.env.DB={prepare(sql){
    const statement=db.prepare(sql);
    if(!sql.startsWith('INSERT INTO legacy_cleanup_backups'))return statement;
    return {bind(...args){
      const bound=statement.bind(...args);
      return {run(){
        const result=bound.run();
        if(first){first=false;throw Error('synthetic D1 receipt response lost');}
        return result;
      }};
    }};
  }};
  await assert.rejects(f.service.finalize(f.env),/synthetic D1 receipt response lost/);
  const uploaded=f.events.filter(x=>x==='complete').length;
  assert.equal(uploaded,1);
  const resumed=await f.service.finalize(f.env);
  assert.equal(resumed.backupVerified,true);
  assert.equal(f.events.filter(x=>x==='complete').length,uploaded,
    'D1 receipt retry must not reassemble or re-upload the SQL');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,1);
  f.db.close();
});


test('private R2 control writes are paced across Worker requests',async()=>{
  let clock=1_800_000_000_000;
  const delays=[];
  const f=fixture({controlWriteSpacingMs:1150,now:()=>clock,
    sleep:async(ms)=>{delays.push(ms);clock+=ms;}});
  await f.service.start(f.env);
  await f.service.poll(f.env);
  await f.service.step(f.env);
  const control=await f.env.RAW_BUCKET.get('backups/legacy-cleanup-multipart/.active-v1.json');
  const state=JSON.parse(await control.text());
  assert.equal(state.lastSavedAtMs,clock);
  assert.ok(delays.length>=3,'start, poll and step must space control rewrites');
  assert.ok(delays.every(ms=>ms>=1100&&ms<=1150),'each same-key write must be delayed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM legacy_cleanup_backups').get().n,0);
  f.db.close();
});

test('D1 metadata redirect fails closed without forwarding the token or beginning export',async()=>{
  const f=fixture();
  let calls=0;
  const svc=createPrivateMultipartBackup({
    partBytes:256,controlWriteSpacingMs:0,
    fetchImpl:async(url,options)=>{
      calls++;
      assert.equal(options.method,'GET');
      assert.equal(options.redirect,'manual');
      assert.match(String(url),/api\.cloudflare\.com/);
      return new Response(null,{status:302,
        headers:{location:'https://synthetic-untrusted.invalid/redirect'}});
    }
  });
  await assert.rejects(svc.start(f.env),error=>{
    assert.deepEqual(safeMultipartStartError(error),{
      stage:'check_d1_size',reason:'cloudflare_http_other'
    });
    return true;
  });
  assert.equal(calls,1,'a redirect must not trigger a follow-up request');
  assert.equal(f.objects.size,0,'no R2 progress reservation');
  assert.equal(f.events.filter(x=>x.startsWith('export')).length,0);
  f.db.close();
});

test('signed SQL range probe and later part requests reject 302 without following',async()=>{
  for(const at of ['probe','part']){
    const f=fixture();
    let signedCalls=0,redirects=0;
    const svc=createPrivateMultipartBackup({
      partBytes:256,controlWriteSpacingMs:0,
      fetchImpl:async(url,options)=>{
        assert.equal(options.redirect,'manual');
        if(String(url).startsWith('https://signed.cloudflarestorage.com/')){
          signedCalls++;
          if(at==='probe'||signedCalls===2){
            redirects++;
            return new Response(null,{status:302,
              headers:{location:'https://synthetic-untrusted.invalid/redirect'}});
          }
        }
        return f.api(url,options);
      }
    });
    assert.equal((await svc.start(f.env)).status,'exporting');
    if(at==='probe'){
      await assert.rejects(svc.poll(f.env),/multipart_source_byte_ranges_unsupported/);
      assert.equal(f.events.includes('create'),false);
    }else{
      assert.equal((await svc.poll(f.env)).status,'uploading');
      await assert.rejects(svc.step(f.env),/multipart_source_range_denied_or_expired/);
      assert.equal(f.events.some(x=>x.startsWith('part:')),false);
    }
    assert.equal(redirects,1);
    assert.equal(signedCalls,at==='probe'?1:2,'never follow to a different host');
    f.db.close();
  }
});
