import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  CLEANUP_CONFIRMATION,
  buildBoundedRawReferenceCountSql,
  executeRawCleanupBatch,
  executeSnapshotCleanupBatch,
  planRawCleanupBatch,
  planSnapshotCleanupBatch
} from '../src/storage-cleanup-executor.js';
import worker from '../src/index.js';
import { getOfficialHorseSnapshotsAsOf } from '../src/import/official-snapshots.js';

function addSource(db, id, fetchedAt, rawObjectKey = id, contentHash = null, sourceType = 'official_provider') {
  db.prepare(`
    INSERT INTO source_records
      (id,source_type,external_id,fetched_at,raw_object_key,content_hash,quality_status)
    VALUES (?,?,?,?,?,?, 'test')
  `).run(id, sourceType, id, fetchedAt, rawObjectKey, contentHash);
}

function markSnapshotSourceComplete(db, sourceId) {
  db.prepare(`
    INSERT INTO official_snapshot_source_sync
      (source_record_id,status)
    VALUES (?,'complete')
  `).run(sourceId);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('snapshot executor removes only sequential repeats and rewires provenance atomically', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-cleanup','Cleanup Horse')").run();
  const facts = [4, 4, 4, 5, 5, 4];
  for (let index = 0; index < facts.length; index += 1) {
    const id = `source-${index}`;
    const snapshotId = `snapshot-${index}`;
    const observedAt = `2026-09-${String(10 + index).padStart(2, '0')}T10:00:00Z`;
    addSource(db, id, observedAt);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id) VALUES (?,'horse-cleanup',?,?,?)`)
      .run(snapshotId, observedAt, facts[index], id);
    db.prepare(`INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
      VALUES (?,'horse_profile','horse-cleanup','profile',?,?,1)`)
      .run(id, observedAt, snapshotId);
  }

  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsRetained, 3);
  assert.equal(plan.rowsRemovable, 3);
  assert.equal(JSON.stringify(plan).includes('snapshot-'), false);

  const result = await executeSnapshotCleanupBatch(env, {
    family: 'horse_profile',
    limit: 25,
    planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.rowsRemoved, 3);
  assert.deepEqual(
    db.prepare('SELECT age_years FROM horse_profile_snapshots ORDER BY observed_at').all().map((row) => row.age_years),
    [4, 5, 4]
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM official_snapshot_observations').get().n, 6);
  assert.deepEqual(
    db.prepare('SELECT factual_changed FROM official_snapshot_observations ORDER BY observed_at').all().map((row) => row.factual_changed),
    [1, 0, 0, 1, 0, 1]
  );
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS n FROM official_snapshot_observations o
    LEFT JOIN horse_profile_snapshots s ON s.id=o.snapshot_id
    WHERE o.snapshot_family='horse_profile' AND s.id IS NULL
  `).get().n, 0);
  assert.deepEqual(
    { ...db.prepare('SELECT expected_changes,actual_changes,status FROM storage_cleanup_batches').get() },
    { expected_changes: 3, actual_changes: 3, status: 'complete' }
  );
});

