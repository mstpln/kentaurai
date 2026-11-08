// Manual-only, bounded runner: private SQL and signed export link never
// enter GitHub runner. The runner sees aggregate progress only.
import { fetchPrivateRecoveryJson } from './private-recovery-http.mjs';
import { appendFileSync } from 'node:fs';

const origin=process.env.WORKER_URL,token=process.env.CLEANUP_TOKEN;
const mode=process.env.MULTIPART_BACKUP_MODE||'resume_only';
const sha=process.env.GITHUB_SHA;
if(!origin?.startsWith('https://')||!token||!/^[a-f0-9]{40}$/.test(sha)||
   !['start_or_resume','resume_only'].includes(mode))
  throw Error('multipart_runner_configuration_invalid');
const endpoint=origin+'/v1/storage-cleanup/legacy-backup-multipart/';
const call=(name,method='GET')=>fetchPrivateRecoveryJson({
  url:endpoint+name,token,method,body:method==='POST'?{}:null
});
function checked(v){
  if(!v||v.mode!=='private_multipart_backup_only'||
     v.rawPayloadReturned!==false||v.dataDeletionEnabled!==false||
     !['none','starting','exporting','initializing',
       'uploading','stored','complete'].includes(v.status)||
     (v.sourceSha!=null&&v.sourceSha!==sha))
    throw Error('multipart_runner_unexpected_private_status');
  return v;
}
let current=checked(await call('status'));
if(current.status==='none'||current.status==='complete'){
  if(mode==='resume_only')
    throw Error('multipart_runner_no_active_backup_to_resume');
  current=checked(await call('start','POST'));
}else if(current.status==='uploading'){
  // Signed D1 URLs are valid for one hour. A subsequent run may request
  // a refreshed URL ONLY if the export bookmark and object path match.
  current=checked(await call('refresh','POST'));
}
const deadline=Date.now()+7*60*1000;
let steps=0;
while(Date.now()<deadline&&steps<900){
  if(current.status==='complete'&&current.backupVerified===true)break;
  if(current.status==='starting'||current.status==='initializing')
    throw Error('multipart_ambiguous_start_requires_manual_review');
  if(current.status==='exporting'){
    current=checked(await call('poll','POST'));
    steps++;
    if(current.status==='exporting')
      await new Promise(r=>setTimeout(r,5000));
  }else if(current.status==='uploading'){
    if(current.totalParts==null||!Number.isSafeInteger(current.totalParts)||
       !Number.isSafeInteger(current.partsUploaded)||
       current.partsUploaded>current.totalParts)
      throw Error('multipart_runner_missing_part_counter');
    current=checked(await call(current.partsUploaded===current.totalParts?
      'finalize':'step','POST'));
    steps++;
  }else if(current.status==='stored'){
    current=checked(await call('finalize','POST'));steps++;
  }else throw Error('multipart_runner_unknown_progress');
}
if(process.env.GITHUB_STEP_SUMMARY){
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Private D1 multipart backup (manual only)\n\n'+
    '- Status: '+current.status+'\n'+
    '- Complete and verified receipt: '+(current.backupVerified===true)+'\n'+
    '- Uploaded parts: '+current.partsUploaded+' / '+(current.totalParts??'unknown')+'\n'+
    '- Total source SQL bytes: '+(current.totalBytes??'not measured')+'\n'+
    '- Source deployment: '+(current.sourceSha||'unknown')+'\n'+
    '- Private racing records sent to GitHub: 0\n'+
    '- Racing data deleted: 0\n'+
    '- A successful R2 upload alone is **not** an independent restore test.\n\n');
}
if(current.status!=='complete'||current.backupVerified!==true)
  throw Error('multipart_incomplete_resume_manually_after_credential_cleanup');
console.log(JSON.stringify({event:'private_multipart_backup_receipt_verified',
  sourceSha:sha,totalBytes:current.totalBytes,partsUploaded:current.partsUploaded,
  deletionEnabled:false,restoreProven:false}));
