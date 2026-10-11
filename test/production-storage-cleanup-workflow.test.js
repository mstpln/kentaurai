import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manual production storage cleanup is read-only, source-bound and bounded per operation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-storage-cleanup.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  const qaStep = workflow.split('      - name: Run QA before production operation\\n')[1]
    ?.split('\\n      - name: ')[0] ?? '';
  assert.match(qaStep, /run: npm run qa/);
  for (const variable of [
    'CLEANUP_TRIGGER_CONFIRMATION',
    'CLEANUP_AUDIT_RUN_ID',
    'CLEANUP_SESSION_ID',
    'CLEANUP_CONTINUATION_REQUEST'
  ]) {
    assert.ok(qaStep.includes(variable + ': ""'),
      variable + ' must not contaminate the QA subprocesses of an automated continuation');
  }
  assert.match(workflow, /options:\s*\n\s*- dry-run/);
  assert.doesNotMatch(workflow, /^\s+- execute\s*$/m);
  assert.match(workflow, /if: \$\{\{ inputs\.mode == 'dry-run' \}\}/);
  assert.doesNotMatch(workflow, /mode:\s*['"]?execute['"]?|mode == 'execute'|Queue controlled continuation/);
  assert.match(workflow, /group: kentaurai-production-operation/);
  assert.match(workflow, /deploymentSha == \$expected/);
  assert.match(workflow, /Remove any orphaned previous cleanup-only Worker token/);
  assert.match(workflow, /STORAGE_CLEANUP_TOKEN/);
  assert.match(workflow, /wrangler@4\.114\.0 secret put STORAGE_CLEANUP_TOKEN/);
  assert.match(workflow, /secret delete STORAGE_CLEANUP_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.ADMIN_TOKEN|secrets\.KENTAURAI_ADMIN_TOKEN/);
  assert.match(workflow, /time_travel\/bookmark/);
  assert.match(workflow, /Wait for cleanup auth to propagate/);
  assert.match(workflow, /storage-cleanup\/auth-check/);
  assert.match(workflow, /seq 1 15/);
  assert.match(workflow, /concurrency:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /CLEANUP_SOFT_DEADLINE_MS: "2100000"/);
  assert.match(workflow, /CLEANUP_RUN_MAX_ROWS_READ: "1000000"/);
  assert.match(workflow, /CLEANUP_RUN_MAX_ROWS_WRITTEN: "100000"/);
  assert.match(workflow, /Refuse unsafe or stalled read-only audit/);
  assert.match(workflow, /cost_budget_stop/);
  assert.match(workflow, /queue_read_only:/);
  assert.match(workflow, /needs: cleanup/);
  assert.match(workflow, /Queue next bounded READ-ONLY audit continuation/);
  assert.match(workflow, /Queue next bounded READ-ONLY audit continuation/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /Require exact deployed main/);
  assert.match(workflow, /production-release-v060\.yml\/runs\?branch=main&status=success&per_page=1/);
  assert.match(workflow, /deployed_sha.*GITHUB_SHA/s);
  assert.match(workflow, /continuation_session:/);
  assert.match(workflow, /CLEANUP_SESSION_ID:/);
  assert.match(workflow, /continuation_request:/);
  assert.match(workflow, /format\('continuation from \{0\}', inputs\.continuation_request\)/);
  assert.match(workflow, /Verify production health after cleanup run[\s\S]*always\(\) && steps\.worker\.outcome == 'success'/);

  assert.match(runner, /DRY_RUN_MAX_BATCHES > 250/);
  assert.match(runner, /while \(MODE === 'execute' \|\| runPages < DRY_RUN_MAX_BATCHES\)/);
  assert.match(runner, /while \(MODE === 'execute' \|\| runBatches < DRY_RUN_MAX_BATCHES\)/);
  assert.match(runner, /storage-cleanup\/audit/);
  assert.match(runner, /storage-cleanup\/session\/audit/);
  assert.match(runner, /storage cleanup integrity audit failed; refusing cleanup|storage cleanup session integrity audit failed; refusing cleanup/);
  assert.match(runner, /storage-cleanup\/session\/start/);
  assert.match(runner, /storage-cleanup\/session\/checkpoint/);
  assert.match(runner, /GITHUB_SHA/);
  assert.match(runner, /continuation limit reached before completion/);
  assert.match(runner, /deadlineReached\(\)/);
  assert.match(runner, /limit: 25/);
  assert.match(runner, /safetyStop === true/);
  assert.match(runner, /execution count differed from its dry-run plan/);
  assert.match(runner, /response\.status === 401/);
  assert.match(runner, /attempt <= 15/);
  assert.doesNotMatch(runner, /storage-cleanup\/state/);
  assert.doesNotMatch(runner, /historical_all|backfill|repair/i);
});

