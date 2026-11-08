// Read-only Cloudflare D1 size preflight. No SQL, private source IDs, raw
// racing records, R2 object keys, API tokens or account identifiers are logged.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LEGACY_BACKUP_DATABASE_ID = 'd8189e0e-6127-4ef2-88cc-534cb2217340';
export const R2_SINGLE_UPLOAD_LIMIT_BYTES = 5 * 1024 ** 3;
// A *conservative guard*, NOT a guarantee that exported SQL will fit.
// SQL dump bytes can exceed the SQLite file size. Large files need a
// separately reviewed multipart backup design before invoking D1 export.
export const LEGACY_BACKUP_DB_SIZE_GUARD_BYTES = 4 * 1024 ** 3;

function nonnegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export async function inspectLegacyBackupCapacity({
  accountId, apiToken, fetchImpl = fetch
} = {}) {
  if (!/^[a-f0-9]{32}$/.test(String(accountId || '')) ||
      typeof apiToken !== 'string' || apiToken.length < 20) {
    throw new Error('legacy_capacity_credentials_unavailable');
  }
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId +
    '/d1/database/' + LEGACY_BACKUP_DATABASE_ID + '?fields=uuid,file_size';
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error',
      headers: { authorization: 'Bearer ' + apiToken,
        accept: 'application/json' }
    });
  } catch {
    throw new Error('legacy_capacity_metadata_transport_unavailable');
  }
  if (!response?.ok) throw new Error('legacy_capacity_metadata_http_failed');
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('legacy_capacity_metadata_invalid_json'); }
  const db = payload?.result;
  if (payload?.success !== true || (payload.errors?.length ?? 0) !== 0 ||
      db?.uuid !== LEGACY_BACKUP_DATABASE_ID ||
      !nonnegativeInteger(db?.file_size)) {
    throw new Error('legacy_capacity_metadata_unverified');
  }
  return {
    mode: 'read_only_legacy_backup_capacity',
    d1FileSizeBytes: db.file_size,
    d1FileSizeGiB: Math.round(db.file_size / 1024 ** 3 * 100) / 100,
    r2SingleUploadMaxBytes: R2_SINGLE_UPLOAD_LIMIT_BYTES,
    conservativeD1SizeGuardBytes: LEGACY_BACKUP_DB_SIZE_GUARD_BYTES,
    backupEligibleBySize: db.file_size < LEGACY_BACKUP_DB_SIZE_GUARD_BYTES,
    sqlExportSizeNotMeasured: true,
    deletionAuthorized: false,
    databaseReads: 0,
    databaseWrites: 0
  };
}

async function main() {
  const report = await inspectLegacyBackupCapacity({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN
  });
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Read-only production D1 size check\n\n' +
      '- Current D1 database file size: ' + report.d1FileSizeGiB + ' GiB\n' +
      '- Conservative D1 size guard: 4 GiB (strictly below)\n' +
      '- R2 single-object PUT limit: 5 GiB\n' +
      '- Safe to attempt the existing backup by metadata size alone: ' +
        report.backupEligibleBySize + '\n\n' +
      '**Caution:** This reads only API metadata. Exported SQL may be larger ' +
      'than the underlying D1 file, so a size pass is not proof of a ' +
      'successful backup. An actual D1 export can temporarily make the ' +
      'database unavailable. No backup, data deletion, migration or R2 ' +
      'upload has started in this check.\n\n');
  }
  if (process.argv.includes('--require-backup-eligible') &&
      !report.backupEligibleBySize) {
    throw new Error('legacy_backup_large_database_requires_reviewed_multipart');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    // Deliberately never include Cloudflare response bodies or credentials.
    console.error('legacy_capacity_stopped: ' + String(error?.message || 'unknown_error'));
    process.exitCode = 1;
  });
}