test('snapshot cleanup ignores rows from failed source syncs', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-failed-cleanup','Failed Cleanup Horse')").run();
  for (const [sourceId, snapshotId, observedAt, status] of [
    ['cleanup-complete','cleanup-complete-snapshot','2026-09-10T10:00:00Z','complete'],
    ['cleanup-failed','cleanup-failed-snapshot','2026-09-11T10:00:00Z','failed']
  ]) {
    addSource(db, sourceId, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync
        (source_record_id,status,horse_profile_count,error_message)
      VALUES (?,?,1,?)
    `).run(sourceId, status, status === 'failed' ? 'synthetic failure' : null);
    db.prepare(`
      INSERT INTO horse_profile_snapshots
        (id,horse_id,observed_at,age_years,source_record_id)
      VALUES (?,'horse-failed-cleanup',?,4,?)
    `).run(snapshotId, observedAt, sourceId);
  }

  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsScanned, 2);
  assert.equal(plan.rowsRetained, 1);
  assert.equal(plan.rowsRemovable, 0);
  assert.equal(plan.nextCursor, null);
});

test('snapshot planning bounds long runs of failed-source rows before complete history', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-failed-prefix','Failed Prefix Horse')").run();
  for (let index = 0; index < 42; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const sourceId = `failed-prefix-source-${suffix}`;
    const observedAt = `2026-09-${String(1 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00Z`;
    const status = index < 40 ? 'failed' : 'complete';
    addSource(db, sourceId, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count,error_message)
      VALUES (?,?,1,?)
    `).run(sourceId, status, status === 'failed' ? 'synthetic failure' : null);
    db.prepare(`
      INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id)
      VALUES (?,'horse-failed-prefix',?,4,?)
    `).run(`failed-prefix-snapshot-${suffix}`, observedAt, sourceId);
  }

  const first = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(first.rowsScanned, 25);
  assert.equal(first.rowsRetained, 0);
  assert.equal(first.rowsRemovable, 0);
  assert.ok(first.nextCursor);

  const second = await planSnapshotCleanupBatch(env, {
    family: 'horse_profile', limit: 25, cursor: first.nextCursor
  });
  assert.equal(second.rowsScanned, 17);
  assert.equal(second.rowsRetained, 1);
  assert.equal(second.rowsRemovable, 1);
  assert.equal(second.nextCursor, null);
});

test('failed snapshot rows do not block dedupe across complete sources', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-failed-gap','Failed Gap Horse')").run();
  const rows = [
    ['gap-source-a','gap-snapshot-a','2026-09-10T10:00:00Z',4,'complete'],
    ['gap-source-b','gap-snapshot-b','2026-09-11T10:00:00Z',5,'failed'],
    ['gap-source-c','gap-snapshot-c','2026-09-12T10:00:00Z',4,'complete']
  ];
  for (const [sourceId,snapshotId,observedAt,age,status] of rows) {
    addSource(db, sourceId, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync
        (source_record_id,status,horse_profile_count,error_message)
      VALUES (?,?,1,?)
    `).run(sourceId, status, status === 'failed' ? 'synthetic failure' : null);
    db.prepare(`
      INSERT INTO horse_profile_snapshots
        (id,horse_id,observed_at,age_years,source_record_id)
      VALUES (?,'horse-failed-gap',?,?,?)
    `).run(snapshotId, observedAt, age, sourceId);
  }

  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsScanned, 3);
  assert.equal(plan.rowsRemovable, 1);

  const result = await executeSnapshotCleanupBatch(env, {
    family: 'horse_profile',
    limit: 25,
    planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.rowsRemoved, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id='gap-source-c'").get().n,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id='gap-source-b'").get().n,
    1
  );
});

test('snapshot cleanup preserves legacy source/as-of provenance when duplicate rows predate observation storage', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-legacy','Legacy Horse')").run();

  for (const [sourceId, snapshotId, observedAt] of [
    ['legacy-source-a','legacy-snapshot-a','2026-09-10T10:00:00Z'],
    ['legacy-source-b','legacy-snapshot-b','2026-09-11T10:00:00Z']
  ]) {
    addSource(db, sourceId, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync
        (source_record_id,status,horse_profile_count)
      VALUES (?,'complete',1)
    `).run(sourceId);
    db.prepare(`
      INSERT INTO horse_profile_snapshots
        (id,horse_id,observed_at,age_years,source_record_id)
      VALUES (?,'horse-legacy',?,4,?)
    `).run(snapshotId, observedAt, sourceId);
  }

  let current = await getOfficialHorseSnapshotsAsOf(env, ['horse-legacy'], '2026-09-11T12:00:00Z');
  assert.equal(current.get('horse-legacy').age.sourceRecordId, 'legacy-source-b');

  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsRemovable, 1);

  const result = await executeSnapshotCleanupBatch(env, {
    family: 'horse_profile',
    limit: 25,
    planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.rowsRemoved, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 1);

  const observation = db.prepare(`
    SELECT source_record_id,observed_at,snapshot_id,factual_changed
    FROM official_snapshot_observations
    WHERE source_record_id='legacy-source-b' AND snapshot_family='horse_profile'
  `).get();
  assert.deepEqual({ ...observation }, {
    source_record_id: 'legacy-source-b',
    observed_at: '2026-09-11T10:00:00Z',
    snapshot_id: 'legacy-snapshot-a',
    factual_changed: 0
  });

  current = await getOfficialHorseSnapshotsAsOf(env, ['horse-legacy'], '2026-09-11T12:00:00Z');
  assert.equal(current.get('horse-legacy').age.years, 4);
  assert.equal(current.get('horse-legacy').age.sourceRecordId, 'legacy-source-b');
  assert.equal(current.get('horse-legacy').age.observedAt, '2026-09-11T10:00:00Z');
});


test('storage cleanup routes fail closed behind ADMIN_TOKEN', async () => {
  const request = (authorization) => new Request('https://example.invalid/v1/storage-cleanup/snapshots/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: '{}'
  });
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(request('Bearer wrong'), { ADMIN_TOKEN: 'right' })).status, 401);
});

