// Private Cloudflare-only large D1 backup. This is intentionally a separate
// backup capability, not a generic cleanup or source-record deletion tool.
// Export may lock D1: no D1 queries until Cloudflare reports completion.
// Only bounded HTTP Range reads are accepted; signed URLs and SQL never leave
// private Worker/R2. A real restore test is required before ANY deletion.
const PREFIX='backups/legacy-cleanup-multipart/';
const CONTROL_KEY=PREFIX+'.active-v1.json';
const DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';
export const MULTIPART_PART_BYTES=16*1024*1024;
export const MULTIPART_MAX_BYTES=64*1024*1024*1024;
const MAX_D1_DB_BYTES=32*1024*1024*1024;
const MAX_PARTS=4096;
const TOKEN_LIFETIME_MS=60*60*1000;
const CONTROL_MAX_BYTES=2*1024*1024;

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/.test(s);
const bookmark=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{16,180}$/.test(s);
const etag=s=>typeof s==='string'&&s.length>=3&&s.length<=180&&!/[\r\n]/.test(s);
const hash=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const expectedKey=s=>PREFIX+s.id+'/'+s.bookmark+'.sql';
function safeEnv(env){
  if(!env?.DB?.prepare||!env?.RAW_BUCKET?.put||!env?.RAW_BUCKET?.get||
     !env?.RAW_BUCKET?.head||!env?.RAW_BUCKET?.createMultipartUpload||
     !env?.RAW_BUCKET?.resumeMultipartUpload||env.PREVIEW_DATA_MODE==='synthetic'||
     !sha(env.KENTAURAI_DEPLOY_SHA))
    throw Error('multipart_private_bindings_unavailable');
}
export function multipartBackupCapability(request,env,now=Date.now()){
  const token=String(env?.LEGACY_MULTIPART_BACKUP_TOKEN||'');
  const [issued,nonce,extra]=token.split('.');
  const created=Number(issued);
  return env?.LEGACY_MULTIPART_BACKUP_ENABLED==='true'&&
    token.length>=48&&!extra&&nonce?.length>=32&&Number.isSafeInteger(created)&&
    created<=now&&now-created<=TOKEN_LIFETIME_MS&&
    request.headers.get('authorization')==='Bearer '+token&&
    token!==env?.ADMIN_TOKEN&&token!==env?.STORAGE_CLEANUP_TOKEN&&
    token!==env?.LEGACY_BACKUP_TOKEN;
}
// Diagnosis is a DIFFERENT capability. It can read only the sanitized
// private R2 progress state; it cannot start, poll, upload or finalize.
export function multipartDiagnosticCapability(request,env,now=Date.now()){
  const token=String(env?.LEGACY_MULTIPART_DIAG_TOKEN||'');
  const [issued,nonce,extra]=token.split('.');
  const created=Number(issued);
  return env?.LEGACY_MULTIPART_DIAG_ENABLED==='true'&&
    request.method==='GET'&&
    token.length>=48&&!extra&&nonce?.length>=32&&Number.isSafeInteger(created)&&
    created<=now&&now-created<=TOKEN_LIFETIME_MS&&
    request.headers.get('authorization')==='Bearer '+token&&
    token!==env?.ADMIN_TOKEN&&token!==env?.STORAGE_CLEANUP_TOKEN&&
    token!==env?.LEGACY_BACKUP_TOKEN&&
    token!==env?.LEGACY_MULTIPART_BACKUP_TOKEN;
}

export function safeMultipartStartError(error){
  if(!(error instanceof MultipartStartFailure))return null;
  return {stage:error.stage,reason:error.reason};
}
// Closed dictionary only; never print the underlying Cloudflare error body,
// token, account identifier, R2 key, SQL, signed URL or network exception.
function safeMultipartFailureReason(error){
  const message=String(error?.message||'');
  const upstream=/^multipart_cloudflare_http_(400|401|403|404|409|423|429|500|502|503|504|other)$/.exec(message);
  if(upstream)return 'cloudflare_http_'+upstream[1];
  const codes={
    multipart_cloudflare_response_unverified:'cloudflare_response_unverified',
    multipart_cloudflare_json_invalid:'cloudflare_json_invalid',
    multipart_cloudflare_transport_unavailable:'transport_unavailable',
    multipart_export_credentials_unavailable:'credentials_unavailable',
    multipart_export_response_unverified:'export_response_unverified',
    multipart_source_size_out_of_bounds:'source_size_out_of_bounds',
    multipart_private_bindings_unavailable:'private_bindings_unavailable'
  };
  return codes[message]||'internal_operation_failed';
}
class MultipartStartFailure extends Error {
  constructor(stage,source){
    super('multipart_start_failed');
    this.stage=stage;
    this.reason=safeMultipartFailureReason(source);
  }
}

