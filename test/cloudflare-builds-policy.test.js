import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NON_PROMOTING_DEPLOY_COMMAND,
  enforceCloudflareBuildsPolicy,
  selectProductionTrigger,
  selectWorkerScript
} from '../scripts/cloudflare-builds-policy.mjs';

function jsonResponse(result, { status = 200, success = true, errors = [] } = {}) {
  return new Response(JSON.stringify({ success, result, errors }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function productionTrigger(deployCommand = 'npx wrangler deploy') {
  return {
    trigger_uuid: '11111111-1111-4111-8111-111111111111',
    trigger_name: 'Production Deploy',
    branch_includes: ['main'],
    branch_excludes: [],
    deploy_command: deployCommand,
    repo_connection: {
      provider_type: 'github',
      repo_name: 'kentaurai'
    }
  };
}

test('selectWorkerScript requires the exact KentaurAI Worker identity', () => {
  const selected = selectWorkerScript([
    { id: 'other-worker', tag: 'other-tag' },
    { id: 'kentaurai-api', tag: 'kentaurai-tag' }
  ]);
  assert.equal(selected.tag, 'kentaurai-tag');

  assert.throws(
    () => selectWorkerScript([{ id: 'other-worker', tag: 'other-tag' }]),
    /expected exactly one Cloudflare Worker script named kentaurai-api; found 0/
  );
});

test('selectProductionTrigger chooses the exact main trigger for the KentaurAI GitHub repo', () => {
  const preview = {
    ...productionTrigger(NON_PROMOTING_DEPLOY_COMMAND),
    trigger_uuid: '22222222-2222-4222-8222-222222222222',
    branch_includes: ['*'],
    branch_excludes: ['main']
  };
  const selected = selectProductionTrigger([preview, productionTrigger()]);
  assert.equal(selected.trigger_uuid, '11111111-1111-4111-8111-111111111111');

  assert.throws(
    () => selectProductionTrigger([productionTrigger(), productionTrigger()]),
    /multiple Cloudflare production build triggers/
  );
});

test('apply mode converts the production Git trigger to version upload and verifies it', async () => {
  const calls = [];
  let trigger = productionTrigger();

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body || null });
    if (url.endsWith('/workers/scripts')) {
      return jsonResponse([{ id: 'kentaurai-api', tag: 'kentaurai-tag' }]);
    }
    if (url.endsWith('/builds/workers/kentaurai-tag/triggers')) {
      return jsonResponse([trigger]);
    }
    if (url.includes('/builds/triggers/') && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { deploy_command: NON_PROMOTING_DEPLOY_COMMAND });
      trigger = { ...trigger, deploy_command: body.deploy_command };
      return jsonResponse(trigger);
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await enforceCloudflareBuildsPolicy({
    fetchImpl,
    token: 'synthetic-token',
    accountId: 'synthetic-account',
    mode: 'apply'
  });

  assert.deepEqual(result, {
    policy: 'single_release_promotion_path_v1',
    compliant: true,
    updated: true,
    workerName: 'kentaurai-api',
    productionBranch: 'main',
    deployCommand: NON_PROMOTING_DEPLOY_COMMAND
  });
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.equal(calls.at(-1).method, 'GET');
});

test('already compliant production Git trigger is a no-op', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/workers/scripts')) {
      return jsonResponse([{ id: 'kentaurai-api', tag: 'kentaurai-tag' }]);
    }
    if (url.endsWith('/builds/workers/kentaurai-tag/triggers')) {
      return jsonResponse([productionTrigger(NON_PROMOTING_DEPLOY_COMMAND)]);
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await enforceCloudflareBuildsPolicy({
    fetchImpl,
    token: 'synthetic-token',
    accountId: 'synthetic-account',
    mode: 'apply'
  });

  assert.equal(result.updated, false);
  assert.equal(result.compliant, true);
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

test('check mode fails closed when Cloudflare Git can still promote production', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/workers/scripts')) {
      return jsonResponse([{ id: 'kentaurai-api', tag: 'kentaurai-tag' }]);
    }
    if (url.endsWith('/builds/workers/kentaurai-tag/triggers')) {
      return jsonResponse([productionTrigger()]);
    }
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    () => enforceCloudflareBuildsPolicy({
      fetchImpl,
      token: 'synthetic-token',
      accountId: 'synthetic-account',
      mode: 'check'
    }),
    /production Git trigger can promote directly/
  );
});

test('Cloudflare API failures stay sanitized', async () => {
  const fetchImpl = async () => jsonResponse(null, {
    status: 403,
    success: false,
    errors: [{ code: 9109, message: 'permission denied for Bearer abc.secret.value' }]
  });

  await assert.rejects(
    () => enforceCloudflareBuildsPolicy({
      fetchImpl,
      token: 'abc.secret.value',
      accountId: 'synthetic-account',
      mode: 'check'
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /Bearer \[redacted\]/);
      assert.doesNotMatch(error.message, /abc\.secret\.value/);
      return true;
    }
  );
});
