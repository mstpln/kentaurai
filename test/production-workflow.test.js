import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/production-d1-migrations.yml', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/production-release-v060.yml', import.meta.url), 'utf8');
const buildsPolicy = readFileSync(new URL('../scripts/cloudflare-builds-policy.mjs', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('production migration workflow is manual and main-only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_PRODUCTION_MIGRATIONS/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
});

test('production migration workflow uses Cloudflare repository configuration without embedding credential values', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN:\s*['\"]?[A-Za-z0-9_-]{20,}['\"]?\s*$/m);
  assert.doesNotMatch(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*['\"]?[a-f0-9]{32}['\"]?\s*$/mi);
});

test('production migration workflow keeps Cloudflare credentials out of checkout and QA steps', () => {
  const checkoutBlock = workflow.slice(workflow.indexOf('- name: Checkout'), workflow.indexOf('- name: Use Node.js 22'));
  const qaBlock = workflow.slice(workflow.indexOf('- name: Run QA before production change'), workflow.indexOf('- name: Validate Cloudflare configuration'));
  assert.doesNotMatch(checkoutBlock, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(qaBlock, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
});

test('production migration workflow runs QA before the remote migration', () => {
  const qa = workflow.indexOf('npm run qa');
  const migrate = workflow.indexOf('npm run db:migrate:remote');
  assert.ok(qa >= 0, 'QA step missing');
  assert.ok(migrate >= 0, 'remote migration step missing');
  assert.ok(qa < migrate, 'QA must run before the production migration');
});

test('production migration workflow pins third-party actions to immutable commit SHAs', () => {
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
});

test('production migration workflow prevents overlapping database writes', () => {
  assert.match(workflow, /kentaurai-production-d1-migrations/);
  assert.match(workflow, /cancel-in-progress: false/);
});


test('production release disables direct Cloudflare Git promotion before migrations', () => {
  const promotionGate = releaseWorkflow.indexOf('Enforce single production promotion path');
  const migrate = releaseWorkflow.indexOf('Apply pending production migrations');
  assert.ok(promotionGate >= 0, 'Cloudflare promotion gate step missing');
  assert.ok(migrate >= 0, 'production migration step missing');
  assert.ok(promotionGate < migrate, 'Cloudflare promotion gate must run before production migrations');
  assert.match(releaseWorkflow, /CLOUDFLARE_BUILDS_API_TOKEN/);
  assert.match(releaseWorkflow, /scripts\/cloudflare-builds-policy\.mjs --apply/);
  assert.match(releaseWorkflow, /secrets\.CLOUDFLARE_BUILDS_API_TOKEN \|\| secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(buildsPolicy, /npx wrangler versions upload/);
  assert.match(buildsPolicy, /single_release_promotion_path_v1/);
  assert.match(buildsPolicy, /builds\/workers\/.*\/triggers/);
  assert.match(buildsPolicy, /builds\/triggers\/.*PATCH|method: 'PATCH'/s);
});

test('production release validates and deploys Cloudflare usage runtime secrets without logging values', () => {
  const validate = releaseWorkflow.indexOf('Validate read-only Cloudflare usage access');
  const migrate = releaseWorkflow.indexOf('Apply pending production migrations');
  const deploy = releaseWorkflow.indexOf('Deploy Worker');
  const verifyBindings = releaseWorkflow.indexOf('Verify deployed usage secret bindings');
  assert.ok(validate >= 0, 'usage credential validation step missing');
  assert.ok(migrate >= 0, 'migration step missing');
  assert.ok(deploy >= 0, 'deploy step missing');
  assert.ok(verifyBindings >= 0, 'usage binding verification step missing');
  assert.ok(validate < migrate, 'usage credentials must be validated before production migration');
  assert.ok(deploy < verifyBindings, 'runtime binding verification must follow deployment');
  assert.match(releaseWorkflow, /secrets\.CLOUDFLARE_USAGE_API_TOKEN/);
  assert.match(releaseWorkflow, /KentaurAiUsageCredentialProbe\(\\\$accountTag: string!, \\\$date: Date\)/);
  assert.match(releaseWorkflow, /billable-usage"/);
  assert.match(releaseWorkflow, /--secrets-file "\$runtime_secrets_file"/);
  assert.match(releaseWorkflow, /workers\/scripts\/kentaurai-api\/secrets\/\$secret_name/);
  assert.match(releaseWorkflow, /d\?\.result\?\.type!==['"]secret_text['"]/);
  assert.doesNotMatch(releaseWorkflow, /echo\s+["']?\$CLOUDFLARE_USAGE_API_TOKEN/);
  assert.doesNotMatch(releaseWorkflow, /cat\s+["']?\$runtime_secrets_file/);
  assert.match(wrangler, /"secrets"\s*:\s*\{[\s\S]*"required"\s*:\s*\[[\s\S]*"CLOUDFLARE_ACCOUNT_ID"[\s\S]*"CLOUDFLARE_USAGE_API_TOKEN"[\s\S]*\][\s\S]*\}/);
});

test('production release verifies required migrations and private observability routes', () => {
  assert.match(releaseWorkflow, /0034_settings_alert_acknowledgements\.sql/);
  assert.match(releaseWorkflow, /settings_alert_acknowledgements/);
  assert.match(releaseWorkflow, /0045_storage_cleanup_sessions\.sql/);
  assert.match(releaseWorkflow, /0046_snapshot_observation_lookup_index\.sql/);
  assert.match(releaseWorkflow, /0047_storage_cleanup_session_audits\.sql/);
  assert.match(releaseWorkflow, /0048_live_pending_cost_indexes\.sql/);
  assert.match(releaseWorkflow, /SELECT name FROM sqlite_master WHERE type='table' AND name IN \('storage_cleanup_sessions','storage_cleanup_session_targets','storage_cleanup_session_audits'\)/);
  assert.match(releaseWorkflow, /storage_cleanup_sessions/);
  assert.match(releaseWorkflow, /storage_cleanup_session_targets/);
  assert.match(releaseWorkflow, /storage_cleanup_session_audits/);
  assert.match(releaseWorkflow, /idx_storage_cleanup_sessions_one_running_source/);
  assert.match(releaseWorkflow, /idx_official_snapshot_observations_snapshot_lookup/);
  assert.match(releaseWorkflow, /idx_storage_cleanup_session_audits_source/);
  assert.match(releaseWorkflow, /idx_source_records_live_game_pending/);
  assert.match(releaseWorkflow, /idx_import_runs_live_normalize_failures/);
  assert.match(releaseWorkflow, /\/app\/api\/settings\/status/);
  assert.match(releaseWorkflow, /\/app\/api\/settings\/alerts'/);
  assert.match(releaseWorkflow, /\/app\/api\/settings\/alerts\/acknowledge/);
  assert.match(releaseWorkflow, /\/v1\/storage-cleanup\/audit/);
  assert.match(releaseWorkflow, /\/v1\/storage-cleanup\/session\/audit/);
  assert.match(releaseWorkflow, /\/v1\/storage-cleanup\/session\/start/);
  assert.match(releaseWorkflow, /\/v1\/storage-cleanup\/session\/checkpoint/);
});
