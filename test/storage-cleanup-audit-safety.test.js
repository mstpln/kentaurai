import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  applyStorageCleanupAuditPage,
  assertStorageCleanupAuthorization,
  bindStorageCleanupIntegrityAudit,
  prepareStorageCleanupAuditStep,
  settleStorageCleanupAuditPage,
  startOrResumeStorageCleanupAudit,
  stepStorageCleanupAudit
} from '../src/storage-cleanup-audit.js';
import {
  CLEANUP_CONFIRMATION,
  executeRawCleanupBatch,
  executeSnapshotCleanupBatch,
  planRawCleanupBatch,
  planSnapshotCleanupBatch
} from '../src/storage-cleanup-executor.js';

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addOneProfile(db) {
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('atomic-horse','Atomic Horse')").run();
  db.prepare(`
    INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES ('atomic-source','official_provider','2026-09-10T10:00:00Z','normalized_verified_subset')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)
    VALUES ('atomic-source','complete',1)
  `).run();
  db.prepare(`
    INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,source_record_id)
    VALUES ('atomic-snapshot','atomic-horse','2026-09-10T10:00:00Z','atomic-source')
  `).run();
}

async function preparedFirstPage(env, sourceSha) {
  const run = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  return prepareStorageCleanupAuditStep(env, { audit_run_id: run.auditRunId });
}

test('audit page count deltas and cursor progress commit atomically and replay once', async () => {
  const { db, env, d1Faults } = createTestEnv();
  addOneProfile(db);
  const prepared = await preparedFirstPage(env, '1'.repeat(40));
  const page = prepared.preparedPage;

  d1Faults.batchAfterStatement = 1; // receipt + count delta, before progress
  await assert.rejects(() => applyStorageCleanupAuditPage(env, page), /injected D1 batch failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_audit_pages').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_audit_source_counts').get().n, 0);
  assert.deepEqual(
    { ...db.prepare('SELECT page_version,pages,pending_page_id FROM storage_cleanup_audit_progress WHERE audit_run_id=? AND target=?')
      .get(page.auditRunId, page.target) },
    { page_version: 0, pages: 0, pending_page_id: null }
  );

  const applied = await applyStorageCleanupAuditPage(env, page);
  assert.equal(applied.applied, true);
  await settleStorageCleanupAuditPage(env, page, { rowsRead: 10, rowsWritten: 3, durationMs: 2 });
  const costAfterFirstSettlement = db.prepare(`
    SELECT continuation_rows_read,continuation_rows_written
    FROM storage_cleanup_audit_runs WHERE id=?
  `).get(page.auditRunId);
  await settleStorageCleanupAuditPage(env, page, { rowsRead: 10, rowsWritten: 3, durationMs: 2 });
  assert.deepEqual({ ...db.prepare(`
    SELECT continuation_rows_read,continuation_rows_written
    FROM storage_cleanup_audit_runs WHERE id=?
  `).get(page.auditRunId) }, { ...costAfterFirstSettlement }, 'settlement replay must not add cost twice');
  assert.equal(db.prepare(`
    SELECT actual_count FROM storage_cleanup_audit_source_counts
    WHERE audit_run_id=? AND family='horse_profile' AND source_record_id='atomic-source'
  `).get(page.auditRunId).actual_count, 1);
  assert.equal((await applyStorageCleanupAuditPage(env, page)).applied, false, 'stale replay must not apply again');
  assert.equal(db.prepare(`
    SELECT actual_count FROM storage_cleanup_audit_source_counts
    WHERE audit_run_id=? AND family='horse_profile' AND source_record_id='atomic-source'
  `).get(page.auditRunId).actual_count, 1);
});

