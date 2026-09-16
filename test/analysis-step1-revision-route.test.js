import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v069.js';

const REVISION_URL = 'https://example.test/v1/analysis-step1-revision/private-probe';
const PROMPT_URL = 'https://example.test/v1/analysis-step1-revision-prompt?provider=openai';

test('D3 revision route rejects missing and invalid admin auth before DB work', async () => {
  const missing = await worker.fetch(new Request(REVISION_URL), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthorized');

  const invalid = await worker.fetch(new Request(REVISION_URL, { headers: { authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error, 'unauthorized');
});

test('D3 revision routes fail closed when ADMIN_TOKEN is not configured', async () => {
  for (const url of [REVISION_URL, PROMPT_URL]) {
    const response = await worker.fetch(new Request(url), {}, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'service_unavailable');
  }
});

test('D3 revision prompt route returns the market-blind affected-leg-only prompt with valid admin auth', async () => {
  const response = await worker.fetch(new Request(PROMPT_URL, { headers: { authorization: 'Bearer synthetic-secret' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revision_version, 'step1-revision-v1-d3');
  assert.match(body.prompt, /kentaurai-step1-revision-v1/);
  assert.match(body.prompt, /Reanalyse only the listed affected_legs/);
  assert.match(body.prompt, /Do not browse the web/);
});
