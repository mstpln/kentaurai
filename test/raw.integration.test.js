import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveRawPayload } from '../src/raw.js';
import { createTestEnv } from './helpers/d1.js';

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