test('snapshot executor preserves A-B-A and null-value-null change points', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-changes','Change Horse')").run();
  const facts = [null, 4, null, 5, 4];
  for (let index = 0; index < facts.length; index += 1) {
    const id = `change-source-${index}`;
    const observedAt = `2026-08-${String(10 + index).padStart(2, '0')}T10:00:00Z`;
    addSource(db, id, observedAt);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id) VALUES (?,'horse-changes',?,?,?)`)
      .run(`change-snapshot-${index}`, observedAt, facts[index], id);
  }
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsRetained, 5);
  assert.equal(plan.rowsRemovable, 0);
});

test('snapshot execution rejects a stale or unconfirmed plan without mutation', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-safe','Safe Horse')").run();
  for (let index = 0; index < 2; index += 1) {
    const id = `safe-source-${index}`;
    const observedAt = `2026-07-${10 + index}T10:00:00Z`;
    addSource(db, id, observedAt);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id) VALUES (?,'horse-safe',?,4,?)`)
      .run(`safe-snapshot-${index}`, observedAt, id);
  }
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  await assert.rejects(() => executeSnapshotCleanupBatch(env, {
    family: 'horse_profile', limit: 25, planToken: plan.planToken, confirmation: 'wrong'
  }), /confirmation/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 2);
});

test('snapshot cursor preserves sequential comparison across a bounded page boundary', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-page','Page Horse')").run();
  for (let index = 0; index < 26; index += 1) {
    const id = `page-source-${String(index).padStart(2, '0')}`;
    const observedAt = `2026-06-${String(index + 1).padStart(2, '0')}T10:00:00Z`;
    addSource(db, id, observedAt);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id) VALUES (?,'horse-page',?,?,?)`)
      .run(`page-snapshot-${index}`, observedAt, index === 25 ? 24 : index, id);
  }
  const first = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(first.rowsRemovable, 0);
  assert.ok(first.nextCursor);
  const second = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25, cursor: first.nextCursor });
  assert.equal(second.rowsRemovable, 1);
  await executeSnapshotCleanupBatch(env, {
    family: 'horse_profile', limit: 25, cursor: first.nextCursor,
    planToken: second.planToken, confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 25);
});

test('raw executor normalizes references atomically and retains physical legacy R2 objects', async () => {
  const { db, env, objects } = createTestEnv();
  const body = JSON.stringify({ synthetic: true });
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic_provider/2026-09-01/${hash}.json`;
  const canonicalKey = `raw/synthetic_provider/${hash}.json`;
  objects.set(legacyKey, { body, options: { httpMetadata: { contentType: 'application/json' } } });
  addSource(db, 'raw-source-1', '2026-09-01T10:00:00Z', legacyKey, hash, 'synthetic_provider');
  addSource(db, 'raw-source-2', '2026-09-02T10:00:00Z', legacyKey, hash, 'synthetic_provider');
  const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n;

  const plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  assert.equal(plan.referenceRewrites, 2);
  assert.equal(plan.redundantObjectCandidates, 1);
  assert.equal(JSON.stringify(plan).includes(legacyKey), false);
  const result = await executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider',
    limit: 25,
    planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION
  });
  assert.deepEqual(
    { rewrites: result.referencesRewritten, created: result.canonicalObjectsCreated, deleted: result.legacyObjectsDeleted },
    { rewrites: 2, created: 1, deleted: 0 }
  );
  assert.ok(await env.RAW_BUCKET.head(canonicalKey));
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
  assert.equal(result.objectDeletionDeferred, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, beforeCount);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records WHERE raw_object_key=?').get(canonicalKey).n, 2);
});

