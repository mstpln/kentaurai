import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v068.js';

const LOCK_URL = 'https://example.test/v1/analysis-step1-lock/private-probe';
const PROMPT_URL = 'https://example.test/v1/analysis-step1-prompt?provider=openai';

test('D2 Step 1 lock route rejects missing and invalid admin auth before DB work', async () => {
  const missing = await worker.fetch(new Request(LOCK_URL), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthorized');

  const invalid = await worker.fetch(new Request(LOCK_URL, { headers: { authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error, 'unauthorized');
});

test('D2 Step 1 routes fail closed when ADMIN_TOKEN is not configured', async () => {
  for (const url of [LOCK_URL, PROMPT_URL]) {
    const response = await worker.fetch(new Request(url), {}, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'service_unavailable');
  }
});

test('D2 Step 1 prompt route returns the versioned market-blind prompt with valid admin auth', async () => {
  const response = await worker.fetch(new Request(PROMPT_URL, { headers: { authorization: 'Bearer synthetic-secret' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.prompt_version, 'step1-prompt-v3-d2');
  assert.match(body.prompt, /kentaurai-step1-lock-v1/);
  assert.match(body.prompt, /Do not browse the web/);
});
