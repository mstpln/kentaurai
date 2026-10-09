import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import {
  auditStorageCleanupIntegrity,
  bindStorageCleanupIntegrityAudit,
  buildStorageCleanupRepresentationAuditSql
} from '../src/storage-cleanup-audit.js';

function addSource(db, id, fetchedAt) {
  db.prepare(`
    INSERT INTO source_records
      (id,source_type,external_id,fetched_at,quality_status)
    VALUES (?,'official_provider',?,?, 'normalized_verified_subset')
  `).run(id, `game:${id}`, fetchedAt);
}

function addSync(db, sourceId, horseProfileCount = 0) {
  db.prepare(`
    INSERT INTO official_snapshot_source_sync
      (source_record_id,status,horse_profile_count,horse_stat_count,horse_record_count,person_stat_count)
    VALUES (?,'complete',?,0,0,0)
  `).run(sourceId, horseProfileCount);
}

test('cleanup integrity audit accepts direct and observation-backed source representations', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('audit-horse','Audit Horse')").run();

  addSource(db, 'audit-source-a', '2026-09-10T10:00:00Z');
  addSource(db, 'audit-source-b', '2026-09-11T10:00:00Z');
  addSync(db, 'audit-source-a', 1);
  addSync(db, 'audit-source-b', 1);

  db.prepare(`
    INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
    VALUES ('audit-snapshot','audit-horse','2026-09-10T10:00:00Z',4,'audit-source-a')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES
      ('audit-source-a','horse_profile','audit-horse','profile','2026-09-10T10:00:00Z','audit-snapshot',1),
      ('audit-source-b','horse_profile','audit-horse','profile','2026-09-11T10:00:00Z','audit-snapshot',0)
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  assert.equal(audit.ok, true);
  assert.equal(audit.families.length, 4);
  assert.ok(audit.families.every((family) => family.ok));
  assert.deepEqual(audit.operations, {
    batchStatuses: {},
    sessionStatuses: {},
    startedBatches: 0,
    strandedRawBatches: 0,
    ok: true
  });
});

test('cleanup integrity audit counts a direct snapshot plus its own observation as one logical representation', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('own-observation-horse','Own Observation Horse')").run();

  addSource(db, 'own-observation-source', '2026-09-10T10:00:00Z');
  addSync(db, 'own-observation-source', 1);
  db.prepare(`
    INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
    VALUES ('own-observation-snapshot','own-observation-horse','2026-09-10T10:00:00Z',4,'own-observation-source')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES ('own-observation-source','horse_profile','own-observation-horse','profile',
      '2026-09-10T10:00:00Z','own-observation-snapshot',1)
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  const profile = audit.families.find((family) => family.family === 'horse_profile');
  assert.equal(audit.ok, true);
  assert.equal(profile.mismatchedSources, 0);
  assert.equal(profile.excessRepresentations, 0);
});

