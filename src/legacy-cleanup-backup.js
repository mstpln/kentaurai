// Backup-only Cloudflare D1 -> private R2 export. No deletion, restoration,
// GitHub runner download, user-facing source IDs or raw SQL output.
const PREFIX='backups/legacy-cleanup/';
const MAX_SINGLE_R2_OBJECT_BYTES=5*1024*1024*1024;
const FRESH_TOKEN_MS=60*60*1000;
const DATABASE_ID='d8189e0e-6127-4ef2-88cc-534cb2217340';

function validSha(s){return typeof s==='string' && /^[a-f0-9]{40}$/.test(s);}
function validBookmark(s){return typeof s==='string' && /^[A-Za-z0-9_-]{16,180}$/.test(s);}
function validUuid(s){return typeof s==='string' && /^[0-9a-f-]{36}$/.test(s);}
function safeInt(n){return Number.isSafeInteger(n) && n>=0;}
function envOk(env){
  if(!env?.DB?.prepare||!env?.RAW_BUCKET?.head||!env?.RAW_BUCKET?.put ||
     env.PREVIEW_DATA_MODE==='synthetic'||!validSha(env.KENTAURAI_DEPLOY_SHA))
    throw new Error('legacy_backup_private_bindings_unavailable');
}
export function legacyBackupCapability(request,env,now=Date.now()){
  const token=String(env?.STORAGE_CLEANUP_TOKEN||'');
  const [issued,random,extra]=token.split('.');
  const start=Number(issued);
  return env?.LEGACY_BACKUP_ENABLED==='true' &&
    token.length>=48 && !extra &&
    random?.length>=32 && Number.isSafeInteger(start) &&
    start<=now && now-start<=FRESH_TOKEN_MS &&
    request.headers.get('authorization')==='Bearer '+token &&
    token!==env?.ADMIN_TOKEN;
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
  try{
    response=await fetchImpl(exportEndpoint(env),{
      method:'POST',redirect:'error',
      headers:{'authorization':'Bearer '+env.HISTORICAL_BACKUP_API_TOKEN,
        'content-type':'application/json'},
      body:JSON.stringify(body)
    });
  }catch{throw new Error('legacy_backup_export_transport_failed');}
  if(!response?.ok)throw new Error('legacy_backup_export_http_failed');
  let data;
  try{data=await response.json();}catch{throw new Error('legacy_backup_export_invalid_response');}
  const result=data?.result;
  if(data?.success!==true||!result ||result.success===false ||
     data.errors?.length || result.status==='error' ||
     (result.error!=null && result.error!=='') ||
     (result.type!=null && result.type!=='export') ||
     !validBookmark(result.at_bookmark))
    throw new Error('legacy_backup_export_unverified');
  if(result.status==='complete'&&!result.result?.signed_url)
    throw new Error('legacy_backup_export_unsigned_completion');
  if(result.status!=='complete' && (result.result?.signed_url||result.signed_url))
    throw new Error('legacy_backup_export_ambiguous_state');
  return result;
}
function publicStatus(row,verified=false){
  return {
    mode:'private_legacy_backup_only',
    status:row.status,
    backupVerified:verified,
    sizeBytes:row.status==='complete'?Number(row.object_size):null,
    sourceSha:row.source_sha,
    rawPayloadReturned:false,
    dataDeletionEnabled:false
  };
}
async function latest(env){
  return env.DB.prepare('SELECT * FROM legacy_cleanup_backups ORDER BY rowid DESC LIMIT 1').first();
}
async function verifyComplete(env,row){
  if(row.status!=='complete'||!validBookmark(row.bookmark)||!validUuid(row.id)||
    row.object_key!==PREFIX+row.id+'/'+row.bookmark+'.sql' ||
    typeof row.object_etag!=='string'||row.object_etag.length<8 ||
    !safeInt(Number(row.object_size))||Number(row.object_size)<1024)
    throw new Error('legacy_backup_receipt_unverified');
  const head=await env.RAW_BUCKET.head(row.object_key);
  if(!head || Number(head.size)!==Number(row.object_size) ||
     head.etag!==row.object_etag ||
     head.customMetadata?.backupBookmark!==row.bookmark ||
     head.customMetadata?.legacyBackupRunId!==row.id)
    throw new Error('legacy_backup_r2_receipt_invalid');
}
export async function getLegacyBackupStatus(env){
  envOk(env);
  const row=await latest(env);
  if(!row) return {mode:'private_legacy_backup_only',status:'none',
    backupVerified:false,rawPayloadReturned:false,dataDeletionEnabled:false};
  if(row.source_sha!==env.KENTAURAI_DEPLOY_SHA)
    throw new Error('legacy_backup_different_deployment');
  if(row.status==='complete')await verifyComplete(env,row);
  return publicStatus(row,row.status==='complete');
}
export async function beginLegacyBackup(env,{fetchImpl=fetch}={}){
  envOk(env);
  const active=await env.DB.prepare(
    "SELECT * FROM legacy_cleanup_backups WHERE status='exporting' LIMIT 1"
  ).first();
  if(active){
    if(active.source_sha!==env.KENTAURAI_DEPLOY_SHA)
      throw new Error('legacy_backup_previous_deployment_active');
    return publicStatus(active);
  }
  const result=await d1Export(env,{output_format:'polling'},fetchImpl);
  const id=crypto.randomUUID();
  const inserted=await env.DB.prepare(
    "INSERT INTO legacy_cleanup_backups(id,source_sha,bookmark,status) VALUES (?,?,?,'exporting')"
  ).bind(id,env.KENTAURAI_DEPLOY_SHA,result.at_bookmark).run();
  if(Number(inserted.meta?.changes)!==1)throw new Error('legacy_backup_receipt_insert_failed');
  return publicStatus({id,status:'exporting',source_sha:env.KENTAURAI_DEPLOY_SHA});
}
function allowedSignedUrl(s){
  if(typeof s!=='string'||s.length>4096)return false;
  try {
    const url=new URL(s);
    return url.protocol==='https:'&&!url.username&&!url.password &&
      (/(^|\.)cloudflare\.com$/i.test(url.hostname) ||
       /(^|\.)cloudflarestorage\.com$/i.test(url.hostname) ||
       /(^|\.)r2\.dev$/i.test(url.hostname));
  }catch{return false;}
}
export async function pollLegacyBackup(env,{fetchImpl=fetch}={}){
  envOk(env);
  const row=await env.DB.prepare(
    "SELECT * FROM legacy_cleanup_backups WHERE status='exporting' LIMIT 1"
  ).first();
  if(!row){
    const recent=await latest(env);
    if(!recent||recent.status!=='complete')throw new Error('legacy_backup_not_started');
    if(recent.source_sha!==env.KENTAURAI_DEPLOY_SHA)
      throw new Error('legacy_backup_different_deployment');
    await verifyComplete(env,recent);
    return publicStatus(recent,true);
  }
  if(row.source_sha!==env.KENTAURAI_DEPLOY_SHA ||
     !validBookmark(row.bookmark)||!validUuid(row.id))
    throw new Error('legacy_backup_active_run_invalid');
  const state=await d1Export(env,
    {output_format:'polling',current_bookmark:row.bookmark},fetchImpl);
  if(state.at_bookmark!==row.bookmark)
    throw new Error('legacy_backup_bookmark_changed');
  if(state.status!=='complete')return publicStatus(row);
  if(!allowedSignedUrl(state.result?.signed_url))
    throw new Error('legacy_backup_signed_url_refused');
  let download;
  try{download=await fetchImpl(state.result.signed_url,{redirect:'error'});}
  catch{throw new Error('legacy_backup_download_unavailable');}
  if(!download?.ok||!download.body)throw new Error('legacy_backup_download_failed');
  const contentType=download.headers.get('content-type')||'';
  if(/^\s*(text\/html|application\/json)(?:\s*;|\s*$)/i.test(contentType))
    throw new Error('legacy_backup_not_sql_export');
  const length=download.headers.get('content-length');
  const bytes=length!=null && /^\d+$/.test(length)?Number(length):NaN;
  if(!safeInt(bytes)||bytes<1024||bytes>MAX_SINGLE_R2_OBJECT_BYTES)
    throw new Error('legacy_backup_size_unsupported');
  const key=PREFIX+row.id+'/'+row.bookmark+'.sql';
  const existing=await env.RAW_BUCKET.head(key);
  if(!existing) {
    await env.RAW_BUCKET.put(key,download.body,{
      httpMetadata:{contentType:'application/sql'},
      customMetadata:{backupBookmark:row.bookmark,legacyBackupRunId:row.id}
    });
  }else if(existing.size!==bytes ||
      existing.customMetadata?.backupBookmark!==row.bookmark ||
      existing.customMetadata?.legacyBackupRunId!==row.id) {
    throw new Error('legacy_backup_r2_object_conflict');
  }
  const head=await env.RAW_BUCKET.head(key);
  if(!head||Number(head.size)!==bytes||
    typeof head.etag!=='string'||head.etag.length<8||
    head.customMetadata?.backupBookmark!==row.bookmark||
    head.customMetadata?.legacyBackupRunId!==row.id)
    throw new Error('legacy_backup_r2_write_unverified');
  const committed=await env.DB.prepare(
    "UPDATE legacy_cleanup_backups SET status='complete',object_key=?,object_etag=?,"+
    "object_size=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='exporting' AND bookmark=? AND source_sha=?"
  ).bind(key,head.etag,bytes,row.id,row.bookmark,row.source_sha).run();
  if(Number(committed.meta?.changes)!==1)
    throw new Error('legacy_backup_receipt_commit_failed');
  const final=await latest(env);
  await verifyComplete(env,final);
  return publicStatus(final,true);
}
