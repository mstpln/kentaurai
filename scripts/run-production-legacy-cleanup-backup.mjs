// Manual backup-only workflow client. Never transfers SQL, keys, hashes or
// private source IDs to the GitHub runner or its public logs.
import { fetchPrivateRecoveryJson } from './private-recovery-http.mjs';
import { appendFileSync } from 'node:fs';

const base=process.env.WORKER_URL;
const token=process.env.CLEANUP_TOKEN;
if(!base?.startsWith('https://')||!token)
  throw new Error('legacy_backup_client_not_configured');
const prefix=base+'/v1/storage-cleanup/legacy-backup/';
const call=(name,method='GET')=>fetchPrivateRecoveryJson({
  url:prefix+name,token,method,body:method==='POST'?{}:null
});
function check(report){
  if(report?.mode!=='private_legacy_backup_only' ||
     report.dataDeletionEnabled!==false||report.rawPayloadReturned!==false ||
     !['none','exporting','complete'].includes(report.status) ||
     report.sourceSha && report.sourceSha!==process.env.GITHUB_SHA)
    throw new Error('legacy_backup_unexpected_response');
  return report;
}
let state=check(await call('status'));
// Every separately approved manual dispatch creates a new snapshot after a
// previous completion; never reuse yesterday's backup as a fresh recovery point.
if(state.status!=='exporting')state=check(await call('start','POST'));
const until=Date.now()+7*60*1000;
let polls=0;
while(state.status==='exporting' && Date.now()<until && polls<72){
  state=check(await call('poll','POST'));
  polls++;
  if(state.status==='exporting')
    await new Promise(resolve=>setTimeout(resolve,5000));
}
if(state.status!=='complete'||state.backupVerified!==true||
   !Number.isSafeInteger(state.sizeBytes)||state.sizeBytes<1024)
  throw new Error('legacy_backup_pending_or_verification_failed');
console.log(JSON.stringify({
  event:'legacy_private_backup_verified',
  sqlBytes:state.sizeBytes,
  r2Private:true,
  d1FactsDeleted:0,
  sourceSha:state.sourceSha,
  apiRequests:polls+1
}));
if(process.env.GITHUB_STEP_SUMMARY){
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Private legacy cleanup backup\n\n'
    + 'Verified backup receipt in private Cloudflare D1 and private R2.\n\n'
    + '- Stored SQL bytes: '+state.sizeBytes+'\n'
    + '- Exact production source SHA: '+state.sourceSha+'\n'
    + '- Racing facts deleted: 0\n'
    + '- Source files, SQL, R2 keys, secrets never leave Cloudflare.\n'
    + '- This backup alone is not a restore test or deletion authorization.\n');
}