test('raw executor stops before mutation on hash mismatch or canonical conflict', async () => {
  const { db, env, objects } = createTestEnv();
  const body = 'verified body';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic_provider/day/${hash}.bin`;
  const canonicalKey = `raw/synthetic_provider/${hash}.bin`;
  objects.set(legacyKey, { body: 'different body', options: {} });
  addSource(db, 'conflict-source', '2026-09-01T10:00:00Z', legacyKey, hash, 'synthetic_provider');
  let plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  await assert.rejects(() => executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  }), /body hash mismatch/);
  assert.equal(db.prepare("SELECT raw_object_key FROM source_records WHERE id='conflict-source'").get().raw_object_key, legacyKey);

  objects.set(legacyKey, { body, options: {} });
  objects.set(canonicalKey, { body, options: { customMetadata: { contentHash: '0'.repeat(64) } } });
  plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  await assert.rejects(() => executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  }), /metadata\/hash conflict/);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));

  objects.set(canonicalKey, {
    body,
    options: { customMetadata: { contentHash: hash, sourceType: 'wrong_provider' } }
  });
  plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  await assert.rejects(() => executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  }), /metadata\/hash conflict/);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));

  objects.set(canonicalKey, {
    body: 'x'.repeat(body.length),
    options: { customMetadata: { contentHash: hash, sourceType: 'synthetic_provider' } }
  });
  plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  await assert.rejects(() => executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  }), /canonical R2 body hash mismatch/);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
});

test('raw executor keeps the legacy object until every bounded reference batch is rewritten', async () => {
  const { db, env, objects } = createTestEnv();
  const body = 'bounded raw body';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic_provider/day/${hash}.bin`;
  objects.set(legacyKey, { body, options: {} });
  for (let index = 0; index < 27; index += 1) {
    addSource(db, `many-${String(index).padStart(2, '0')}`, `2026-05-${String(index + 1).padStart(2, '0')}T10:00:00Z`, legacyKey, hash, 'synthetic_provider');
  }
  let cursor = null;
  let plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25, cursor });
  let result = await executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, cursor,
    planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.referencesRewritten, 25);
  assert.equal(result.legacyObjectsDeleted, 0);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
  cursor = result.nextCursor;
  plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25, cursor });
  if (plan.referenceRewrites === 0 && plan.nextCursor) {
    cursor = plan.nextCursor;
    plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25, cursor });
  }
  result = await executeRawCleanupBatch(env, {
    sourceType: 'synthetic_provider', limit: 25, cursor,
    planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.referencesRewritten, 2);
  assert.equal(result.legacyObjectsDeleted, 0);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
});


test('raw executor keeps cursor on active page so later legacy groups are not skipped', async () => {
  const { db, env, objects } = createTestEnv();
  const bodyA = 'group-a';
  const bodyB = 'group-b';
  const hashA = await sha256(bodyA);
  const hashB = await sha256(bodyB);
  const legacyA = `raw/synthetic_provider/day/${hashA}.bin`;
  const legacyB = `raw/synthetic_provider/day/${hashB}.bin`;
  objects.set(legacyA, { body: bodyA, options: {} });
  objects.set(legacyB, { body: bodyB, options: {} });
  addSource(db, 'group-a-source', '2026-04-01T10:00:00Z', legacyA, hashA, 'synthetic_provider');
  addSource(db, 'group-b-source', '2026-04-02T10:00:00Z', legacyB, hashB, 'synthetic_provider');

  let cursor = null;
  for (let i = 0; i < 4; i += 1) {
    const plan = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25, cursor });
    if (plan.referenceRewrites > 0) {
      const result = await executeRawCleanupBatch(env, {
        sourceType: 'synthetic_provider',
        limit: 25,
        cursor,
        planToken: plan.planToken,
        confirmation: CLEANUP_CONFIRMATION
      });
      cursor = result.nextCursor;
    } else {
      cursor = plan.nextCursor;
    }
    if (!cursor && plan.referenceRewrites === 0) break;
  }

  assert.ok(await env.RAW_BUCKET.head(legacyA));
  assert.ok(await env.RAW_BUCKET.head(legacyB));
});

test('raw planning is index-bounded even when one legacy R2 key has a long reference list', async () => {
  const { db, env, objects } = createTestEnv();
  const body = 'many-shared-raw-source-references';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic_provider/day/${hash}.bin`;
  objects.set(legacyKey, { body, options: {} });
  for (let i = 0; i < 250; i++) {
    addSource(db, `bounded-ref-${String(i).padStart(4, '0')}`,
      '2026-09-10T10:00:00Z', legacyKey, hash, 'synthetic_provider');
  }
  const sql = buildBoundedRawReferenceCountSql();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(
    legacyKey, 26, `raw/synthetic_provider/${hash}.bin`, 26
  ).map((row) => String(row.detail || '')).join('\n');
  assert.match(plan, /idx_source_records_raw_object_key/);
  assert.doesNotMatch(plan, /SCAN source_records(?! USING COVERING INDEX)/);
  const report = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  assert.equal(report.referenceRewrites, 25);
  assert.equal(report.legacyReferences, 26, 'reported reference count is a bounded lower bound');
  assert.equal(report.referenceCountsTruncated, true);
  assert.equal(report.redundantObjectCandidates, 0, 'cannot infer R2 garbage eligibility from a truncated sample');
  assert.equal(report.objectDeletionDeferred, true);
});

test('raw reference lookup stops at a bounded legacy-key prefix and rejects cross-source conflicts', async () => {
  const { db, env, objects } = createTestEnv();
  const body = 'bounded-mixed-provider-source';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic_provider/day/${hash}.bin`;
  objects.set(legacyKey, { body, options: {} });
  for (let i = 0; i < 120; i++) {
    addSource(db, `aa-conflicting-${String(i).padStart(4, '0')}`,
      '2026-09-10T10:00:00Z', legacyKey, hash, 'z_other_provider');
  }
  addSource(db, 'zzz-valid-legacy-source',
    '2026-09-10T10:00:00Z', legacyKey, hash, 'synthetic_provider');
  const report = await planRawCleanupBatch(env, { sourceType: 'synthetic_provider', limit: 25 });
  assert.equal(report.referenceRewrites, 0);
  assert.equal(report.referenceCountsTruncated, true);
  assert.equal(report.conflictsSkipped, 1);
  assert.ok(report.warnings.includes('legacy_reference_conflict'));
  assert.equal(report.objectDeletionDeferred, true);
});