test('simultaneous audit page commits have one winner and exact counts', async () => {
  const { db, env } = createTestEnv();
  addOneProfile(db);
  const prepared = await preparedFirstPage(env, '2'.repeat(40));
  const page = prepared.preparedPage;
  const results = await Promise.all([
    applyStorageCleanupAuditPage(env, page),
    applyStorageCleanupAuditPage(env, page)
  ]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(results.filter((result) => result.concurrent).length, 1);
  await settleStorageCleanupAuditPage(env, page, {});
  assert.equal(db.prepare(`
    SELECT actual_count FROM storage_cleanup_audit_source_counts
    WHERE audit_run_id=? AND family='horse_profile' AND source_record_id='atomic-source'
  `).get(page.auditRunId).actual_count, 1);
});

test('revision change between page read and commit makes the audit stale', async () => {
  const { db, env } = createTestEnv();
  const prepared = await preparedFirstPage(env, '3'.repeat(40));
  db.prepare(`
    INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES ('late-raw','manual','2026-09-11T10:00:00Z','unknown')
  `).run();
  await assert.rejects(
    () => applyStorageCleanupAuditPage(env, prepared.preparedPage),
    /dataset changed/
  );
  assert.equal(db.prepare('SELECT status FROM storage_cleanup_audit_runs WHERE id=?')
    .get(prepared.auditRunId).status, 'stale');
});

test('an ambiguous crash after atomic commit leaves non-authorizing pending proof', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = '4'.repeat(40);
  const prepared = await preparedFirstPage(env, sourceSha);
  await applyStorageCleanupAuditPage(env, prepared.preparedPage);

  await assert.rejects(
    () => prepareStorageCleanupAuditStep(env, { audit_run_id: prepared.auditRunId }),
    /unsettled page/
  );
  assert.equal(db.prepare('SELECT status FROM storage_cleanup_audit_runs WHERE id=?')
    .get(prepared.auditRunId).status, 'failed');
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, {
      audit_run_id: prepared.auditRunId,
      source_sha: sourceSha
    }),
    /complete cleanup integrity audit is required/
  );
});

async function reachFinalPage(env, sourceSha) {
  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  for (let index = 0; index < 21; index += 1) {
    audit = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });
  }
  const prepared = await prepareStorageCleanupAuditStep(env, { audit_run_id: audit.auditRunId });
  assert.equal(prepared.preparedPage.target, 'operations:sessions');
  return prepared;
}

test('cost stop on the final page persists failed proof for reads, writes and duration', async (t) => {
  for (const [label, metrics] of [
    ['reads', { rowsRead: 250001 }],
    ['writes', { rowsWritten: 25001 }],
    ['duration', { durationMs: 45001 }]
  ]) {
    await t.test(label, async () => {
      const { env } = createTestEnv();
      const sourceSha = ({ reads: '5', writes: '6', duration: '7' })[label].repeat(40);
      const prepared = await reachFinalPage(env, sourceSha);
      await applyStorageCleanupAuditPage(env, prepared.preparedPage);
      const result = await settleStorageCleanupAuditPage(
        env, prepared.preparedPage, metrics, { safetyStop: true }
      );
      assert.equal(result.status, 'failed');
      assert.equal(result.ok, false);
      assert.equal(result.page.accepted, false);
      await assert.rejects(
        () => assertStorageCleanupAuthorization(env, {
          audit_run_id: result.auditRunId,
          source_sha: sourceSha
        }),
        /complete cleanup integrity audit is required/
      );
    });
  }
});

test('cumulative continuation budget stops before another worst-case page and resumes explicitly', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = '8'.repeat(40);
  const run = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  db.prepare(`
    UPDATE storage_cleanup_audit_runs
    SET continuation_rows_read=750001
    WHERE id=?
  `).run(run.auditRunId);
  const blocked = await prepareStorageCleanupAuditStep(env, { audit_run_id: run.auditRunId });
  assert.equal(blocked.budgetBlocked, true);
  assert.equal(blocked.complete, false);
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, {
      audit_run_id: run.auditRunId,
      source_sha: sourceSha
    }),
    /complete cleanup integrity audit is required/
  );
  const resumed = await startOrResumeStorageCleanupAudit(env, {
    source_sha: sourceSha,
    audit_run_id: run.auditRunId
  });
  assert.equal(resumed.cumulativeSafetyStop, false);
  assert.deepEqual(resumed.continuationCost, { rowsRead: 0, rowsWritten: 0, durationMs: 0 });
  assert.ok((await prepareStorageCleanupAuditStep(env, { audit_run_id: run.auditRunId })).preparedPage);
});

test('database acceptance deadline rejects a page whose final settlement arrives late', async () => {
  const { env } = createTestEnv();
  const prepared = await preparedFirstPage(env, 'e'.repeat(40));
  prepared.preparedPage.acceptBefore = '2000-01-01T00:00:00.000Z';
  await applyStorageCleanupAuditPage(env, prepared.preparedPage);
  const settled = await settleStorageCleanupAuditPage(env, prepared.preparedPage, {
    rowsRead: 1, rowsWritten: 1, durationMs: 1
  });
  assert.equal(settled.status, 'failed');
  assert.equal(settled.page.accepted, false);
});