test('cleanup integrity audit still detects an independent extra observation-backed representation', async () => {
  const { db, env } = createTestEnv();
  db.prepare(`
    INSERT INTO horses (id,canonical_name)
    VALUES ('direct-horse','Direct Horse'),('observed-horse','Observed Horse')
  `).run();

  addSource(db, 'representation-source', '2026-09-11T10:00:00Z');
  addSource(db, 'retained-source', '2026-09-10T10:00:00Z');
  addSync(db, 'representation-source', 1);

  db.prepare(`
    INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
    VALUES
      ('direct-snapshot','direct-horse','2026-09-11T10:00:00Z',4,'representation-source'),
      ('retained-snapshot','observed-horse','2026-09-10T10:00:00Z',5,'retained-source')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES
      ('representation-source','horse_profile','direct-horse','profile',
        '2026-09-11T10:00:00Z','direct-snapshot',1),
      ('representation-source','horse_profile','observed-horse','profile',
        '2026-09-11T10:00:00Z','retained-snapshot',0)
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  const profile = audit.families.find((family) => family.family === 'horse_profile');
  assert.equal(audit.ok, false);
  assert.equal(profile.mismatchedSources, 1);
  assert.equal(profile.missingRepresentations, 0);
  assert.equal(profile.excessRepresentations, 1);
});

test('cleanup representation check starts from complete sync sources and uses covering index lookups', () => {
  const { db } = createTestEnv();
  for (const [family, table, index] of [
    ['horse_profile', 'horse_profile_snapshots', 'idx_horse_profile_snapshots_source_record'],
    ['horse_stat', 'horse_stat_snapshots', 'idx_horse_stat_snapshots_source_record'],
    ['horse_record', 'horse_record_snapshots', 'idx_horse_record_snapshots_source_record'],
    ['person_stat', 'person_stat_snapshots', 'idx_person_stat_snapshots_source_record']
  ]) {
    const sql = buildStorageCleanupRepresentationAuditSql(family);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(family)
      .map((row) => String(row.detail || '')).join('\n');
    assert.match(plan, /SEARCH sync USING INDEX idx_official_snapshot_source_sync_status_source/);
    assert.match(plan, new RegExp(`SEARCH direct_snapshot USING COVERING INDEX ${index}`));
    assert.match(plan, /SEARCH o USING INDEX sqlite_autoindex_official_snapshot_observations_1 [(]source_record_id=[?] AND snapshot_family=[?][)]/);
    assert.doesNotMatch(plan, new RegExp(`SCAN ${table}\\b`));
    assert.doesNotMatch(plan, /SCAN official_snapshot_observations\b/);
  }
  assert.throws(
    () => buildStorageCleanupRepresentationAuditSql('not_a_family'),
    /unsupported storage cleanup audit family/
  );
});

test('completed-source counts exclude incomplete sources and still report exact missing and excess representations', () => {
  const { db } = createTestEnv();
  for (const id of ['sync-a', 'sync-b', 'sync-c', 'sync-failed']) {
    addSource(db, id, '2026-09-10T10:00:00Z');
  }
  addSync(db, 'sync-a', 2);
  addSync(db, 'sync-b', 0);
  addSync(db, 'sync-c', 1);
  db.prepare(`
    INSERT INTO official_snapshot_source_sync (source_record_id,status,horse_profile_count)
    VALUES ('sync-failed','failed',0)
  `).run();
  db.prepare(`
    INSERT INTO horses (id,canonical_name)
    VALUES ('source-test-horse','Source Test Horse')
  `).run();
  db.prepare(`
    INSERT INTO horse_profile_snapshots (id,horse_id,observed_at,source_record_id)
    VALUES
      ('snapshot-a','source-test-horse','2026-09-10T10:00:00Z','sync-a'),
      ('snapshot-b','source-test-horse','2026-09-10T10:00:00Z','sync-b'),
      ('snapshot-failed','source-test-horse','2026-09-10T10:00:00Z','sync-failed')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES
      ('sync-a','horse_profile','source-test-horse','profile','2026-09-10T10:00:00Z','snapshot-a',1),
      ('sync-failed','horse_profile','source-test-horse','profile','2026-09-10T10:00:00Z','snapshot-failed',1)
  `).run();
  const result = db.prepare(buildStorageCleanupRepresentationAuditSql('horse_profile')).get('horse_profile');
  assert.deepEqual({ mismatch: result.mismatched_sources, missing: result.missing_representations, excess: result.excess_representations }, {
    mismatch: 3,
    missing: 2,
    excess: 1
  });
});

test('cleanup audit source-count paths use dedicated covering indexes', () => {
  const { db } = createTestEnv();
  const indexes = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name)
  );
  for (const name of [
    'idx_horse_profile_snapshots_source_record',
    'idx_horse_stat_snapshots_source_record',
    'idx_horse_record_snapshots_source_record',
    'idx_person_stat_snapshots_source_record',
    'idx_official_snapshot_source_sync_status_source'
  ]) {
    assert.ok(indexes.has(name), `missing ${name}`);
  }

  for (const [table, indexName] of [
    ['horse_profile_snapshots', 'idx_horse_profile_snapshots_source_record'],
    ['horse_stat_snapshots', 'idx_horse_stat_snapshots_source_record'],
    ['horse_record_snapshots', 'idx_horse_record_snapshots_source_record'],
    ['person_stat_snapshots', 'idx_person_stat_snapshots_source_record']
  ]) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM ${table} WHERE source_record_id=?`).all('synthetic-source');
    assert.match(
      plan.map((row) => String(row.detail || '')).join('\n'),
      new RegExp(indexName),
      `${table} source-record lookup must use its cleanup audit index`
    );
  }

  const syncPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT source_record_id
    FROM official_snapshot_source_sync
    WHERE status='complete'
    ORDER BY source_record_id
  `).all();
  assert.match(
    syncPlan.map((row) => String(row.detail || '')).join('\n'),
    /idx_official_snapshot_source_sync_status_source/
  );
});

test('cleanup integrity audit detects missing, dangling and identity-mismatched provenance without exposing ids', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('audit-horse','Audit Horse')").run();

  addSource(db, 'audit-source-a', '2026-09-10T10:00:00Z');
  addSource(db, 'audit-source-missing', '2026-09-11T10:00:00Z');
  addSource(db, 'audit-source-dangling', '2026-09-12T10:00:00Z');
  addSync(db, 'audit-source-a', 1);
  addSync(db, 'audit-source-missing', 1);
  addSync(db, 'audit-source-dangling', 1);

  db.prepare(`
    INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
    VALUES ('audit-snapshot','audit-horse','2026-09-10T10:00:00Z',4,'audit-source-a')
  `).run();
  db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES ('audit-source-dangling','horse_profile','wrong-horse','wrong-scope','2026-09-12T10:00:00Z','missing-snapshot',0)
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  const profile = audit.families.find((family) => family.family === 'horse_profile');
  assert.equal(audit.ok, false);
  assert.equal(profile.mismatchedSources, 1);
  assert.equal(profile.missingRepresentations, 1);
  assert.equal(profile.danglingObservations, 1);
  assert.equal(profile.ok, false);
  assert.equal(JSON.stringify(audit).includes('audit-source-'), false);
  assert.equal(JSON.stringify(audit).includes('audit-horse'), false);
});

test('cleanup integrity audit route is private and returns only sanitized aggregate state', async () => {
  const { env } = createTestEnv();
  const url = 'https://example.invalid/v1/storage-cleanup/audit';

  assert.equal((await worker.fetch(new Request(url), {})).status, 503);
  assert.equal((await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer wrong' }
  }), { ADMIN_TOKEN: 'right' })).status, 401);

  const response = await worker.fetch(new Request(url, {
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` }
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.safetyStop, false);
  assert.ok(Array.isArray(body.families));
  assert.equal(body.families.length, 4);
  assert.ok(Number(body.cost?.rowsRead || 0) >= 0);
  assert.ok(Number(body.cost?.durationMs || 0) >= 0);
  assert.deepEqual(
    Object.keys(body.families[0].readCostByCheck),
    ['representations','observations','direct_timeline']
  );
  assert.ok(Object.values(body.families[0].readCostByCheck).every((value) =>
    value == null || (Number.isFinite(value) && value >= 0)
  ));
});


