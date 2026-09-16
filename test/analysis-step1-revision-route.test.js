import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v069.js';

const REVISION_URL = 'https://example.test/v1/analysis-step1-revision/private-probe';
const PROMPT_URL = 'https://example.test/v1/analysis-step1-revision-prompt?provider=openai';
const ROOT_URL = 'https://example.test/v1/analysis-step1-lock/round-d3-root';

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

test('D3 blocks a second independent Step 1 root and directs the caller to revision lineage', async () => {
  const existing = {
    id: 'root-lock-a',
    game_round_id: 'round-d3-root',
    pack_id: 'pack-root-a',
    pack_as_of: '2026-09-16T08:00:00.000Z',
    facts_fingerprint: 'sha256:root-a',
    provider: 'openai',
    model: 'synthetic-model',
    prompt_version: 'step1-prompt-v3-d2',
    lock_hash: 'sha256:root-lock-a',
    created_at: '2026-09-16T08:01:00.000Z'
  };
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: {
      prepare() {
        return { bind() { return { first: async () => existing }; } };
      }
    }
  };
  const response = await worker.fetch(new Request(ROOT_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ lock_id: 'root-lock-b', round_id: 'round-d3-root' })
  }), env, {});
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'revision_required');
  assert.equal(body.current_lock_id, 'root-lock-a');
  assert.equal(body.current_lock_hash, 'sha256:root-lock-a');
});

test('D3 root guard still rejects unauthenticated initial-lock POST before DB work', async () => {
  const response = await worker.fetch(new Request(ROOT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lock_id: 'root-lock-b', round_id: 'round-d3-root' })
  }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});
