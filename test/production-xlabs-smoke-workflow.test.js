import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/production-xlabs-smoke.yml', import.meta.url), 'utf8');

test('production X-Labs smoke workflow is manual, main-only and explicitly confirmed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /RUN XLABS SMOKE 2026-09-06/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
});

test('production X-Labs smoke is fixed to one date and one checkpoint', () => {
  assert.match(workflow, /2026-09-06/);
  const inputBlock = workflow.slice(workflow.indexOf('workflow_dispatch:'), workflow.indexOf('\npermissions:'));
  assert.doesNotMatch(inputBlock, /start_date:|end_date:/);
  assert.equal((workflow.match(/\/v1\/xlabs\/backfill\/step/g) || []).length, 1);
  assert.doesNotMatch(workflow, /while\s|for\s+\w+\s+in|seq\s/);
});

test('production X-Labs smoke inspects state before create or resume', () => {
  const status = workflow.indexOf('/v1/xlabs/backfill/status?job_id=');
  const start = workflow.indexOf('/v1/xlabs/backfill/start');
  const step = workflow.indexOf('/v1/xlabs/backfill/step');
  assert.ok(status >= 0 && start > status && step > start);
});

test('production X-Labs smoke uses only the repository secret and does not expose responses', () => {
  assert.match(workflow, /secrets\.ADMIN_TOKEN/);
  assert.match(workflow, /::add-mask::\$ADMIN_TOKEN/);
  assert.doesNotMatch(workflow, /ADMIN_TOKEN:\s*['"]?[A-Za-z0-9_-]{20,}['"]?\s*$/m);
  assert.doesNotMatch(workflow, /cat\s+\$?\w*file|tee\s|set\s+-x/);
});

test('production X-Labs smoke runs QA before secrets enter scope', () => {
  const qa = workflow.indexOf('npm run qa');
  const operation = workflow.indexOf('ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}');
  assert.ok(qa >= 0 && operation > qa);
  const qaBlock = workflow.slice(workflow.indexOf('- name: Run QA'), workflow.indexOf('- name: Run one bounded'));
  assert.doesNotMatch(qaBlock, /ADMIN_TOKEN/);
});

test('production X-Labs smoke requires sanitized job and import-run evidence', () => {
  assert.match(workflow, /processed_races >= 1/);
  assert.match(workflow, /neutral_unavailable=/);
  assert.match(workflow, /import_run_recorded=/);
  assert.match(workflow, /consecutive_errors/);
});

test('production X-Labs smoke pins third-party actions and prevents overlap', () => {
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.match(workflow, /kentaurai-production-xlabs-smoke-2026-09-06/);
  assert.match(workflow, /cancel-in-progress: false/);
});
