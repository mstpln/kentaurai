import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/production-release-v060.yml',import.meta.url),'utf8');
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('only production deploy CLI is updated and remains pinned to explicit Wrangler release',()=>{
  assert.equal(pkg.scripts.deploy,'npx --yes wrangler@4.149.0 deploy');
  assert.equal(pkg.scripts['db:migrate:remote'],'npx --yes wrangler@4.114.0 d1 migrations apply kentaurai --remote');
});
test('production deployment tolerates only reviewed Cloudflare GET response errors',()=>{
  const block=workflow.slice(workflow.indexOf('      - name: Deploy Worker'),workflow.indexOf('      - name: Verify deployed usage secret bindings'));
  assert.match(block,/for attempt in 1 2 3/);
  assert.match(block,/Received a malformed response from the API/);
  assert.match(block,/GET \/accounts\/\[\^ \]\+\/workers\/scripts\/\[\^ \]\+\/deployments -> 200 OK/);
  assert.match(block,/504 Gateway Timeout/);
  assert.match(block,/Unclassified Wrangler deployment failure; stopping without retry/);
  assert.match(block,/Wrangler error does not match a reviewed transient GET response; stopping/);
  assert.match(block,/Cloudflare control-plane API failed all three bounded deploy attempts/);
  assert.match(block,/npm run deploy -- --secrets-file "\$runtime_secrets_file"/);
  assert.match(block,/test "\$deployed" = true \|\| exit 1/);
  assert.match(block,/worker_url=.*grep -Eo/);
  assert.doesNotMatch(block,/cat.*runtime_secrets_file|echo.*CLOUDFLARE_API_TOKEN/);
  const deployedVer=workflow.slice(workflow.indexOf('Verify deployed public health endpoint'));
  assert.match(deployedVer,/h.deploymentSha!==process.env.GITHUB_SHA/);
  assert.match(deployedVer,/Expected exact deployment SHA and health contract verified/);
});