test('GitHub dry-run continuation puts the audit ID first and recovers accidental session entry', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-storage-cleanup.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url), 'utf8');
  const auditIndex = workflow.indexOf('      continuation_audit:');
  const sessionIndex = workflow.indexOf('      continuation_session:');
  assert.ok(auditIndex > 0 && sessionIndex > auditIndex, 'Audit-ID field must precede execute-only session field');
  assert.match(workflow, /UNUSED: always leave blank/);
  assert.match(workflow, /Validate cleanup continuation fields before costly work/);
  assert.match(workflow, /Dry-run has two IDs/);
  assert.match(runner, /recoveredMisfiledAuditId = MODE === 'dry-run'/);
  assert.match(runner, /audit_run_id: error\.auditRunId/);
  assert.match(runner, /error\?\.cleanupReason === 'audit_already_running'/);
  assert.match(runner, /safeResetReasons\.has\(error\?\.cleanupReason\)/);
  assert.match(runner, /MODE !== 'dry-run' \|\| AUTOMATED_READ_ONLY_CONTINUATION/);
  assert.match(runner, /\|\| !CLEANUP_AUDIT_RUN_ID \|\| !safeResetReasons\.has/);
  assert.doesNotMatch(workflow, /schedule:/);
});


test('read-only audit successor runs in a separate job after the shared production lock is released', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-storage-cleanup.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/production-release-v060.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url), 'utf8');
  const dispatch = readFileSync(new URL('../scripts/queue-production-storage-audit.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /run-name:.*continuation from \{0\}/);
  assert.match(workflow, /continuation_request:/);
  assert.match(workflow, /group: kentaurai-production-operation/);
  assert.match(release, /group: kentaurai-production-operation/);
  assert.match(release, /KENTAURAI_DEPLOY_SHA:process\.env\.GITHUB_SHA/);
  assert.match(release, /h\.deploymentSha!==process\.env\.GITHUB_SHA/);
  assert.match(workflow, /output[s]?:[\s\S]*audit_incomplete:/);
  assert.match(workflow, /queue_read_only:\n\s+name:/);
  assert.match(workflow, /needs: cleanup/);
  assert.match(workflow, /needs\.cleanup\.result == 'success'/);
  assert.match(workflow, /needs\.cleanup\.outputs\.progress_made == 'true'/);
  assert.match(workflow, /needs\.cleanup\.outputs\.cost_budget_stop != 'true'/);
  assert.match(workflow, /needs\.cleanup\.outputs\.audit_safety_stop != 'true'/);
  assert.match(workflow, /Refuse a changed main or a different deployed release/);
  assert.match(workflow, /Queue next bounded READ-ONLY audit continuation/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /CLEANUP_CONTINUATION_REQUEST: \$\{\{ inputs\.continuation_request \}\}/);
  assert.doesNotMatch(workflow, /\[ -n "\$\{\{ inputs\.continuation_request \}\}" \]/);
  assert.match(workflow, /Remove short-lived cleanup-only Worker token[\s\S]*Verify production health after cleanup run[\s\S]*queue_read_only:/);
  assert.match(workflow, /always\(\) && steps\.cleanup_token\.outcome != 'skipped'/);
  assert.match(runner, /AUTOMATED_READ_ONLY_CONTINUATION/);
  assert.match(runner, /audit_safety_stop=/);
  assert.match(runner, /audit_continuation_count=/);
  assert.match(runner, /audit_expires_at=/);
  assert.match(dispatch, /mode: 'dry-run'/);
  assert.match(dispatch, /confirmation: READ_ONLY_MARKER/);
  assert.match(dispatch, /continuation_session: ''/);
  assert.match(dispatch, /run\?\.status === 'in_progress'/);
  assert.doesNotMatch(dispatch, /if \(run\?\.status === 'queued'/);
  assert.doesNotMatch(workflow, /schedule:/);
});
