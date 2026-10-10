import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  assertStorageCleanupAuthorization,
  startOrResumeStorageCleanupAudit,
  stepStorageCleanupAudit
} from '../src/storage-cleanup-audit.js';
import { buildSnapshotCleanupPageSql } from '../src/storage-cleanup-executor.js';

const SOURCE_SHA = '7'.repeat(40);

function insertSource(db, id, fetchedAt, counts) {
  db.prepare(`
    INSERT INTO source_records(id,source_type,external_id,fetched_at,quality_status)
    VALUES (?,'official_provider',?,?,'normalized_verified_subset')
  `).run(id, id, fetchedAt);
  db.prepare(`
    INSERT INTO official_snapshot_source_sync
      (source_record_id,status,horse_profile_count,horse_stat_count,horse_record_count,person_stat_count)
    VALUES (?,'complete',?,?,?,?)
  `).run(id, counts.profile || 0, counts.stat || 0, counts.record || 0, counts.person || 0);
}

test('resumable audit covers 250k synthetic representations in bounded indexed pages', { timeout: 120_000 }, async () => {
  const { db, env } = createTestEnv();
  const rowsPerFamily = 50_000;
  const sourcesPerRepresentationStream = 500;
  const rowsPerSource = rowsPerFamily / sourcesPerRepresentationStream;
  const observedAt = '2026-09-10T10:00:00Z';
  const statements = {
    horse: db.prepare('INSERT INTO horses(id,canonical_name) VALUES (?,?)'),
    profile: db.prepare('INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) VALUES (?,?,?,4,?)'),
    stat: db.prepare("INSERT INTO horse_stat_snapshots(id,horse_id,observed_at,snapshot_scope,stat_year,starts,source_record_id) VALUES (?,?,?,'life',NULL,1,?)"),
    record: db.prepare("INSERT INTO horse_record_snapshots(id,horse_id,observed_at,record_scope,stat_year,record_ordinal,source_record_id) VALUES (?,'scale-horse-00000',?,'life',NULL,?,?)"),
    person: db.prepare("INSERT INTO person_stat_snapshots(id,person_type,person_id,observed_at,stat_year,starts,source_record_id) VALUES (?,'driver','scale-driver',?,?,1,?)"),
    observation: db.prepare("INSERT INTO official_snapshot_observations(source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed) VALUES (?,'horse_profile',?,'profile',?,?,0)")
  };

  db.exec('BEGIN');
  for (let index = 0; index < sourcesPerRepresentationStream; index += 1) {
    const suffix = String(index).padStart(3, '0');
    insertSource(db, `scale-profile-${suffix}`, observedAt, { profile: rowsPerSource });
    insertSource(db, `scale-stat-${suffix}`, observedAt, { stat: rowsPerSource });
    insertSource(db, `scale-record-${suffix}`, observedAt, { record: rowsPerSource });
    insertSource(db, `scale-person-${suffix}`, observedAt, { person: rowsPerSource });
    insertSource(db, `scale-observation-${suffix}`, observedAt, { profile: rowsPerSource });
  }
  for (let index = 0; index < 25; index += 1) {
    insertSource(db, `scale-zero-${String(index).padStart(2, '0')}`, observedAt, {});
    const failedId = `scale-failed-${String(index).padStart(2, '0')}`;
    db.prepare(`
      INSERT INTO source_records(id,source_type,external_id,fetched_at,quality_status)
      VALUES (?,'official_provider',?,?,'normalized_verified_subset')
    `).run(failedId, failedId, observedAt);
    db.prepare(`
      INSERT INTO official_snapshot_source_sync(source_record_id,status,horse_profile_count)
      VALUES (?,'failed',100)
    `).run(failedId);
  }
  for (let index = 0; index < rowsPerFamily; index += 1) {
    const suffix = String(index).padStart(5, '0');
    const sourceSuffix = String(Math.floor(index / rowsPerSource)).padStart(3, '0');
    const horseId = `scale-horse-${suffix}`;
    const profileId = `scale-profile-${suffix}`;
    statements.horse.run(horseId, `Synthetic ${suffix}`);
    statements.profile.run(profileId, horseId, observedAt, `scale-profile-${sourceSuffix}`);
    statements.stat.run(`scale-stat-${suffix}`, horseId, observedAt, `scale-stat-${sourceSuffix}`);
    statements.record.run(`scale-record-${suffix}`, observedAt, index, `scale-record-${sourceSuffix}`);
    statements.person.run(`scale-person-${suffix}`, observedAt, index, `scale-person-${sourceSuffix}`);
    statements.observation.run(`scale-observation-${sourceSuffix}`, horseId, observedAt, profileId);
  }
  db.exec('COMMIT');

  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: SOURCE_SHA });
  let steps = 0;
  let maximumPage = 0;
  while (!audit.complete && steps < 300) {
    audit = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });
    if (steps === 0) {
      const resumed = await startOrResumeStorageCleanupAudit(env, {
        source_sha: SOURCE_SHA,
        audit_run_id: audit.auditRunId
      });
      assert.equal(resumed.auditRunId, audit.auditRunId);
      assert.equal(resumed.continuationCount, 2);
      audit = resumed;
    }
    maximumPage = Math.max(maximumPage, Number(audit.page?.rowsChecked || 0));
    steps += 1;
  }

  assert.equal(audit.complete, true);
  assert.equal(audit.ok, true);
  assert.equal(steps, 122);
  assert.ok(maximumPage <= 5000, `page exceeded bound: ${maximumPage}`);
  assert.equal(audit.families.reduce((sum, family) => sum + family.rowsChecked, 0), 510_100);
  assert.ok(audit.families.every((family) => family.ok));
  assert.equal(audit.operations.ok, true);

  db.prepare("UPDATE storage_cleanup_audit_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .run(audit.auditRunId);
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, {
      audit_run_id: audit.auditRunId,
      source_sha: SOURCE_SHA
    }),
    /audit is expired/
  );
  assert.equal(
    db.prepare('SELECT status FROM storage_cleanup_audit_runs WHERE id=?').get(audit.auditRunId).status,
    'expired'
  );
  await assert.rejects(
    () => startOrResumeStorageCleanupAudit(env, {
      source_sha: SOURCE_SHA,
      audit_run_id: audit.auditRunId
    }),
    /run is expired/
  );
});

