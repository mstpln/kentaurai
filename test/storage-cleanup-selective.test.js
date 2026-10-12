import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { verifySelectiveSourceFamilies } from '../src/storage-cleanup-selective.js';
import { planSnapshotCleanupBatch } from '../src/storage-cleanup-executor.js';

const hash = 'a'.repeat(64);
function source(db, id, at, expected = 1) {
  db.prepare('INSERT INTO source_records (id,source_type,fetched_at,content_hash,raw_object_key,quality_status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'official_provider', at, hash, 'raw/official_provider/' + hash + '.json', 'normalized_verified_subset');
  db.prepare('INSERT INTO official_snapshot_source_sync (source_record_id,status,horse_profile_count) VALUES (?, ?, ?)')
    .run(id, 'complete', expected);
}
function snapshot(db, id, sourceId, observedAt, age) {
  db.prepare('INSERT INTO horse_profile_snapshots (id,horse_id,source_record_id,observed_at,age_years) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'synthetic-horse', sourceId, observedAt, age);
}
test('selective source proof quarantines missing representation without blocking independent sources', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic')");
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic')").run();
  const atA='2026-09-01T10:00:00Z',atB='2026-09-02T10:00:00Z',atC='2026-09-03T10:00:00Z';
  source(db,'a',atA,1); source(db,'b',atB,2); source(db,'c',atC,1);
  snapshot(db,'a1','a',atA,4);
  snapshot(db,'b1','b',atB,7);
  snapshot(db,'c1','c',atC,4);
  const safe=await verifySelectiveSourceFamilies(env,'horse_profile',['a','b','c']);
  assert.deepEqual([...safe].sort(),['a','c']);
  const preview=await planSnapshotCleanupBatch(env,{family:'horse_profile',limit:25,selective:true});
  assert.equal(preview.rowsQuarantined,1);
  assert.equal(preview.rowsRemovable,0);
  assert.ok(preview.warnings.includes('unverified_source_or_chronology_skipped'));
});
test('selective proof excludes a source with wrong observation identity and preserves unrelated good source', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic')").run();
  source(db,'healthy','2026-09-01T10:00:00Z');
  source(db,'bad','2026-09-02T10:00:00Z');
  snapshot(db,'h1','healthy','2026-09-01T10:00:00Z',4);
  snapshot(db,'b1','bad','2026-09-02T10:00:00Z',4);
  db.prepare('INSERT INTO official_snapshot_observations (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed) VALUES (?,?,?,?,?,?,?)')
    .run('bad','horse_profile','wrong-horse','profile','2026-09-02T10:00:00Z','b1',1);
  const safe=await verifySelectiveSourceFamilies(env,'horse_profile',['healthy','bad']);
  assert.deepEqual([...safe],['healthy']);
});
test('selective preview does not collapse valid repeats across a quarantined source', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic')").run();
  source(db,'a','2026-09-01T10:00:00Z');
  source(db,'b','2026-09-02T10:00:00Z',2);
  source(db,'c','2026-09-03T10:00:00Z');
  snapshot(db,'sa','a','2026-09-01T10:00:00Z',4);
  snapshot(db,'sb','b','2026-09-02T10:00:00Z',4);
  snapshot(db,'sc','c','2026-09-03T10:00:00Z',4);
  const plan=await planSnapshotCleanupBatch(env,{family:'horse_profile',limit:2,selective:true});
  assert.equal(plan.rowsRemovable,0);
  const next=await planSnapshotCleanupBatch(env,{family:'horse_profile',limit:2,cursor:plan.nextCursor,selective:true});
  assert.equal(next.rowsRemovable,0);
});
