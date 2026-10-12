import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';

const workflow=readFileSync(new URL(
  '../.github/workflows/production-historical-recovery.yml',import.meta.url
),'utf8');
const runner=readFileSync(new URL(
  '../scripts/run-production-historical-recovery.mjs',import.meta.url
),'utf8');
const sql=readFileSync(new URL(
  '../migrations/0068_historical_source_provenance_recovery.sql',import.meta.url
),'utf8');

test('historical restore workflow requires manual approval and exact released main',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/type: choice/);
  assert.match(workflow,/options:\s*\n\s+- inventory\s*\n\s+- backup\s*\n\s+- execute/);
  assert.match(workflow,/RESTORE_VERIFIED_SNAPSHOTS_ONLY/);
  assert.match(workflow,/BACKUP_D1_ONLY/);
  assert.match(workflow,/inputs\.mode == 'backup'/);
  assert.match(workflow,/steps\.initialize\.outputs\.backup_verified == 'true'/);
  assert.doesNotMatch(workflow,/inputs\.mode == 'execute' && steps\.backup\.outputs\.backup_verified/);
  assert.match(runner,/recovery_execute_needs_separately_completed_backup/);
  assert.match(runner,/recovery_backup_cannot_run_restore_steps/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/production-release-v060\.yml\/runs/);
  assert.match(workflow,/test ".+\$releases".*= "\$GITHUB_SHA"/);
  assert.match(workflow,/npm run qa/);
  assert.match(workflow,/group: kentaurai-production-operation/);
  assert.match(workflow,/actions: write/);
  assert.match(workflow,/cancel-in-progress: false/);
});

test('recovery credential preflight verifies the real status route, not only auth-check',()=>{
  const preflight=workflow.split('name: Wait for recovery route credential propagation')[1]
    .split('name: Begin or resume private recovery run')[0];
  assert.match(preflight,/\/v1\/storage-cleanup\/auth-check/);
  assert.match(preflight,/\/v1\/storage-cleanup\/restoration\/run\/status/);
  assert.match(preflight,/confirmed=\$\(\(confirmed \+ 1\)\)/);
  assert.match(preflight,/\[ "\$confirmed" -ge 2 \]/);
  assert.match(preflight,/historical_recovery_not_authorized_or_unavailable/);
  assert.doesNotMatch(preflight,/ADMIN_TOKEN|echo.*CLEANUP_TOKEN/);
  assert.match(runner,/fetchPrivateRecoveryJson/);
  assert.doesNotMatch(runner,/authorization:'Bearer '\+TOKEN/);
});

test('backup is streamed from Cloudflare API to private Cloudflare R2, not via GitHub runner',()=>{
  assert.match(workflow,/Enable separate backup-only Cloudflare export/);
  assert.match(workflow,/HISTORICAL_BACKUP_API_TOKEN/);
  assert.match(workflow,/HISTORICAL_RECOVERY_ACCOUNT_ID/);
  assert.match(workflow,/RUNNER_PHASE: backup/);
  assert.match(workflow,/steps\.initialize\.outputs\.backup_verified == 'true'/);
  assert.doesNotMatch(workflow,/wrangler@[\d.]+ d1 export/);
  assert.doesNotMatch(workflow,/wrangler@[\d.]+ r2 object get/);
  assert.doesNotMatch(workflow,/upload-artifact/);
  assert.doesNotMatch(workflow,/database\.sql|database\.sqlite|base64.*backup/i);
});

test('restore capability is minted after confirmed backup and deleted in all exit paths',()=>{
  const backupStep=workflow.indexOf('id: backup');
  const writeStep=workflow.indexOf('id: write_token');
  assert.ok(backupStep>0&&writeStep>backupStep);
  assert.match(workflow,/secret put HISTORICAL_REPAIR_ENABLED/);
  assert.match(workflow,/secret put HISTORICAL_REPAIR_TOKEN/);
  assert.match(workflow,/secret put HISTORICAL_REPAIR_EXPIRES_AT/);
  assert.match(workflow,/HISTORICAL_REPAIR_TOKEN HISTORICAL_REPAIR_EXPIRES_AT/);
  assert.match(workflow,/secret delete "\$name"/);
  assert.match(workflow,/if: \$\{\{ always\(\) && steps\.read_token\.outcome != 'skipped' \}\}/);
  assert.match(workflow,/Automatically resume unfinished private work/);
  assert.match(workflow,/if: \$\{\{ success\(\)/);
  assert.match(workflow,/next > 160/);
  assert.match(runner,/MAX_STEPS=360/);
  assert.match(runner,/MAX_MS=11\*60\*1000/);
  assert.doesNotMatch(runner,/console\.log\(body|process\.stdout\.write\(JSON\.stringify\(report\)/);
});

test('schema and persistent mutation fence cover all four source and identity families',()=>{
  const f=createTestEnv();
  const tables=f.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'historical_recovery_%'"
  ).all().map(r=>r.name);
  assert.deepEqual(tables.sort(),[
    'historical_recovery_epoch','historical_recovery_receipts','historical_recovery_runs'
  ]);
  for(const table of [
    'source_records','official_snapshot_source_sync','official_snapshot_observations',
    'horse_profile_snapshots','horse_stat_snapshots','horse_record_snapshots',
    'person_stat_snapshots','horse_external_ids','driver_external_ids','trainer_external_ids'
  ]){
    for(const op of ['insert','update','delete']){
      const name='historical_recovery_epoch_'+table+'_'+op;
      const row=f.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?"
      ).get(name);
      assert.ok(row,'missing revision fence: '+name);
    }
  }
  assert.match(sql,/phase IN \('inventory','ready','applying','verify_pending'\)/);
  assert.match(sql,/CREATE UNIQUE INDEX idx_historical_recovery_one_active/);
  assert.match(sql,/backup_etag TEXT/);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM horse_profile_snapshots/i);
});
