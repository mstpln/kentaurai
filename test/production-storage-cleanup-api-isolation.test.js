import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  startOrResumeStorageCleanupAudit,
  stepStorageCleanupAudit
} from '../src/storage-cleanup-audit.js';
import { buildReadOnlyAuditContinuation } from '../scripts/queue-production-storage-audit.mjs';

const MUTATION_PATHS = [
  '/v1/storage-cleanup/session/start',
  '/v1/storage-cleanup/session/audit',
  '/v1/storage-cleanup/session/checkpoint',
  '/v1/storage-cleanup/snapshots/execute',
  '/v1/storage-cleanup/raw/execute'
];

function post(path, token, body = {}) {
  return new Request('https://kentaurai.invalid' + path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

test('no persistent or temporary bearer credential can execute destructive cleanup routes', async () => {
  const temporaryToken = Date.now() + '.' + 'b'.repeat(64);
  const env = { ADMIN_TOKEN: 'synthetic-admin', STORAGE_CLEANUP_TOKEN: temporaryToken };
  for (const [label, token] of [['admin', 'synthetic-admin'], ['temporary cleanup', temporaryToken]]) {
    for (const path of MUTATION_PATHS) {
      const response = await worker.fetch(post(path, token, {
        source_sha: 'a'.repeat(40),
        session_id: '11111111-1111-4111-8111-111111111111',
        confirmation: 'execute-reviewed-storage-cleanup-batch'
      }), env);
      assert.equal(response.status, 403, label + ' unexpectedly accessed ' + path);
      assert.deepEqual(await response.json(), { error: 'storage_cleanup_execution_disabled' });
    }
    const check = await worker.fetch(new Request('https://kentaurai.invalid/v1/storage-cleanup/auth-check', {
      headers: { authorization: 'Bearer ' + token }
    }), env);
    assert.equal(check.status, 200, label + ' lost read-only access');
  }
  for (const path of MUTATION_PATHS) {
    const unauthenticated = await worker.fetch(post(path, 'incorrect'), env);
    assert.equal(unauthenticated.status, 401, 'authentication still fails closed: ' + path);
  }
});

function continuationEnv(audit, sourceSha, incomplete) {
  return {
    GITHUB_REPOSITORY: 'mstpln/kentaurai',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sourceSha,
    GITHUB_RUN_ID: '38126000001',
    MODE: 'dry-run',
    CONFIRMATION: '',
    AUDIT_INCOMPLETE: incomplete ? 'true' : 'false',
    PROGRESS_MADE: 'true',
    COST_BUDGET_STOP: 'false',
    AUDIT_SAFETY_STOP: 'false',
    CLEANUP_SESSION_ID: '',
    AUDIT_RUN_ID: audit.auditRunId,
    AUDIT_CONTINUATION_COUNT: String(audit.continuationCount),
    AUDIT_MAX_CONTINUATIONS: String(audit.maxContinuations),
    AUDIT_EXPIRES_AT: audit.expiresAt,
    DRY_RUN_MAX_BATCHES: '50'
  };
}

test('one manual read-only audit resumes across runs, finishes all 22 targets, plans safely and stops dispatch', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'd'.repeat(40);
  const time = '2026-09-10T10:00:00Z';
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('audit-horse','Audit Horse')").run();
  db.prepare(`INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES ('audit-source','official_provider',?,'normalized_verified_subset')`).run(time);
  db.prepare(`INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)
    VALUES ('audit-source','complete',1)`).run();
  db.prepare(`INSERT INTO horse_profile_snapshots(id,horse_id,source_record_id,observed_at)
    VALUES ('audit-snapshot','audit-horse','audit-source',?)`).run(time);
  db.prepare(`INSERT INTO official_snapshot_observations
    (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES ('audit-source','horse_profile','audit-horse','profile',?,'audit-snapshot',1)`).run(time);

  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: sourceSha });
  const firstAuditId = audit.auditRunId;
  const visited = new Set();
  let acceptedPages = 0;
  for (let run = 0; run < 3; run += 1) {
    if (run > 0) {
      audit = await startOrResumeStorageCleanupAudit(env, {
        audit_run_id: firstAuditId,
        source_sha: sourceSha
      });
      assert.equal(audit.auditRunId, firstAuditId);
      assert.equal(audit.continuationCount, run + 1);
    }
    const allowance = run === 2 ? 6 : 8;
    for (let page = 0; page < allowance; page += 1) {
      audit = await stepStorageCleanupAudit(env, { audit_run_id: firstAuditId });
      assert.equal(audit.page?.accepted, true, 'every page requires accepted cost settlement');
      visited.add(audit.page.target);
      acceptedPages += 1;
    }
    if (run < 2) {
      assert.equal(audit.complete, false);
      const handoff = buildReadOnlyAuditContinuation(continuationEnv(audit, sourceSha, true));
      assert.equal(handoff.inputs.mode, 'dry-run');
      assert.equal(handoff.inputs.continuation_audit, firstAuditId);
      assert.equal(handoff.inputs.continuation_session, '');
    }
  }
  assert.equal(audit.auditRunId, firstAuditId);
  assert.equal(audit.complete, true);
  assert.equal(audit.ok, true);
  assert.equal(audit.continuationCount, 3);
  assert.equal(acceptedPages, 22);
  assert.equal(visited.size, 22);
  assert.equal(audit.families.every((family) => family.complete && family.ok), true);
  assert.equal(audit.operations.complete, true);

  const response = await worker.fetch(post('/v1/storage-cleanup/snapshots/plan', 'synthetic-admin', {
    family: 'horse_profile',
    limit: 25,
    audit_run_id: firstAuditId,
    source_sha: sourceSha
  }), { ...env, ADMIN_TOKEN: 'synthetic-admin' });
  assert.equal(response.status, 200, 'read-only planning remains available after complete proof');
  assert.equal((await response.json()).rowsRemovable, 0);
  assert.throws(() => buildReadOnlyAuditContinuation(continuationEnv(audit, sourceSha, false)),
    /progressing/, 'completion must not dispatch a successor');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_profile_snapshots').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM official_snapshot_observations').get().n, 1);
});