function credentials(env){
  const account=String(env.HISTORICAL_RECOVERY_ACCOUNT_ID||'');
  if(!/^[a-f0-9]{32}$/.test(account)||
     env.HISTORICAL_RECOVERY_DATABASE_ID!==DATABASE_ID||
     typeof env.HISTORICAL_BACKUP_API_TOKEN!=='string'||
     env.HISTORICAL_BACKUP_API_TOKEN.length<32)
    throw Error('multipart_export_credentials_unavailable');
  return {account,token:env.HISTORICAL_BACKUP_API_TOKEN};
}
function signedUrl(s){
  if(typeof s!=='string'||s.length>4096)return false;
  try {
    const u=new URL(s);
    return u.protocol==='https:'&&!u.username&&!u.password&&
      (/(^|\.)cloudflare\.com$/i.test(u.hostname)||
       /(^|\.)cloudflarestorage\.com$/i.test(u.hostname)||
       /(^|\.)r2\.dev$/i.test(u.hostname));
  }catch{return false;}
}
function sourceLocation(s){
  const u=new URL(s);return u.origin+u.pathname;
}
async function cloudflare(env,path,method,body,fetchImpl){
  const c=credentials(env);
  const url='https://api.cloudflare.com/client/v4/accounts/'+c.account+
    '/d1/database/'+DATABASE_ID+path;
  let response;
  try {response=await fetchImpl(url,{method,redirect:'error',
    headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw Error('multipart_cloudflare_transport_unavailable');}
  if(!response?.ok){
    const code=Number(response?.status);
    const allowed=[400,401,403,404,409,423,429,500,502,503,504];
    throw Error('multipart_cloudflare_http_'+(allowed.includes(code)?code:'other'));
  }
  let data;
  try{data=await response.json();}catch{throw Error('multipart_cloudflare_json_invalid');}
  if(data?.success!==true||data.errors?.length)throw Error('multipart_cloudflare_response_unverified');
  return data.result;
}
async function verifySizeBeforeExport(env,fetchImpl){
  const info=await cloudflare(env,'?fields=uuid,file_size','GET',null,fetchImpl);
  if(info?.uuid!==DATABASE_ID||!integer(info.file_size)||
     info.file_size<1024||info.file_size>MAX_D1_DB_BYTES)
    throw Error('multipart_source_size_out_of_bounds');
}
// Independent diagnostic: a single Cloudflare D1 database-metadata GET.
// No SQL, D1 bindings, R2 reads/writes, export POST or download is allowed.
export async function inspectMultipartD1Metadata(env,{fetchImpl=fetch}={}){
  const base={
    mode:'private_multipart_metadata_only',
    d1Queried:false,exportStarted:false,r2Modified:false,
    dataDeleted:false,rawPayloadReturned:false
  };
  if(env?.PREVIEW_DATA_MODE==='synthetic'||!sha(env?.KENTAURAI_DEPLOY_SHA))
    return {...base,status:'failed',reason:'private_bindings_unavailable'};
  try{
    await verifySizeBeforeExport(env,fetchImpl);
    return {...base,status:'verified',reason:'none'};
  }catch(error){
    return {...base,status:'failed',reason:safeMultipartFailureReason(error)};
  }
}
async function exportPolling(env,body,fetchImpl){
  const r=await cloudflare(env,'/export','POST',body,fetchImpl);
  if(!r||!bookmark(r.at_bookmark)||r.error||r.status==='error'||
     (r.type!=null&&r.type!=='export')||
     (r.status==='complete'&&!signedUrl(r.result?.signed_url))||
     (r.status!=='complete'&&r.result?.signed_url))
    throw Error('multipart_export_response_unverified');
  return r;
}
function validate(state,partBytes){
  // The R2 manifest is repeatedly written to one key. Its persisted write
  // timestamp permits a cross-request per-key pacing guard.
  if(state?.lastSavedAtMs!=null&&!integer(state.lastSavedAtMs))
    throw Error('multipart_control_timestamp_invalid');
  if(!state||!uuid(state.id)||!sha(state.sourceSha)||
     !['starting','exporting','initializing','uploading','stored','complete'].includes(state.status))
    throw Error('multipart_control_invalid');
  if(state.status!=='starting'&&!bookmark(state.bookmark))
    throw Error('multipart_control_bookmark_invalid');
  if(['uploading','stored','complete'].includes(state.status)){
    if(!integer(state.totalBytes)||state.totalBytes<1024||
      state.totalBytes>MULTIPART_MAX_BYTES||state.partBytes!==partBytes||
      !etag(state.sourceEtag)||!signedUrl(state.signedUrl)||
      state.objectKey!==expectedKey(state)||!Array.isArray(state.parts)||
      state.parts.length>MAX_PARTS||typeof state.uploadId!=='string'||
      state.uploadId.length<8)
      throw Error('multipart_control_upload_invalid');
    const expected=Math.ceil(state.totalBytes/partBytes);
    if(expected>MAX_PARTS||state.parts.length>expected)
      throw Error('multipart_control_part_count_invalid');
    for(let i=0;i<state.parts.length;i++){
      const p=state.parts[i];
      const bytes=Math.min(partBytes,state.totalBytes-i*partBytes);
      if(p.number!==i+1||!etag(p.etag)||!hash(p.sha256)||p.bytes!==bytes)
        throw Error('multipart_control_part_invalid');
    }
    if(['stored','complete'].includes(state.status)&&
      (state.parts.length!==expected||!etag(state.objectEtag)))
      throw Error('multipart_control_stored_invalid');
  }
  return state;
}
async function readControl(env,partBytes){
  const item=await env.RAW_BUCKET.get(CONTROL_KEY);
  if(!item)return null;
  if(!integer(item.size)||item.size>CONTROL_MAX_BYTES)
    throw Error('multipart_control_object_oversize');
  let v;
  try{v=JSON.parse(await item.text());}catch{throw Error('multipart_control_json_invalid');}
  return validate(v,partBytes);
}
export async function inspectMultipartBackupState(env,{
  partBytes=MULTIPART_PART_BYTES
}={}){
  // Read-only: no D1 query, D1 export, R2 put, secret-dependent Cloudflare
  // API call or generated SQL. Must remain usable after a later deployment.
  if(!env?.RAW_BUCKET?.get||env.PREVIEW_DATA_MODE==='synthetic'||
     !sha(env?.KENTAURAI_DEPLOY_SHA))
    throw Error('multipart_private_diagnostic_unavailable');
  const state=await readControl(env,partBytes);
  const same=state?state.sourceSha===env.KENTAURAI_DEPLOY_SHA:null;
  return {
    mode:'private_multipart_status_only',
    status:state?.status||'none',
    controlExists:!!state,
    deploymentMatches:same,
    bookmarkSaved:!!(state&&state.status!=='starting'),
    exportStartUncertain:state?.status==='starting',
    partsUploaded:Array.isArray(state?.parts)?state.parts.length:0,
    completeReceiptClaimed:state?.status==='complete',
    dataDeleted:false,
    backupExportStartedByThisCheck:false,
    d1Queried:false,
    r2Modified:false,
    rawPayloadReturned:false
  };
}

async function saveControl(env,state,partBytes,{
  gapMs=1150,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=()=>Date.now()
}={}){
  validate(state,partBytes);
  // Cloudflare R2 limits writes to the same object key to 1 per second.
  // Persist the last write time IN R2: per-isolate timers do not protect
  // successive Worker requests. The dedicated workflow is also serialized.
  const existing=await readControl(env,partBytes);
  if(existing?.lastSavedAtMs!=null){
    const wait=existing.lastSavedAtMs+gapMs-now();
    if(wait>0){
      if(wait>Math.max(5000,gapMs*2))
        throw Error('multipart_control_timestamp_clock_skew');
      await sleep(wait);
    }
  }
  const recorded={...state,lastSavedAtMs:now()};
  validate(recorded,partBytes);
  const bytes=JSON.stringify(recorded);
  if(new TextEncoder().encode(bytes).length>CONTROL_MAX_BYTES)
    throw Error('multipart_control_too_large');
  await env.RAW_BUCKET.put(CONTROL_KEY,bytes,{
    httpMetadata:{contentType:'application/json'},
    customMetadata:{scope:'legacy_private_multipart_control'}
  });
}
function publicStatus(state,partBytes){
  if(!state)return {mode:'private_multipart_backup_only',status:'none',
    complete:false,backupVerified:false,partsUploaded:0,totalParts:null,
    uploadedBytes:0,totalBytes:null,sourceSha:null,
    rawPayloadReturned:false,dataDeletionEnabled:false};
  const ready=['uploading','stored','complete'].includes(state.status);
  return {
    mode:'private_multipart_backup_only',status:state.status,
    complete:state.status==='complete',backupVerified:state.status==='complete',
    partsUploaded:ready?state.parts.length:0,
    totalParts:ready?Math.ceil(state.totalBytes/partBytes):null,
    uploadedBytes:ready?Math.min(state.totalBytes,state.parts.length*partBytes):0,
    totalBytes:ready?state.totalBytes:null,sourceSha:state.sourceSha,
    rawPayloadReturned:false,dataDeletionEnabled:false
  };
}
function versionFence(state,env){
  if(state.sourceSha!==env.KENTAURAI_DEPLOY_SHA)
    throw Error('multipart_deployment_changed_manual_review');
}
async function verifyObject(env,state){
  const head=await env.RAW_BUCKET.head(state.objectKey);
  if(!head||Number(head.size)!==state.totalBytes||
     !etag(head.etag)||
     head.customMetadata?.backupBookmark!==state.bookmark||
     head.customMetadata?.legacyBackupRunId!==state.id||
     head.customMetadata?.sourceSha!==state.sourceSha)
    throw Error('multipart_object_receipt_unverified');
  return head;
}
async function verifyD1(env,state){
  const row=await env.DB.prepare('SELECT * FROM legacy_cleanup_backups WHERE id=?')
    .bind(state.id).first();
  if(!row||row.status!=='complete'||row.source_sha!==state.sourceSha||
     row.bookmark!==state.bookmark||row.object_key!==state.objectKey||
     row.object_etag!==state.objectEtag||
     Number(row.object_size)!==state.totalBytes)
    throw Error('multipart_d1_receipt_unverified');
}
export function createPrivateMultipartBackup({partBytes=MULTIPART_PART_BYTES,
  fetchImpl=fetch,controlWriteSpacingMs=1150,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=()=>Date.now()}={}){
  // Smaller part sizes are only for synthetic tests. Public HTTP never
  // supplies this configuration; production always uses 16 MiB parts.
  if(!integer(partBytes)||partBytes<8||partBytes>MULTIPART_PART_BYTES)
    throw Error('multipart_part_size_invalid');
  if(!integer(controlWriteSpacingMs)||controlWriteSpacingMs>5000)
    throw Error('multipart_control_spacing_invalid');
  const load=env=>readControl(env,partBytes);
  const save=(env,state)=>saveControl(env,state,partBytes,{
    gapMs:controlWriteSpacingMs,sleep,now
  });
  async function status(env){
    safeEnv(env);const state=await load(env);
    if(!state)return publicStatus(null,partBytes);
    versionFence(state,env);
    if(state.status==='complete'){
      const head=await verifyObject(env,state);
      if(head.etag!==state.objectEtag)
        throw Error('multipart_object_etag_changed');
      await verifyD1(env,state);
    }
    return publicStatus(state,partBytes);
  }
  async function start(env){
    // Diagnose only the safe stage. Never retry an uncertain reservation.
    let stage='read_private_state';
    try{
      safeEnv(env);
      const previous=await load(env);
      if(previous&&previous.status!=='complete'){
        versionFence(previous,env);
        return publicStatus(previous,partBytes);
      }
      stage='check_d1_size';
      await verifySizeBeforeExport(env,fetchImpl);
      const reserved={id:crypto.randomUUID(),sourceSha:env.KENTAURAI_DEPLOY_SHA,
        status:'starting'};
      stage='reserve_private_r2';
      await save(env,reserved);
      stage='request_d1_export';
      const response=await exportPolling(env,{output_format:'polling'},fetchImpl);
      const active={...reserved,status:'exporting',bookmark:response.at_bookmark};
      stage='store_private_bookmark';
      await save(env,active);
      return publicStatus(active,partBytes);
    }catch(error){
      throw new MultipartStartFailure(stage,error);
    }
  }
  async function probeSignedUrl(url){
    if(!signedUrl(url))throw Error('multipart_signed_url_refused');
    let res;
    try{res=await fetchImpl(url,{method:'GET',redirect:'error',
      headers:{Range:'bytes=0-0','Accept-Encoding':'identity'}});}
    catch{throw Error('multipart_range_transport_failed');}
    if(res.status!==206){
      await res.body?.cancel?.();
      throw Error('multipart_source_byte_ranges_unsupported');
    }
    const m=/^bytes 0-0\/([1-9]\d*)$/.exec(res.headers.get('content-range')||'');
    const size=m?Number(m[1]):NaN;
    const sourceEtag=res.headers.get('etag');
    if(!integer(size)||size<1024||size>MULTIPART_MAX_BYTES||
       !etag(sourceEtag)||res.headers.get('content-length')!=='1'||
       (res.headers.get('content-encoding')&&!/identity/i.test(res.headers.get('content-encoding')))){
      await res.body?.cancel?.();
      throw Error('multipart_source_range_probe_invalid');
    }
    const v=new Uint8Array(await res.arrayBuffer());
    if(v.length!==1)throw Error('multipart_source_probe_length_mismatch');
    return {size,etag:sourceEtag};
  }
  async function poll(env){
    safeEnv(env);
    const state=await load(env);
    if(!state)throw Error('multipart_backup_not_started');
    versionFence(state,env);
    if(state.status!=='exporting')return publicStatus(state,partBytes);
    const response=await exportPolling(env,{
      output_format:'polling',current_bookmark:state.bookmark
    },fetchImpl);
    if(response.at_bookmark!==state.bookmark)
      throw Error('multipart_export_bookmark_changed');
    if(response.status!=='complete')return publicStatus(state,partBytes);
    const url=response.result.signed_url;
    const sample=await probeSignedUrl(url);
    if(Math.ceil(sample.size/partBytes)>MAX_PARTS)
      throw Error('multipart_export_requires_larger_parts');
    const key=expectedKey(state);
    if(await env.RAW_BUCKET.head(key))
      throw Error('multipart_backup_object_already_exists');
    // Mark initializing before a potentially ambiguous multipart creation.
    const initializing={...state,status:'initializing'};
    await save(env,initializing);
    const handle=await env.RAW_BUCKET.createMultipartUpload(key,{
      httpMetadata:{contentType:'application/sql'},
      customMetadata:{backupBookmark:state.bookmark,legacyBackupRunId:state.id,
        sourceSha:state.sourceSha}
    });
    if(typeof handle?.uploadId!=='string'||handle.uploadId.length<8)
      throw Error('multipart_upload_creation_unverified');
    const uploading={...initializing,status:'uploading',signedUrl:url,
      sourceEtag:sample.etag,totalBytes:sample.size,partBytes,objectKey:key,
      uploadId:handle.uploadId,parts:[]};
    await save(env,uploading);
    return publicStatus(uploading,partBytes);
  }
  async function refresh(env){
    safeEnv(env);
    const state=await load(env);
    if(!state||state.status!=='uploading')
      throw Error('multipart_refresh_invalid_state');
    versionFence(state,env);
    const response=await exportPolling(env,{
      output_format:'polling',current_bookmark:state.bookmark
    },fetchImpl);
    if(response.status!=='complete'||response.at_bookmark!==state.bookmark||
      !signedUrl(response.result?.signed_url)||
      sourceLocation(response.result.signed_url)!==sourceLocation(state.signedUrl))
      throw Error('multipart_export_source_changed');
    const refreshed={...state,signedUrl:response.result.signed_url};
    await save(env,refreshed);
    return publicStatus(refreshed,partBytes);
  }
  async function step(env){
    safeEnv(env);
    const state=await load(env);
    if(!state||state.status!=='uploading')
      throw Error('multipart_step_invalid_state');
    versionFence(state,env);
    const index=state.parts.length;
    const expected=Math.ceil(state.totalBytes/partBytes);
    if(index>=expected)return publicStatus(state,partBytes);
    const begin=index*partBytes,end=Math.min(state.totalBytes,(index+1)*partBytes)-1;
    const n=end-begin+1;
    let response;
    try{response=await fetchImpl(state.signedUrl,{
      method:'GET',redirect:'error',
      headers:{Range:'bytes='+begin+'-'+end,'Accept-Encoding':'identity'}
    });}catch{throw Error('multipart_source_range_transport_failed');}
    if(response.status!==206){
      await response.body?.cancel?.();
      throw Error('multipart_source_range_denied_or_expired');
    }
    if(response.headers.get('content-range')!==
       'bytes '+begin+'-'+end+'/'+state.totalBytes||
      response.headers.get('content-length')!==String(n)||
      response.headers.get('etag')!==state.sourceEtag||
      (response.headers.get('content-encoding')&&
       !/identity/i.test(response.headers.get('content-encoding')))){
      await response.body?.cancel?.();
      throw Error('multipart_range_or_source_mismatch');
    }
    // Bounded 16 MiB buffer. Never call .arrayBuffer() on the entire SQL file.
    const bytes=new Uint8Array(n),reader=response.body?.getReader();
    if(!reader)throw Error('multipart_source_body_missing');
    let offset=0;
    while(true){
      let chunk;
      try{chunk=await reader.read();}catch{throw Error('multipart_source_stream_failed');}
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array)||offset+chunk.value.length>n){
        await reader.cancel().catch(()=>{});
        throw Error('multipart_range_body_exceeded');
      }
      bytes.set(chunk.value,offset);offset+=chunk.value.length;
    }
    if(offset!==n)throw Error('multipart_source_part_truncated');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
      b=>b.toString(16).padStart(2,'0')).join('');
    const upload=env.RAW_BUCKET.resumeMultipartUpload(state.objectKey,state.uploadId);
    const uploaded=await upload.uploadPart(index+1,bytes);
    if(uploaded?.partNumber!==index+1||!etag(uploaded?.etag))
      throw Error('multipart_r2_part_unverified');
    const next={...state,parts:[...state.parts,
      {number:index+1,etag:uploaded.etag,sha256:digest,bytes:n}]};
    await save(env,next);
    return publicStatus(next,partBytes);
  }
  async function finalize(env){
    safeEnv(env);
    const state=await load(env);
    if(!state||!['uploading','stored','complete'].includes(state.status))
      throw Error('multipart_finalize_invalid_state');
    versionFence(state,env);
    const expected=Math.ceil(state.totalBytes/partBytes);
    if(state.parts.length!==expected)
      throw Error('multipart_upload_incomplete');
    let stored=state;
    if(state.status==='uploading'){
      let head=await env.RAW_BUCKET.head(state.objectKey);
      if(!head){
        const upload=env.RAW_BUCKET.resumeMultipartUpload(state.objectKey,state.uploadId);
        try{await upload.complete(state.parts.map(p=>({
          partNumber:p.number,etag:p.etag
        })));}catch {
          // Completion may have succeeded despite an ambiguous network error.
          head=await env.RAW_BUCKET.head(state.objectKey);
          if(!head)throw Error('multipart_r2_completion_unconfirmed');
        }
      }
      head=await verifyObject(env,state);
      stored={...state,status:'stored',objectEtag:head.etag};
      await save(env,stored);
    }
    const head=await verifyObject(env,stored);
    if(head.etag!==stored.objectEtag)
      throw Error('multipart_final_object_changed');
    const existing=await env.DB.prepare(
      'SELECT id FROM legacy_cleanup_backups WHERE id=?'
    ).bind(stored.id).first();
    if(!existing){
      const result=await env.DB.prepare(
        'INSERT INTO legacy_cleanup_backups'+
        '(id,source_sha,bookmark,object_key,object_etag,object_size,status,completed_at)'+
        " VALUES (?,?,?,?,?,?,'complete',CURRENT_TIMESTAMP)"
      ).bind(stored.id,stored.sourceSha,stored.bookmark,
        stored.objectKey,stored.objectEtag,stored.totalBytes).run();
      if(Number(result.meta?.changes)!==1)
        throw Error('multipart_d1_receipt_not_committed');
    }
    await verifyD1(env,stored);
    const completed={...stored,status:'complete'};
    await save(env,completed);
    return publicStatus(completed,partBytes);
  }
  return {status,start,poll,refresh,step,finalize};
}
export const privateMultipartBackup=createPrivateMultipartBackup();
