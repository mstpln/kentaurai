import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v069.js';

const REVISION_URL = 'https://example.test/v1/analysis-step1-revision/private-probe';
const PROMPT_URL = 'https://example.test/v1/analysis-step1-revision-prompt?provider=openai';

test('D3 revision routes reject missing and invalid admin auth before DB work', async () => {
  for (const url of [REVISION_URL, PROMPT_URL]) {
    const missing = await worker.fetch(new Request(url), { ADMIN_TOKEN: 'synthetic-secret' }, {});
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, 'unauthorized');

    const invalid = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error, 'unauthorized');
  }
});

test('D3 revision routes fail closed when ADMIN_TOKEN is not configured', async () => {
  for (const url of [REVISION_URL, PROMPT_URL]) {
    const response = await worker.fetch(new Request(url), {}, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'service_unavailable');
  }
});

test('D3 revision prompt route returns provider-neutral market-blind revision instructions', async () => {
  const response = await worker.fetch(new Request(PROMPT_URL, {
    headers: { authorization: 'Bearer synthetic-secret' }
  }), { ADMIN_TOKEN: 'synthetic-secret' }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.prompt_version, 'step1-revision-prompt-v1-d3');
  assert.match(body.prompt, /Use only the supplied kentaurai-step1-revision-pack-v1 JSON/);
  assert.match(body.prompt, /Do not browse the web/);
  assert.match(body.prompt, /Revise exactly the leg numbers listed in affected_legs/);
  assert.match(body.prompt, /Missing X-Labs.*must never reduce baseline horse strength/s);
  assert.match(body.prompt, /Set provider to "openai"/);
});

test('D3 blocks a second independent root lock and requires lineage revision', async () => {
  const env = {
    ADMIN_TOKEN: 'synthetic-secret',
    DB: {
      prepare(sql) {
        assert.match(sql, /analysis_step1_locks/);
        return {
          bind() {
            return {
              first: async () => ({
                id: 'existing-lock', game_round_id: 'round-1', contract_version: 'kentaurai-step1-lock-v1',
                pack_id: 'pack-1', pack_as_of: '2026-09-16T08:00:00.000Z', facts_fingerprint: 'sha256:facts',
                provider: 'openai', model: 'synthetic-model', prompt_version: 'step1-prompt-v3-d2',
                lock_hash: 'sha256:lock', created_at: '2026-09-16T08:05:00.000Z'
              })
            };
          }
        };
      }
    }
  };
  const response = await worker.fetch(new Request('https://example.test/v1/analysis-step1-lock/round-1', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ lock_id: 'new-independent-root', round_id: 'round-1' })
  }), env, {});
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'revision_required');
  assert.equal(body.current_lock_id, 'existing-lock');
});
