import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveRawPayload } from '../src/raw.js';
import { createTestEnv } from './helpers/d1.js';
import { planRawObjectDeduplication } from '../src/storage-cleanup-plans.js';

const snapshot = {
  sourceType: 'synthetic_provider',
  externalId: 'round-1',
  fetchedAt: '2026-09-06T12:00:00Z',
  payload: { value: 1 },
  qualityStatus: 'test'
};

test('raw snapshot archive reuses an identical source identity and payload', async () => {
  const { env, db, objects } = createTestEnv();
  const first = await archiveRawPayload(env, structuredClone(snapshot));
  const second = await archiveRawPayload(env, structuredClone(snapshot));

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.sourceRecordId, first.sourceRecordId);
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_records').get().n, 1);
  assert.equal(objects.size, 1);
});

test('raw snapshot archive rejects changed content for the same source identity and timestamp', async () => {
  const { env } = createTestEnv();
  await archiveRawPayload(env, structuredClone(snapshot));
  const changed = structuredClone(snapshot);
  changed.payload.value = 2;
  await assert.rejects(() => archiveRawPayload(env, changed), /source snapshot conflict/);
});

test('identical payloads on different days share one canonical object but keep separate source records', async () => {
  const { env, db, objects } = createTestEnv();
  const first = await archiveRawPayload(env, structuredClone(snapshot));
  const later = structuredClone(snapshot);
  later.externalId = 'round-2';
  later.fetchedAt = '2026-09-07T12:00:00Z';
  const second = await archiveRawPayload(env, later);
  assert.equal(first.objectKey, second.objectKey);
  assert.match(first.objectKey, /^raw\/synthetic_provider\/[a-f0-9]{64}\.json$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 2);
  assert.equal(objects.size, 1);
});

test('different payloads receive different canonical objects', async () => {
  const { env } = createTestEnv();
  const first = await archiveRawPayload(env, structuredClone(snapshot));
  const changed = structuredClone(snapshot);
  changed.externalId = 'round-2';
  changed.fetchedAt = '2026-09-07T12:00:00Z';
  changed.payload.value = 2;
  const second = await archiveRawPayload(env, changed);
  assert.notEqual(first.objectKey, second.objectKey);
});

test('raw cleanup planning is deterministic, keeps legacy keys readable and mutates nothing', async () => {
  const { env, db, objects } = createTestEnv();
  const hash = 'a'.repeat(64);
  const oldKey = `raw/synthetic_provider/2026-09-06/${hash}.json`;
  objects.set(oldKey, { body: '{"synthetic":true}', options: {} });
  db.prepare(`INSERT INTO source_records
    (id,source_type,external_id,fetched_at,raw_object_key,content_hash,quality_status)
    VALUES ('legacy-source','synthetic_provider','legacy','2026-09-06T12:00:00Z',?,?,'test')`).run(oldKey, hash);
  const first = await planRawObjectDeduplication(env, { sourceType: 'synthetic_provider', limit: 20 });
  const second = await planRawObjectDeduplication(env, { sourceType: 'synthetic_provider', limit: 20 });
  assert.deepEqual(first, second);
  assert.equal(first.referenceRewrites, 1);
  assert.equal(first.redundantObjectCandidates, 1);
  assert.equal(JSON.stringify(first).includes(oldKey), false);
  assert.equal(db.prepare("SELECT raw_object_key FROM source_records WHERE id='legacy-source'").get().raw_object_key, oldKey);
  assert.ok(await env.RAW_BUCKET.get(oldKey));
});


test('raw snapshot archive refuses a conflicting pre-existing canonical object', async () => {
  const { env, objects } = createTestEnv();
  const payload = structuredClone(snapshot);
  const body = JSON.stringify(payload.payload);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = `raw/${payload.sourceType}/${hash}.json`;

  objects.set(key, {
    body: body + 'corrupt',
    options: {
      customMetadata: { sourceType: payload.sourceType, contentHash: hash, contentType: 'application/json' },
      httpMetadata: { contentType: 'application/json' }
    }
  });

  await assert.rejects(
    () => archiveRawPayload(env, payload),
    /canonical raw object metadata or size conflict/
  );
});
