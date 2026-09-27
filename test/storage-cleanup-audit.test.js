import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import { auditStorageCleanupIntegrity } from '../src/storage-cleanup-audit.js';

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
    VALUES ('audit-source-b','horse_profile','audit-horse','profile','2026-09-11T10:00:00Z','audit-snapshot',0)
  `).run();

  const audit = await auditStorageCleanupIntegrity(env);
  assert.equal(audit.ok, true);
  assert.equal(audit.families.length, 4);
  assert.ok(audit.families.every((family) => family.ok));
  assert.deepEqual(audit.operations, { batchStatuses: {}, sessionStatuses: {} });
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
});
