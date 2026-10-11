import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import { inspectPrivateRawSnapshotEvidence } from '../src/storage-raw-source-diagnostic.js';
import worker from '../src/index.js';

const SHA = 'a'.repeat(40);
const PROOF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function addProof(db) {
  db.prepare(
    "INSERT INTO storage_cleanup_audit_runs(id,source_sha,dataset_revision,status,continuation_count,expires_at,completed_at,failure_reason) " +
    "VALUES (?,?,0,'failed',20,'2026-10-12T12:00:00Z','2026-10-11T12:00:00Z','integrity_anomaly')"
  ).run(PROOF_ID, SHA);
  const targets = [
    ...['horse_profile','horse_stat','horse_record','person_stat'].flatMap((family) =>
      ['direct_representations','observation_representations','representation_compare','observations','direct_timeline']
        .map((suffix) => family + ':' + suffix)),
    'operations:batches','operations:sessions'
  ];
  for (const target of targets) {
    db.prepare("INSERT INTO storage_cleanup_audit_progress(audit_run_id,target,is_complete) VALUES (?,?,1)")
      .run(PROOF_ID, target);
  }
}

function rawFacts(ids) {
  return JSON.stringify({ races: [{ starts: ids.map((id) => ({ horse: { id, age: 4 } })) }] });
}

async function addSource(f, id, expectedCount, factIds, { ledgerCount = null, includeR2 = true } = {}) {
  const body = rawFacts(factIds);
  const digest = createHash('sha256').update(body).digest('hex');
  const key = 'raw/official_provider/' + digest + '.json';
  f.db.prepare(
    "INSERT INTO source_records(id,source_type,external_id,fetched_at,raw_object_key,content_hash,quality_status) " +
    "VALUES (?,'official_provider',?,'2026-09-12T10:00:00Z',?,?,'normalized_verified_subset')"
  ).run(id, id, key, digest);
  f.db.prepare(
    "INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,horse_profile_count) " +
    "VALUES (?,'complete','2026-09-20 10:00:00',?)"
  ).run(id, expectedCount);
  if (ledgerCount !== null) {
    f.db.prepare(
      "INSERT INTO storage_cleanup_audit_source_counts(audit_run_id,family,source_record_id,actual_count) " +
      "VALUES (?,'horse_profile',?,?)"
    ).run(PROOF_ID, id, ledgerCount);
  }
  if (includeR2) await f.env.RAW_BUCKET.put(key, body, {
    customMetadata: { contentHash: digest, sourceType: 'official_provider' },
    httpMetadata: { contentType: 'application/json' }
  });
  return { key, digest, body };
}

async function fixture() {
  const f = createTestEnv();
  addProof(f.db);
  const never = await addSource(f, 'synthetic-empty', 1, [100], {});
  const partial = await addSource(f, 'synthetic-partial', 2, [101, 102], { ledgerCount: 1 });
  f.db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic Horse')").run();
  f.db.prepare(
    "INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) " +
    "VALUES ('synthetic-observed','synthetic-horse','2026-09-12T10:00:00Z',4,'synthetic-partial')"
  ).run();
  return { ...f, never, partial };
}

test('read-only R2 verification checks hashes, parses original facts and outputs only aggregates', async () => {
  const f = await fixture();
  const report = await inspectPrivateRawSnapshotEvidence(f.env);
  assert.equal(report.mode, 'read_only_raw_evidence_sample');
  assert.equal(report.classificationOnly, true);
  assert.equal(report.snapshotFactsNotRestored, true);
  assert.equal(report.families.length, 4);
  const horse = report.families[0];
  assert.deepEqual({
    sampled: horse.sampled, noLedger: horse.noLedger, partial: horse.partial,
    hashVerified: horse.rawHashVerified, potentiallyRecoverable: horse.rawContainsAtLeastRecordedFacts,
    absent: horse.originalAbsent, invalid: horse.originalInvalid
  }, { sampled: 2, noLedger: 1, partial: 1,
    hashVerified: 2, potentiallyRecoverable: 2, absent: 0, invalid: 0 });
  assert.equal(report.budget.rowsWritten, 0);
  assert.equal(report.budget.r2ObjectsRead, 2);
  assert.equal(f.d1Metrics.runs, 0);
  assert.equal(f.d1Metrics.batches, 0);
  for (const value of [PROOF_ID, f.never.key, f.never.digest, 'synthetic-empty', 'synthetic-partial', 'synthetic-horse']) {
    assert.ok(!JSON.stringify(report).includes(value), 'source evidence must stay private');
  }
});

test('missing raw objects are reported as unverified, never treated as restored', async () => {
  const f = await fixture();
  f.objects.delete(f.never.key);
  const report = await inspectPrivateRawSnapshotEvidence(f.env);
  assert.equal(report.families[0].originalAbsent, 1);
  assert.equal(report.families[0].rawHashVerified, 1);
  assert.equal(report.families[0].rawContainsAtLeastRecordedFacts, 1);
});

test('R2 hash changes and altered metadata never authorize recovery assumptions', async () => {
  const f = await fixture();
  await f.env.RAW_BUCKET.put(f.never.key, rawFacts([999]), {
    customMetadata: { sourceType: 'official_provider', contentHash: f.never.digest }
  });
  const report = await inspectPrivateRawSnapshotEvidence(f.env);
  assert.equal(report.families[0].provenanceConflict, 1);
  assert.equal(report.families[0].rawHashVerified, 1);
  assert.equal(report.families[0].rawContainsAtLeastRecordedFacts, 1);
});

test('stale or unfinished audit is refused before any R2 access', async () => {
  const f = await fixture();
  f.db.prepare('UPDATE storage_cleanup_dataset_revision SET revision=revision+1 WHERE singleton=1').run();
  await assert.rejects(() => inspectPrivateRawSnapshotEvidence(f.env), /raw_diagnostic_dataset_revision_changed/);
  f.db.prepare('UPDATE storage_cleanup_dataset_revision SET revision=revision-1 WHERE singleton=1').run();
  f.db.prepare("UPDATE storage_cleanup_audit_progress SET is_complete=0 WHERE audit_run_id=? AND target='horse_profile:observations'")
    .run(PROOF_ID);
  await assert.rejects(() => inspectPrivateRawSnapshotEvidence(f.env), /raw_diagnostic_incomplete_proof/);
});

test('read-only endpoint rejects unauthorized callers and returns sanitized aggregate only', async () => {
  const f = await fixture();
  const url = 'https://example.invalid/v1/storage-cleanup/raw-evidence/sample';
  assert.equal((await worker.fetch(new Request(url), {})).status, 503);
  assert.equal((await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer incorrect' }
  }), f.env)).status, 401);
  const response = await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer ' + f.env.ADMIN_TOKEN }
  }), f.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, 'read_only_raw_evidence_sample');
  assert.equal(body.budget.rowsWritten, 0);
  assert.equal(JSON.stringify(body).includes(f.partial.key), false);
  assert.equal(f.d1Metrics.runs, 0);
});