test('snapshot cleanup does not remove an earlier event because offset timestamps sort differently as text', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('offset-horse','Offset Horse')").run();
  // The second source sorts earlier as text, but actually occurs later in time.
  const sources = [
    ['source-earlier', '2026-09-10T02:00:00+03:00'],
    ['source-later', '2026-09-10T01:00:00Z']
  ];
  for (const [id, observedAt] of sources) {
    addSource(db, id, observedAt);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
      VALUES (?,'offset-horse',?,4,?)`).run(`snapshot-${id}`, observedAt, id);
  }
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsScanned, 2);
  assert.equal(plan.rowsRemovable, 0, 'never retain a chronologically later source in place of an earlier one');
});

test('snapshot quality status differences are not collapsed as identical facts', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('quality-horse','Quality Horse')").run();
  for (const [id, at, quality] of [
    ['q-first','2026-09-10T00:00:00Z','verified_official_snapshot'],
    ['q-second','2026-09-11T00:00:00Z','unknown']
  ]) {
    addSource(db, id, at);
    markSnapshotSourceComplete(db, id);
    db.prepare(`INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,quality_status,source_record_id)
      VALUES (?,'quality-horse',?,4,?,?)`).run(`snapshot-${id}`, at, quality, id);
  }
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  assert.equal(plan.rowsRemovable, 0);
});

test('raw planning pages over bounded source ID ranges, including null and unrelated keys', async () => {
  const { db, env } = createTestEnv();
  for (let i = 0; i < 120; i++) {
    addSource(db, `aaa-ineligible-${String(i).padStart(4,'0')}`,
      '2026-09-10T10:00:00Z', null, null, 'unrelated');
  }
  const hash = 'a'.repeat(64);
  const legacy = `raw/synthetic_provider/day/${hash}.bin`;
  addSource(db, 'zzz-eligible-raw', '2026-09-10T10:00:00Z',
    legacy, hash, 'synthetic_provider');
  let cursor = null;
  let selected = null;
  let pages = 0;
  do {
    const page = await planRawCleanupBatch(env, {
      limit: 25, cursor, sourceType: 'synthetic_provider'
    });
    assert.ok(page.rowsScanned <= 25);
    if (page.referenceRewrites) selected = page;
    cursor = page.nextCursor;
    pages++;
  } while (cursor && !selected && pages < 8);
  assert.ok(selected, 'a late candidate must not be skipped behind null-key prefixes');
  assert.ok(pages >= 5);
});

test('raw reference normalization only reports bounded remaining-reference existence', async () => {
  const { db, env, objects } = createTestEnv();
  const body = 'many-remaining-legacy-records';
  const hash = await sha256(body);
  const legacy = `raw/synthetic_provider/day/${hash}.bin`;
  objects.set(legacy, { body, options: {} });
  for (let i = 0; i < 60; i++) {
    addSource(db, `remaining-ref-${String(i).padStart(3,'0')}`,
      '2026-09-10T10:00:00Z', legacy, hash, 'synthetic_provider');
  }
  const plan = await planRawCleanupBatch(env, { limit: 25, sourceType: 'synthetic_provider' });
  const result = await executeRawCleanupBatch(env, {
    limit: 25, sourceType: 'synthetic_provider',
    planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION
  });
  assert.equal(result.referencesRewritten, 25);
  assert.equal(result.legacyReferencesStillPresent, true);
  assert.equal(result.legacyReferencesRemaining, null);
  assert.ok(await env.RAW_BUCKET.head(legacy));
});
