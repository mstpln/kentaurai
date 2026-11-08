// Read-only metadata check for the separately approved multipart backup.
// This script does NOT start Cloudflare D1 export or upload to R2.
import { inspectLegacyBackupCapacity } from './check-legacy-backup-capacity.mjs';
import { appendFileSync } from 'node:fs';

export const MAX_MULTIPART_SOURCE_DB_BYTES=32*1024**3;
export async function inspectMultipartCapacity(options){
  const r=await inspectLegacyBackupCapacity(options);
  if(!Number.isSafeInteger(r.d1FileSizeBytes)||
     r.d1FileSizeBytes<1024||
     r.d1FileSizeBytes>MAX_MULTIPART_SOURCE_DB_BYTES)
    throw Error('multipart_source_db_size_exceeds_reviewed_limit');
  return {mode:'read_only_multipart_backup_capacity',
    databaseGiB:r.d1FileSizeGiB,
    sourceSizeBytes:r.d1FileSizeBytes,
    multipartSourceSizeCapBytes:MAX_MULTIPART_SOURCE_DB_BYTES,
    actualSqlExportSizeUnknown:true,
    noDataMutation:true,noExportStarted:true,noDataDeletion:true};
}
if(process.argv[1]?.endsWith('/check-legacy-multipart-capacity.mjs')){
  try{
    const r=await inspectMultipartCapacity({
      accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken:process.env.CLOUDFLARE_API_TOKEN
    });
    console.log(JSON.stringify(r));
    if(process.env.GITHUB_STEP_SUMMARY){
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '## Large private backup metadata preflight\n\n'+
        '- D1 database: '+r.databaseGiB+' GiB\n'+
        '- Conservative D1 source limit: 32 GiB\n'+
        '- Exported SQL bytes: unknown until D1 export finishes\n'+
        '- Private multipart only, no SQL read or data deletion at this step\n\n');
    }
  }catch{
    console.error('multipart_capacity_preflight_failed_closed');
    process.exitCode=1;
  }
}