test('repeated invocation after audit completion is idempotent', async () => {
  const { env } = createTestEnv();
  const sourceSha = '9'.repeat(40);
  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  while (!audit.complete) audit = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });
  const repeated = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });
  assert.equal(repeated.status, 'complete');
  assert.equal(repeated.ok, true);
});

async function completeEmptyAudit(env, sourceSha) {
  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  while (!audit.complete) audit = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });
  assert.equal(audit.ok, true);
  return audit;
}

test('all authorization-relevant mutation classes advance the dataset fence', async (t) => {
  const cases = [
    ['raw capture', ({ db }) => db.prepare(`
      INSERT INTO source_records(id,source_type,fetched_at,quality_status)
      VALUES ('raw-after-audit','manual','2026-09-11T10:00:00Z','unknown')
    `).run()],
    ['source reference update', ({ db }) => db.prepare(`
      UPDATE source_records SET raw_object_key='raw/manual/new.json' WHERE id='baseline-source'
    `).run()],
    ['snapshot insert', ({ db }) => db.prepare(`
      INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,source_record_id)
      VALUES ('snapshot-after-audit','baseline-horse','2026-09-10T10:00:00Z','baseline-source')
    `).run()],
    ['observation insert', ({ db }) => db.prepare(`
      INSERT INTO official_snapshot_observations
        (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
      VALUES ('baseline-source','horse_profile','baseline-horse','profile','2026-09-10T10:00:00Z','baseline-snapshot',0)
    `).run()],
    ['cleanup batch state', ({ db }) => db.prepare(`
      INSERT INTO storage_cleanup_batches(id,cleanup_kind,target,plan_token,expected_changes,status)
      VALUES ('batch-after-audit','snapshot','horse_profile','token',1,'started')
    `).run()]
  ];
  let digit = 10;
  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const fixture = createTestEnv();
      fixture.db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('baseline-horse','Baseline Horse')").run();
      fixture.db.prepare(`
        INSERT INTO source_records(id,source_type,fetched_at,quality_status)
        VALUES ('baseline-source','manual','2026-09-10T10:00:00Z','unknown')
      `).run();
      if (label === 'observation insert') {
        fixture.db.prepare(`
          INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,source_record_id)
          VALUES ('baseline-snapshot','baseline-horse','2026-09-10T10:00:00Z','baseline-source')
        `).run();
      }
      const sourceSha = digit.toString(16).repeat(40);
      digit += 1;
      const audit = await completeEmptyAudit(fixture.env, sourceSha);
      const before = fixture.db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
      mutate(fixture);
      const after = fixture.db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
      assert.ok(after > before, `${label} must advance revision`);
      await assert.rejects(
        () => assertStorageCleanupAuthorization(fixture.env, {
          audit_run_id: audit.auditRunId,
          source_sha: sourceSha
        }),
        /stale/
      );
    });
  }
});

