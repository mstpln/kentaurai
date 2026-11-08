// Backup-only Cloudflare D1 -> private R2 export. D1 exports can block
// all D1 queries until completion, so live progress resides exclusively in
// private R2. D1 receives a verified receipt only AFTER export completion.
// No deletion, restore route, runner SQL download or public object identifier.
const PREFIX='backups/legacy-cleanup/';
const CONTROL_KEY=PREFIX+'.active-export-control.json';
const MAX_SINGLE_R2_OBJECT_BYTES=5*1024*1024*1024;
const FRESH_TOKEN_MS=60*60*1000;
const DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';

function validSha(s){return typeof s==='string' && /^[a-f0-9]{40}$/.test(s);}
function validBookmark(s){return typeof s==='string' && /^[A-Za-z0-9_-]{16,180}$/.test(s);}
function validUuid(s){return typeof s==='string' && /^[0-9a-f-]{36}$/.test(s);}
function safeInt(n){return Number.isSafeInteger(n) && n>=0;}
function envOk(env){
  if(!env?.DB?.prepare||!env?.RAW_BUCKET?.head||!env?.RAW_BUCKET?.get||
     !env?.RAW_BUCKET?.put||env.PREVIEW_DATA_MODE==='synthetic'||
     !validSha(env.KENTAURAI_DEPLOY_SHA))
    throw new Error('legacy_backup_private_bindings_unavailable');
}
export function legacyBackupCapability(request,env,now=Date.now()){
  const token=String(env?.LEGACY_BACKUP_TOKEN||'');
  const [issued,random,extra]=token.split('.');
  const start=Number(issued);
  return env?.LEGACY_BACKUP_ENABLED==='true' &&
    token.length>=48 && !extra && random?.length>=32 &&
    Number.isSafeInteger(start) && start<=now && now-start<=FRESH_TOKEN_MS &&
    request.headers.get('authorization')==='Bearer '+token &&
    token!==env?.ADMIN_TOKEN && token!==env?.STORAGE_CLEANUP_TOKEN;
}
function exportEndpoint(env){
  const account=String(env.HISTORICAL_RECOVERY_ACCOUNT_ID||'');
  if(!/^[a-f0-9]{32}$/.test(account) ||
     env.HISTORICAL_RECOVERY_DATABASE_ID!==DATABASE_ID ||
     typeof env.HISTORICAL_BACKUP_API_TOKEN!=='string' ||
     env.HISTORICAL_BACKUP_API_TOKEN.length<32)
    throw new Error('legacy_backup_export_credentials_unavailable');
  return 'https://api.cloudflare.com/client/v4/accounts/'+account+
    '/d1/database/'+DATABASE_ID+'/export';
}
async function d1Export(env,body,fetchImpl){
  let response;
  try {
    response=await fetchImpl(exportEndpoint(env),{
      method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+env.HISTORICAL_BACKUP_API_TOKEN,
        'content-type':'application/json'},
      body:JSON.stringify(body)
    });
  }catch{throw new Error('legacy_backup_export_transport_failed');}
  if(!response?.ok)throw new Error('legacy_backup_export_http_failed');
  let data;
  try{data=await response.json();}catch{throw new Error('legacy_backup_export_invalid_response');}
  const result=data?.result;
  if(data?.success!==true||!result||result.success===false||
     data.errors?.length||result.status==='error'||
     (result.error!=null&&result.error!=='')||
     (result.type!=null&&result.type!=='export')||
     !validBookmark(result.at_bookmark))
    throw new Error('legacy_backup_export_unverified');
  if(result.status==='complete'&&!result.result?.signed_url)
    throw new Error('legacy_backup_export_unsigned_completion');
  if(result.status!=='complete'&&(result.result?.signed_url||result.signed_url))
    throw new Error('legacy_backup_export_ambiguous_state');
  return result;
}
function validateControl(s){
  if(!s||!validUuid(s.id)||!validSha(s.sourceSha)||
     !['starting','exporting','stored','complete'].includes(s.status))
    throw new Error('legacy_backup_control_invalid');
  if(s.status!=='starting'&&!validBookmark(s.bookmark))
    throw new Error('legacy_backup_bookmark_invalid');
  if(['stored','complete'].includes(s.status)){
    if(s.objectKey!==PREFIX+s.id+'/'+s.bookmark+'.sql' ||
      typeof s.objectEtag!=='string'||s.objectEtag.length<8||
      !safeInt(s.sizeBytes)||s.sizeBytes<1024||
      s.sizeBytes>MAX_SINGLE_R2_OBJECT_BYTES)
      throw new Error('legacy_backup_stored_control_invalid');
  }
  return s;
}
async function readControl(env){
  const object=await env.RAW_BUCKET.get(CONTROL_KEY);
  if(!object)return null;
  if(!safeInt(Number(object.size))||Number(object.size)>4096)
    throw new Error('legacy_backup_control_size_invalid');
  let state;
  try{state=JSON.parse(await object.text());}
  catch{throw new Error('legacy_backup_control_json_invalid');}
  return validateControl(state);
}
async function saveControl(env,s){
  validateControl(s);
  await env.RAW_BUCKET.put(CONTROL_KEY,JSON.stringify(s),{
    httpMetadata:{contentType:'application/json'},
    customMetadata:{scope:'legacy_backup_control'}
  });
}
function publicStatus(state,verified=false){
  return {
    mode:'private_legacy_backup_only',
    status:state.status==='complete'?'complete':'exporting',
    backupVerified:verified,
    sizeBytes:verified?state.sizeBytes:null,
    sourceSha:state.sourceSha,
    rawPayloadReturned:false,
    dataDeletionEnabled:false
  };
}
function noBackupStatus(){
  return {mode:'private_legacy_backup_only',status:'none',
    backupVerified:false,rawPayloadReturned:false,dataDeletionEnabled:false};
}
async function verifyStoredR2(env,s){
  const head=await env.RAW_BUCKET.head(s.objectKey);
  if(!head||Number(head.size)!==s.sizeBytes||
     head.etag!==s.objectEtag||
     head.customMetadata?.backupBookmark!==s.bookmark||
     head.customMetadata?.legacyBackupRunId!==s.id)
    throw new Error('legacy_backup_r2_receipt_invalid');
}
// This query is *only* used after the signed export reports complete.
async function verifyD1Receipt(env,s){
  const row=await env.DB.prepare(
    'SELECT * FROM legacy_cleanup_backups WHERE id=? LIMIT 1'
  ).bind(s.id).first();
  if(!row||row.status!=='complete'||row.source_sha!==s.sourceSha||
     row.bookmark!==s.bookmark||row.object_key!==s.objectKey||
     row.object_etag!==s.objectEtag||Number(row.object_size)!==s.sizeBytes)
    throw new Error('legacy_backup_d1_receipt_invalid');
}
export async function getLegacyBackupStatus(env){
  envOk(env);
  const state=await readControl(env); // Never query D1 during an export.
  if(!state)return noBackupStatus();
  if(state.sourceSha!==env.KENTAURAI_DEPLOY_SHA){
    // A finished backup belongs to its original deployment, not to new code.
    if(state.status==='complete')return noBackupStatus();
    throw new Error('legacy_backup_previous_deployment_active');
  }
  if(state.status==='complete'){
    await verifyStoredR2(env,state);
    await verifyD1Receipt(env,state);
  }
  return publicStatus(state,state.status==='complete');
}
export async function beginLegacyBackup(env,{fetchImpl=fetch}={}){
  envOk(env);
  const prior=await readControl(env);
  if(prior && prior.status!=='complete'){
    if(prior.sourceSha!==env.KENTAURAI_DEPLOY_SHA)
      throw new Error('legacy_backup_previous_deployment_active');
    return publicStatus(prior);
  }
  const reservation={id:crypto.randomUUID(),
    sourceSha:env.KENTAURAI_DEPLOY_SHA,status:'starting'};
  // Reserve in private R2 before the export can block D1. The manual
  // production-operation lock serializes authorized workflow dispatches.
  await saveControl(env,reservation);
  const result=await d1Export(env,{output_format:'polling'},fetchImpl);
  const active={...reservation,status:'exporting',bookmark:result.at_bookmark};
  await saveControl(env,active);
  return publicStatus(active);
}
function allowedSignedUrl(s){
  if(typeof s!=='string'||s.length>4096)return false;
  try{
    const url=new URL(s);
    return url.protocol==='https:'&&!url.username&&!url.password &&
      (/(^|\.)cloudflare\.com$/i.test(url.hostname)||
       /(^|\.)cloudflarestorage\.com$/i.test(url.hostname)||
       /(^|\.)r2\.dev$/i.test(url.hostname));
  }catch{return false;}
}
async function finalizeStored(env,s){
  await verifyStoredR2(env,s);
  // D1 has become available again after export finished; record an immutable
  // completion receipt, tolerating an ambiguous previous INSERT response.
  const existing=await env.DB.prepare(
    'SELECT id FROM legacy_cleanup_backups WHERE id=? LIMIT 1'
  ).bind(s.id).first();
  if(!existing){
    const write=await env.DB.prepare(
      'INSERT INTO legacy_cleanup_backups'+
      '(id,source_sha,bookmark,object_key,object_etag,object_size,status,completed_at)'+
      " VALUES (?,?,?,?,?,?,'complete',CURRENT_TIMESTAMP)"
    ).bind(s.id,s.sourceSha,s.bookmark,s.objectKey,s.objectEtag,s.sizeBytes).run();
    if(Number(write.meta?.changes)!==1)
      throw new Error('legacy_backup_receipt_commit_failed');
  }
  await verifyD1Receipt(env,s);
  const done={...s,status:'complete'};
  await saveControl(env,done);
  return publicStatus(done,true);
}
export async function pollLegacyBackup(env,{fetchImpl=fetch}={}){
  envOk(env);
  const state=await readControl(env); // R2-only until Cloudflare export completes.
  if(!state)throw new Error('legacy_backup_not_started');
  if(state.sourceSha!==env.KENTAURAI_DEPLOY_SHA)
    throw new Error('legacy_backup_different_deployment');
  if(state.status==='starting')
    throw new Error('legacy_backup_start_uncertain_manual_review_required');
  if(state.status==='complete'){
    await verifyStoredR2(env,state);
    await verifyD1Receipt(env,state);
    return publicStatus(state,true);
  }
  if(state.status==='stored')return finalizeStored(env,state);
  const result=await d1Export(env,
    {output_format:'polling',current_bookmark:state.bookmark},fetchImpl);
  if(result.at_bookmark!==state.bookmark)
    throw new Error('legacy_backup_bookmark_changed');
  if(result.status!=='complete')return publicStatus(state);
  if(!allowedSignedUrl(result.result?.signed_url))
    throw new Error('legacy_backup_signed_url_refused');
  let download;
  try{download=await fetchImpl(result.result.signed_url,{redirect:'error'});}
  catch{throw new Error('legacy_backup_download_unavailable');}
  if(!download?.ok||!download.body)throw new Error('legacy_backup_download_failed');
  const contentType=download.headers.get('content-type')||'';
  if(/^\s*(text\/html|application\/json)(?:\s*;|\s*$)/i.test(contentType))
    throw new Error('legacy_backup_not_sql_export');
  const length=download.headers.get('content-length');
  const bytes=length!=null&&/^\d+$/.test(length)?Number(length):NaN;
  if(!safeInt(bytes)||bytes<1024||bytes>MAX_SINGLE_R2_OBJECT_BYTES)
    throw new Error('legacy_backup_size_unsupported');
  const key=PREFIX+state.id+'/'+state.bookmark+'.sql';
  const existing=await env.RAW_BUCKET.head(key);
  if(!existing){
    await env.RAW_BUCKET.put(key,download.body,{
      httpMetadata:{contentType:'application/sql'},
      customMetadata:{backupBookmark:state.bookmark,legacyBackupRunId:state.id}
    });
  }else if(Number(existing.size)!==bytes ||
     existing.customMetadata?.backupBookmark!==state.bookmark||
     existing.customMetadata?.legacyBackupRunId!==state.id)
    throw new Error('legacy_backup_r2_object_conflict');
  const head=await env.RAW_BUCKET.head(key);
  if(!head||Number(head.size)!==bytes||
     typeof head.etag!=='string'||head.etag.length<8||
     head.customMetadata?.backupBookmark!==state.bookmark||
     head.customMetadata?.legacyBackupRunId!==state.id)
    throw new Error('legacy_backup_r2_write_unverified');
  const stored={...state,status:'stored',objectKey:key,
    objectEtag:head.etag,sizeBytes:bytes};
  await saveControl(env,stored);
  return finalizeStored(env,stored);
}
