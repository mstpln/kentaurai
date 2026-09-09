import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/production-d1-migrations.yml', import.meta.url), 'utf8');

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