test('authorized cleanup mutation rebases only its bound audit and session atomically', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'a'.repeat(40);
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('dedupe-horse','Dedupe Horse')").run();
  for (const [id, observedAt] of [['dedupe-source-a','2026-09-10T10:00:00Z'], ['dedupe-source-b','2026-09-11T10:00:00Z']]) {
    db.prepare(`
      INSERT INTO source_records(id,source_type,fetched_at,quality_status)
      VALUES (?,'official_provider',?,'normalized_verified_subset')
    `).run(id, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)
      VALUES (?,'complete',1)
    `).run(id);
  }
  db.prepare(`
    INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id)
    VALUES
      ('dedupe-snapshot-a','dedupe-horse','2026-09-10T10:00:00Z',4,'dedupe-source-a'),
      ('dedupe-snapshot-b','dedupe-horse','2026-09-11T10:00:00Z',4,'dedupe-source-b')
  `).run();
  const audit = await completeEmptyAudit(env, sourceSha);
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions(id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sourceSha);
  await bindStorageCleanupIntegrityAudit(env, {
    session_id: sessionId,
    source_sha: sourceSha,
    audit_run_id: audit.auditRunId
  });
  const authorization = await assertStorageCleanupAuthorization(env, {
    session_id: sessionId,
    source_sha: sourceSha
  }, { requireSession: true });
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  const result = await executeSnapshotCleanupBatch(env, {
    family: 'horse_profile',
    limit: 25,
    planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION,
    _authorization: authorization
  });
  assert.equal(result.rowsRemoved, 1);
  const revision = db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
  assert.equal(db.prepare('SELECT dataset_revision FROM storage_cleanup_audit_runs WHERE id=?').get(audit.auditRunId).dataset_revision, revision);
  assert.equal(db.prepare('SELECT dataset_revision FROM storage_cleanup_session_audits WHERE session_id=?').get(sessionId).dataset_revision, revision);
  const stillAuthorized = await assertStorageCleanupAuthorization(env, {
    session_id: sessionId,
    source_sha: sourceSha
  }, { requireSession: true });
  assert.equal(stillAuthorized.datasetRevision, revision);
});

test('external mutation between plan and execution is rejected by the in-transaction fence', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'b'.repeat(40);
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('race-horse','Race Horse')").run();
  for (const [id, observedAt] of [['race-source-a','2026-09-10T10:00:00Z'], ['race-source-b','2026-09-11T10:00:00Z']]) {
    db.prepare(`
      INSERT INTO source_records(id,source_type,fetched_at,quality_status)
      VALUES (?,'official_provider',?,'normalized_verified_subset')
    `).run(id, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)
      VALUES (?,'complete',1)
    `).run(id);
  }
  db.prepare(`
    INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id)
    VALUES
      ('race-snapshot-a','race-horse','2026-09-10T10:00:00Z',4,'race-source-a'),
      ('race-snapshot-b','race-horse','2026-09-11T10:00:00Z',4,'race-source-b')
  `).run();
  const audit = await completeEmptyAudit(env, sourceSha);
  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions(id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sourceSha);
  await bindStorageCleanupIntegrityAudit(env, {
    session_id: sessionId,
    source_sha: sourceSha,
    audit_run_id: audit.auditRunId
  });
  const authorization = await assertStorageCleanupAuthorization(env, {
    session_id: sessionId,
    source_sha: sourceSha
  }, { requireSession: true });
  const plan = await planSnapshotCleanupBatch(env, { family: 'horse_profile', limit: 25 });
  db.prepare(`
    INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES ('concurrent-import','manual','2026-09-12T10:00:00Z','unknown')
  `).run();
  await assert.rejects(
    () => executeSnapshotCleanupBatch(env, {
      family: 'horse_profile', limit: 25, planToken: plan.planToken,
      confirmation: CLEANUP_CONFIRMATION, _authorization: authorization
    }),
    /authorization revision guard|cleanup plan changed/
  );
});

test('authorized raw normalization rebases in one D1 batch and never deletes R2', async () => {
  const { db, env, objects } = createTestEnv();
  const sha = 'c'.repeat(40);
  const body = 'retained raw source';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic/day/${hash}.bin`;
  const canonicalKey = `raw/synthetic/${hash}.bin`;
  objects.set(legacyKey, { body, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id,source_type,fetched_at,raw_object_key,content_hash,quality_status)
    VALUES ('retained-raw-source','synthetic','2026-09-10T10:00:00Z',?,?, 'unknown')
  `).run(legacyKey, hash);
  const audit = await completeEmptyAudit(env, sha);
  const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions(id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sha);
  await bindStorageCleanupIntegrityAudit(env, { session_id: sessionId, source_sha: sha, audit_run_id: audit.auditRunId });
  const auth = await assertStorageCleanupAuthorization(env, { session_id: sessionId, source_sha: sha }, { requireSession: true });
  let deletes = 0;
  env.RAW_BUCKET.delete = async () => { deletes++; throw new Error('unsafe delete reached'); };
  const plan = await planRawCleanupBatch(env, { sourceType: 'synthetic', limit: 25 });
  const result = await executeRawCleanupBatch(env, {
    sourceType: 'synthetic', limit: 25, planToken: plan.planToken,
    confirmation: CLEANUP_CONFIRMATION, _authorization: auth
  });
  assert.equal(result.referencesRewritten, 1);
  assert.equal(result.legacyObjectsDeleted, 0);
  assert.equal(result.objectDeletionDeferred, true);
  assert.equal(deletes, 0);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
  assert.ok(await env.RAW_BUCKET.head(canonicalKey));
  assert.equal(db.prepare("SELECT raw_object_key FROM source_records WHERE id='retained-raw-source'").get().raw_object_key, canonicalKey);
  const current = db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
  assert.equal(current, auth.datasetRevision + 1);
  assert.equal(db.prepare('SELECT dataset_revision FROM storage_cleanup_audit_runs WHERE id=?').get(audit.auditRunId).dataset_revision, current);
  const active = await assertStorageCleanupAuthorization(env, { session_id: sessionId, source_sha: sha }, { requireSession: true });
  assert.equal(active.datasetRevision, current);
  const batch = db.prepare("SELECT status,actual_changes FROM storage_cleanup_batches WHERE cleanup_kind='raw_object'").get();
  assert.equal(batch.status, 'complete');
  assert.equal(batch.actual_changes, 1);
});