test('session-bound cleanup audit records only a verified matching running session', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'a'.repeat(40);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions
      (id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sourceSha);

  const bound = await bindStorageCleanupIntegrityAudit(env, {
    session_id: sessionId,
    source_sha: sourceSha
  });
  assert.equal(bound.ok, true);
  assert.equal(bound.auditVerified, true);
  assert.equal(
    db.prepare('SELECT source_sha FROM storage_cleanup_session_audits WHERE session_id=?').get(sessionId).source_sha,
    sourceSha
  );

  await assert.rejects(
    () => bindStorageCleanupIntegrityAudit(env, {
      session_id: sessionId,
      source_sha: 'b'.repeat(40)
    }),
    /source_sha changed/
  );
});

test('session-bound cleanup audit does not mark a session when provenance integrity fails', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'c'.repeat(40);
  const sessionId = '22222222-2222-4222-8222-222222222222';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions
      (id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sourceSha);

  addSource(db, 'missing-audit-source', '2026-09-10T10:00:00Z');
  addSync(db, 'missing-audit-source', 1);

  const bound = await bindStorageCleanupIntegrityAudit(env, {
    session_id: sessionId,
    source_sha: sourceSha
  });
  assert.equal(bound.ok, false);
  assert.equal(bound.auditVerified, false);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_session_audits WHERE session_id=?').get(sessionId).n,
    0
  );
});


test('session-bound cleanup audit route is private and persists verification', async () => {
  const { db, env } = createTestEnv();
  const sourceSha = 'e'.repeat(40);
  const sessionId = '44444444-4444-4444-8444-444444444444';
  db.prepare(`
    INSERT INTO storage_cleanup_sessions
      (id,source_sha,status,continuation_count,expires_at)
    VALUES (?,?,'running',1,'2099-01-01T00:00:00.000Z')
  `).run(sessionId, sourceSha);

  const url = 'https://example.invalid/v1/storage-cleanup/session/audit';
  const body = JSON.stringify({ session_id: sessionId, source_sha: sourceSha });

  const denied = await worker.fetch(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  }), {});
  assert.equal(denied.status, 503);

  const response = await worker.fetch(new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.ADMIN_TOKEN}`
    },
    body
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.auditVerified, true);
  assert.equal(payload.safetyStop, false);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_session_audits WHERE session_id=?').get(sessionId).n,
    1
  );
});


test('cleanup integrity audit detects source timestamp mismatches', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('time-horse','Time Horse')").run();
  addSource(db, 'time-source', '2026-09-10T10:00:00Z');
  addSync(db, 'time-source', 1);
  db.prepare(`
    INSERT INTO horse_profile_snapshots
      (id,horse_id,observed_at,age_years,source_record_id)
    VALUES ('time-snapshot','time-horse','2026-09-10T10:01:00Z',4,'time-source')
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  const profile = audit.families.find((family) => family.family === 'horse_profile');
  assert.equal(audit.ok, false);
  assert.equal(profile.timestampMismatchRepresentations, 1);
  assert.equal(profile.ok, false);
});


test('cleanup integrity audit fails closed on stranded raw mutation state', async () => {
  const { db, env } = createTestEnv();
  db.prepare(`
    INSERT INTO storage_cleanup_batches
      (id,cleanup_kind,target,plan_token,expected_changes,actual_changes,status,legacy_key,canonical_key,object_verified)
    VALUES ('stranded-batch','raw_object','synthetic_provider',?,1,1,'references_rewritten',
            'raw/synthetic_provider/day/legacy.json','raw/synthetic_provider/canonical.json',1)
  `).run('a'.repeat(64));

  const audit = await auditStorageCleanupIntegrity(env);
  assert.equal(audit.ok, false);
  assert.equal(audit.operations.strandedRawBatches, 1);
  assert.equal(audit.operations.ok, false);
  assert.equal(JSON.stringify(audit).includes('legacy.json'), false);
  assert.equal(JSON.stringify(audit).includes('canonical.json'), false);
});
