import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/production-release-v060.yml', import.meta.url), 'utf8');

test('production release requires and atomically deploys Cloudflare usage bindings', () => {
  assert.match(workflow, /CLOUDFLARE_USAGE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_USAGE_API_TOKEN \}\}/);
  assert.match(workflow, /KENTAURAI_CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(workflow, /wrangler@4\.114\.0 deploy --secrets-file/);
  assert.match(workflow, /kentaurai-runtime-secrets\.json/);
  assert.doesNotMatch(workflow, /wrangler(?:@[^ ]+)? secret put/);
  assert.doesNotMatch(workflow, /wrangler(?:@[^ ]+)? versions secret put/);
});

test('production release verifies the new Drift routes remain private', () => {
  assert.match(workflow, /\/app\/api\/settings\/automation/);
  assert.match(workflow, /\/app\/api\/settings\/cloudflare-usage/);
  assert.match(workflow, /Expected \/app\/api\/settings\/automation POST to return 401/);
  assert.match(workflow, /0049_automation_controls\.sql/);
});