test('unrelated import before guarded raw rewrite rolls back cleanup and preserves both source objects', async () => {
  const { db, env, objects } = createTestEnv();
  const sha = 'e'.repeat(40);
  const body = 'concurrent raw source';
  const hash = await sha256(body);
  const legacyKey = `raw/synthetic/day/${hash}.bin`;
  const canonicalKey = `raw/synthetic/${hash}.bin`;
  objects.set(legacyKey, { body, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id,source_type,fetched_at,raw_object_key,content_hash,quality_status)
    VALUES ('race-raw-source','synthetic','2026-09-10T10:00:00Z',?,?, 'unknown')
  `).run(legacyKey, hash);
  const audit = await completeEmptyAudit(env, sha);
  const sessionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions(id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sha);
  await bindStorageCleanupIntegrityAudit(env, { session_id: sessionId, source_sha: sha, audit_run_id: audit.auditRunId });
  const auth = await assertStorageCleanupAuthorization(env, { session_id: sessionId, source_sha: sha }, { requireSession: true });
  const plan = await planRawCleanupBatch(env, { sourceType: 'synthetic', limit: 25 });
  const originalBatch = env.DB.batch.bind(env.DB);
  env.DB.batch = async (statements) => {
    env.DB.batch = originalBatch;
    db.prepare(`
      INSERT INTO source_records(id,source_type,fetched_at,quality_status)
      VALUES ('interleaved-source','synthetic','2026-09-12T10:00:00Z','unknown')
    `).run();
    return originalBatch(statements);
  };
  await assert.rejects(
    () => executeRawCleanupBatch(env, {
      sourceType: 'synthetic', limit: 25,
      planToken: plan.planToken, confirmation: CLEANUP_CONFIRMATION,
      _authorization: auth
    }),
    /authorization revision guard failed/
  );
  assert.equal(db.prepare("SELECT raw_object_key FROM source_records WHERE id='race-raw-source'").get().raw_object_key, legacyKey);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM storage_cleanup_batches").get().n, 0);
  assert.ok(await env.RAW_BUCKET.head(legacyKey));
  assert.ok(await env.RAW_BUCKET.head(canonicalKey));
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, { session_id: sessionId, source_sha: sha }, { requireSession: true }),
    /stale/
  );
});

test('many imported source rows only invalidate an active audit revision once', async () => {
  const { db, env } = createTestEnv();
  const sha = 'f'.repeat(40);
  const audit = await completeEmptyAudit(env, sha);
  const before = db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
  const insert = db.prepare(`
    INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES (?,'synthetic','2026-09-13T10:00:00Z','unknown')
  `);
  db.exec('BEGIN');
  for (let i = 0; i < 200; i++) insert.run(`many-new-${String(i).padStart(4,'0')}`);
  db.exec('COMMIT');
  const after = db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1').get().revision;
  assert.equal(after, before + 1);
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, { audit_run_id: audit.auditRunId, source_sha: sha }),
    /stale/
  );
});


test('HTTP audit route finalizes only after measured page settlement', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'd'.repeat(40);
  const post = async (path, body) => {
    const response = await worker.fetch(new Request(`https://example.invalid${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ADMIN_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }), env);
    assert.equal(response.status, 200);
    return response.json();
  };
  let audit = await post('/v1/storage-cleanup/audit/start', { source_sha: sourceSha });
  while (!audit.complete) {
    audit = await post('/v1/storage-cleanup/audit/step', { audit_run_id: audit.auditRunId });
    assert.equal(audit.safetyStop, false);
  }
  assert.equal(audit.status, 'complete');
  assert.equal(audit.ok, true);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS n FROM storage_cleanup_audit_pages
    WHERE audit_run_id=? AND status<>'accepted'
  `).get(audit.auditRunId).n, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS n FROM storage_cleanup_audit_progress
    WHERE audit_run_id=? AND pending_page_id IS NOT NULL
  `).get(audit.auditRunId).n, 0);
});