test('newly committed source evidence makes an interrupted audit stale and blocks authorization', async () => {
  const { db, env } = createTestEnv();
  let audit = await startOrResumeStorageCleanupAudit(env, { source_sha: SOURCE_SHA });
  audit = await stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId });

  await assert.rejects(
    () => startOrResumeStorageCleanupAudit(env, { source_sha: SOURCE_SHA }),
    /resume it explicitly with audit_run_id/
  );

  insertSource(db, 'new-source-during-audit', '2026-09-11T10:00:00Z', {});

  await assert.rejects(
    () => stepStorageCleanupAudit(env, { audit_run_id: audit.auditRunId }),
    /dataset changed/
  );
  assert.equal(
    db.prepare('SELECT status FROM storage_cleanup_audit_runs WHERE id=?').get(audit.auditRunId).status,
    'stale'
  );
  await assert.rejects(
    () => assertStorageCleanupAuthorization(env, {
      audit_run_id: audit.auditRunId,
      source_sha: SOURCE_SHA
    }),
    /complete cleanup integrity audit is required/
  );
});

test('all snapshot cleanup planners use stable order indexes without a global temp sort', () => {
  const { db } = createTestEnv();
  for (const family of ['horse_profile','horse_stat','horse_record','person_stat']) {
    const sql = buildSnapshotCleanupPageSql(family, false);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(26)
      .map((row) => String(row.detail || '')).join('\n');
    assert.match(plan, new RegExp(`idx_cleanup_${family}_order`));
    assert.match(plan, /SEARCH source_sync USING COVERING INDEX idx_official_snapshot_source_sync_status_source/);
    assert.doesNotMatch(plan, /USE TEMP B-TREE FOR ORDER BY/);
  }
});
