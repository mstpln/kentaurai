import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v073.js';

const PROMPT_URL = 'https://example.test/v1/analysis-step2-prompt?provider=openai';
const STEP2_URL = 'https://example.test/v1/analysis-step2/round-e3?line_price_sek=0.5&target_budget_min_sek=150&max_budget_sek=250';
const ANALYSIS_URL = 'https://example.test/v1/analysis-v3/analysisv3_probe';
const NARRATIVE_PROMPT_URL = 'https://example.test/v1/analysis-v3/analysisv3_probe/narrative-prompt';
const NARRATIVE_URL = 'https://example.test/v1/analysis-v3/analysisv3_probe/narrative';

test('E3 private admin routes reject missing auth before DB/body work', async () => {
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { throw new Error('DB must not be reached before auth'); } }
  };

  for (const [url, method] of [
    [PROMPT_URL, 'GET'],
    [STEP2_URL, 'POST'],
    [ANALYSIS_URL, 'GET'],
    [NARRATIVE_PROMPT_URL, 'GET'],
    [NARRATIVE_URL, 'POST']
  ]) {
    const response = await worker.fetch(new Request(url, { method }), env, {});
    assert.equal(response.status, 401, `${method} ${url}`);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('E3 Step 2 prompt route is versioned and contains no legacy AI system-building policy', async () => {
  const response = await worker.fetch(new Request(PROMPT_URL, {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), { ADMIN_TOKEN: 'synthetic-secret' }, {});

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.prompt_version, 'step2-prompt-v3-e3');
  assert.match(body.prompt, /kentaurai-step2-result-v1/);
  assert.match(body.prompt, /code optimizer will build the authoritative system/i);
  assert.doesNotMatch(body.prompt, /700\s*kr/i);
  assert.doesNotMatch(body.prompt, /personligt system/i);
});

test('E3 admin routes fail closed when ADMIN_TOKEN is not configured', async () => {
  for (const [url, method] of [
    [PROMPT_URL, 'GET'],
    [STEP2_URL, 'POST'],
    [ANALYSIS_URL, 'GET'],
    [NARRATIVE_PROMPT_URL, 'GET'],
    [NARRATIVE_URL, 'POST']
  ]) {
    const response = await worker.fetch(new Request(url, { method }), {}, {});
    assert.equal(response.status, 503, `${method} ${url}`);
    assert.equal((await response.json()).error, 'service_unavailable');
  }
});

test('E3 Step 2 import validates route/payload identity before authoritative integration', async () => {
  let dbCalls = 0;
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: { prepare() { dbCalls += 1; throw new Error('unexpected DB access'); } }
  };
  const payload = {
    contract_version: 'kentaurai-step2-result-v1',
    result_id: 'step2_route-test',
    round_id: 'different-round'
  };
  const response = await worker.fetch(new Request(STEP2_URL, {
    method: 'POST',
    headers: {
      authorization: 'Bearer synthetic-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  }), env, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /round_id must match route round/);
  assert.equal(dbCalls, 0);
});

test('E3 app Step 2 prompt route requires configured private session auth', async () => {
  const response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-step2-prompt?provider=openai'), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'service_unavailable');
});
