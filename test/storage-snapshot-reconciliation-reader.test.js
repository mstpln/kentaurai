import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import { inspectPrivateSnapshotReconciliationPage } from '../src/storage-snapshot-reconciliation-reader.js';
import worker from '../src/index.js';
import productionWorker from '../src/worker-v079.js';

const AUDIT = '11111111-1111-4111-8111-111111111111';
const FETCHED = '2026-09-12T10:00:00Z';
const FAMILIES = ['horse_profile', 'horse_stat', 'horse_record', 'person_stat'];

function proof(db) {
  db.prepare(
    "INSERT INTO storage_cleanup_audit_runs(id,source_sha,dataset_revision,status,continuation_count,expires_at,completed_at,failure_reason) " +
    "VALUES (?,? ,0,'failed',20,'2026-10-15T00:00:00Z','2026-10-11T12:00:00Z','integrity_anomaly')"
  ).run(AUDIT, 'a'.repeat(40));
  for (const target of [
    ...FAMILIES.flatMap((family) =>
      ['direct_representations','observation_representations','representation_compare','observations','direct_timeline']
        .map((suffix) => family + ':' + suffix)),
    'operations:batches', 'operations:sessions'
  ]) {
    db.prepare("INSERT INTO storage_cleanup_audit_progress(audit_run_id,target,is_complete) VALUES (?,?,1)")
      .run(AUDIT, target);
  }
}

function payload() {
  return {
    races: [{ starts: [
      { horse: { id: 100, age: 4, record: { code: 'aM' },
        statistics: { life: { starts: 10 } },
        trainer: { id: 601 } },
        driver: { id: 501, statistics: { years: { '2026': { starts: 12 } } } } },
      { horse: { id: 101, age: 5, record: { code: 'aK' },
        statistics: { life: { starts: 20 } },
        trainer: { id: 601, statistics: { years: { '2026': { starts: 30 } } } } },
        driver: { id: 501 } }
    ] }]
  };
}

async function addSource(f, sourceId = 'src-a', { matching = true, putRaw = true } = {}) {
  const text = JSON.stringify(payload());
  const hash = createHash('sha256').update(text).digest('hex');
  const key = 'raw/official_provider/' + hash + '.json';
  f.db.prepare(
    "INSERT INTO source_records(id,source_type,external_id,fetched_at,raw_object_key,content_hash,quality_status) " +
    "VALUES (?,'official_provider',?,?,?,?,'normalized_verified_subset')"
  ).run(sourceId, sourceId, FETCHED, key, hash);
  f.db.prepare(
    "INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at," +
    "horse_profile_count,horse_stat_count,horse_record_count,person_stat_count) " +
    "VALUES (?,'complete','2026-09-20 10:00:00',2,2,2,2)"
  ).run(sourceId);
  for (const family of FAMILIES) {
    f.db.prepare(
      'INSERT INTO storage_cleanup_audit_source_counts(audit_run_id,family,source_record_id,actual_count) VALUES (?,?,?,1)'
    ).run(AUDIT, family, sourceId);
  }
  const age = matching ? 4 : 99;
  f.db.prepare(
    'INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) VALUES (?,?,?,?,?)'
  ).run(sourceId + ':profile', 'h100', FETCHED, age, sourceId);
  f.db.prepare(
    'INSERT INTO horse_stat_snapshots(id,horse_id,observed_at,snapshot_scope,starts,source_record_id) VALUES (?,?,?,?,?,?)'
  ).run(sourceId + ':stat', 'h100', FETCHED, 'life', 10, sourceId);
  f.db.prepare(
    'INSERT INTO horse_record_snapshots(id,horse_id,observed_at,record_scope,record_ordinal,code,source_record_id) ' +
    "VALUES (?,?,?,'current',0,'aM',?)"
  ).run(sourceId + ':record', 'h100', FETCHED, sourceId);
  f.db.prepare(
    "INSERT INTO person_stat_snapshots(id,person_type,person_id,observed_at,stat_year,starts,source_record_id) " +
    "VALUES (?,'driver','d501',?,2026,12,?)"
  ).run(sourceId + ':person', FETCHED, sourceId);
  if (putRaw) await f.env.RAW_BUCKET.put(key, text, {
    customMetadata: { contentHash: hash, sourceType: 'official_provider' },
    httpMetadata: { contentType: 'application/json' }
  });
  return { key, hash, body: text, id: sourceId };
}

async function fixture(options = {}) {
  const f = createTestEnv();
  proof(f.db);
  for (const [table, entries] of [
    ['horses', [['h100','Synthetic Horse One'],['h101','Synthetic Horse Two']]],
    ['drivers', [['d501','Synthetic Driver']]],
    ['trainers', [['t601','Synthetic Trainer']]]
  ]) {
    for (const [id, name] of entries) {
      f.db.prepare('INSERT INTO ' + table + '(id,canonical_name) VALUES (?,?)').run(id, name);
    }
  }
  for (const [table, column, mappings] of [
    ['horse_external_ids','horse_id',[['h100','100'],['h101','101']]],
    ['driver_external_ids','driver_id',[['d501','501']]],
    ['trainer_external_ids','trainer_id',[['t601','601']]]
  ]) {
    for (const [canonical, external] of mappings) {
      f.db.prepare('INSERT INTO ' + table + '(' + column + ',source_type,external_id) VALUES (?,?,?)')
        .run(canonical, 'official', external);
    }
  }
  const first = await addSource(f, 'src-a', options);
  return { ...f, first };
}

test('all four families reconcile individual original facts with direct D1 evidence', async () => {
  const f = await fixture();
  for (const family of FAMILIES) {
    const report = await inspectPrivateSnapshotReconciliationPage(f.env, { family });
    assert.equal(report.originalVerified, 1);
    assert.equal(report.sourcesExamined, 1);
    assert.equal(report.extractedFacts, 2);
    assert.equal(report.classifications.represented, 1);
    assert.equal(report.classifications.missing_unverified_chronology, 1);
    assert.equal(report.classifications.missing_candidate, 0);
    assert.equal(report.actualLogicalRepresentations, 1);
    assert.equal(report.auditLedgerVerified, true);
    assert.equal(report.ledgerShortfall, 1);
    assert.equal(report.repairAuthorized, false);
    assert.equal(report.historicalIdentityProofEstablished, false);
    assert.equal(report.completeChronologyProofEstablished, false);
    assert.equal(report.revisionCounterMatchesProof, true);
    assert.equal(report.budget.rowsWritten, 0);
    assert.ok(report.budget.rowsRead <= 1000000);
    assert.ok(report.cursor);
  }
  assert.equal(f.d1Metrics.runs, 0);
  assert.equal(f.d1Metrics.batches, 0);
});

test('encrypted cursor supports deterministic pagination without disclosing source IDs', async () => {
  const f = await fixture();
  await addSource(f, 'src-b');
  const first = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(first.done, false);
  assert.ok(!first.cursor.includes('src-a'));
  const second = await inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_profile', cursor: first.cursor
  });
  assert.equal(second.sourcesExamined, 1);
  const done = await inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_profile', cursor: second.cursor
  });
  assert.equal(done.done, true);
  assert.equal(done.cursor, null);
  assert.equal(done.sourcesExamined, 0);
  assert.ok(!JSON.stringify(first).includes('src-a'));
  assert.ok(!JSON.stringify(second).includes('src-b'));
  await assert.rejects(() => inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_stat', cursor: first.cursor
  }), /reconciliation_cursor_not_current/);
  const position = 24;
  const altered = first.cursor.slice(0, position) +
    (first.cursor[position] === 'A' ? 'B' : 'A') + first.cursor.slice(position + 1);
  await assert.rejects(() => inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_profile', cursor: altered
  }), /reconciliation_cursor_invalid/);
});

test('conflicting original factual values are never silently treated as present', async () => {
  const f = await fixture({ matching: false });
  const report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(report.classifications.conflict, 1);
  assert.equal(report.classifications.missing_unverified_chronology, 1);
  assert.equal(report.classifications.represented, 0);
});

test('missing raw originals, hash changes and oversized bodies are quarantined', async () => {
  const f = await fixture();
  f.objects.delete(f.first.key);
  let report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_stat' });
  assert.equal(report.originalMissing, 1);
  assert.equal(report.auditLedgerVerified, false);

  await f.env.RAW_BUCKET.put(f.first.key, f.first.body + ' ', {
    customMetadata: { contentHash: f.first.hash, sourceType: 'official_provider' }
  });
  report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_stat' });
  assert.equal(report.provenanceConflicts, 1);

  await f.env.RAW_BUCKET.put(f.first.key, 'x'.repeat(8 * 1024 * 1024 + 1), {});
  report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_stat' });
  assert.equal(report.originalDeferred, 1);
});

test('mismatched audit counters and dataset revision fail closed', async () => {
  const f = await fixture();
  f.db.prepare(
    "UPDATE storage_cleanup_audit_source_counts SET actual_count=0 WHERE audit_run_id=? AND family='horse_profile'"
  ).run(AUDIT);
  await assert.rejects(() => inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_profile'
  }), /reconciliation_audit_count_disagrees/);
  f.db.prepare('UPDATE storage_cleanup_dataset_revision SET revision=1 WHERE singleton=1').run();
  await assert.rejects(() => inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_stat'
  }), /reconciliation_proof_not_current/);
});

test('D1 budget excess is rejected before any original file is read', async () => {
  const f = await fixture();
  const db = f.env.DB;
  let gets = 0;
  const raw = f.env.RAW_BUCKET;
  f.env.RAW_BUCKET = { head: (key) => raw.head(key),
    get: async (key) => { gets++; return raw.get(key); } };
  f.env.DB = {
    prepare: (sql) => ({
      bind: (...params) => ({
        all: async () => {
          const result = await db.prepare(sql).bind(...params).all();
          return { ...result, meta: { ...result.meta, rows_read: 250001 } };
        }
      })
    })
  };
  await assert.rejects(() => inspectPrivateSnapshotReconciliationPage(f.env, {
    family: 'horse_record'
  }), /reconciliation_D1_cost_stop/);
  assert.equal(gets, 0);
});

test('private Worker route needs auth, returns generic aggregates and cannot write', async () => {
  const f = await fixture();
  const url = 'https://example.invalid/v1/storage-cleanup/reconciliation/page?family=person_stat';
  assert.equal((await worker.fetch(new Request(url), {})).status, 503);
  assert.equal((await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer wrong' }
  }), f.env)).status, 401);
  const response = await worker.fetch(new Request(url, {
    headers: { authorization: 'Bearer ' + f.env.ADMIN_TOKEN }
  }), f.env);
  assert.equal(response.status, 200);
  const report = await response.json();
  for (const value of [AUDIT, f.first.id, f.first.key, f.first.hash,
    'h100', 'd501', 't601', 'Synthetic Horse']) {
    assert.equal(JSON.stringify(report).includes(value), false, 'private reference leaked');
  }
  assert.equal(report.classifications.represented, 1);
  assert.equal(report.repairAuthorized, false);
  assert.equal(f.d1Metrics.runs, 0);
  assert.equal(f.d1Metrics.batches, 0);
});


test('historical cross-source observation is read and value-matched by snapshot id', async () => {
  const f = await fixture();
  f.db.prepare(
    "INSERT INTO source_records(id,source_type,fetched_at,quality_status) " +
    "VALUES ('src-prior','official_provider','2026-09-10T10:00:00Z','normalized_verified_subset')"
  ).run();
  f.db.prepare(
    "INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,horse_profile_count) " +
    "VALUES ('src-prior','complete','2026-09-20 10:00:00',1)"
  ).run();
  f.db.prepare("DELETE FROM horse_profile_snapshots WHERE id='src-a:profile'").run();
  f.db.prepare(
    'INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) ' +
    "VALUES ('old-snapshot','h100','2026-09-10T10:00:00Z',4,'src-prior')"
  ).run();
  f.db.prepare(
    "INSERT INTO official_snapshot_observations(source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed) " +
    "VALUES ('src-a','horse_profile','h100','profile',?,'old-snapshot',0)"
  ).run(FETCHED);
  const report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(report.auditLedgerVerified, true);
  assert.equal(report.actualLogicalRepresentations, 1);
  assert.equal(report.classifications.represented, 1);
  assert.equal(report.classifications.missing_unverified_chronology, 1);

  f.db.prepare(
    "UPDATE official_snapshot_observations SET factual_changed=1 " +
    "WHERE source_record_id='src-a' AND snapshot_family='horse_profile'"
  ).run();
  const wrongMarker = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(wrongMarker.classifications.conflict, 1);
  f.db.prepare(
    "UPDATE official_snapshot_observations SET factual_changed=0 " +
    "WHERE source_record_id='src-a' AND snapshot_family='horse_profile'"
  ).run();

  f.db.prepare("UPDATE horse_profile_snapshots SET age_years=7 WHERE id='old-snapshot'").run();
  const conflict = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(conflict.classifications.conflict, 1);
  assert.equal(conflict.classifications.represented, 0);

  f.db.prepare("UPDATE horse_profile_snapshots SET age_years=4 WHERE id='old-snapshot'").run();
  f.db.prepare(
    "UPDATE source_records SET fetched_at='2026-09-13T00:00:00Z' WHERE id='src-prior'"
  ).run();
  const invalidLineage = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(invalidLineage.classifications.conflict, 1);
});

test('historical identity drift never authorizes reconstruction against a different horse', async () => {
  const f = await fixture();
  f.db.prepare("UPDATE horse_external_ids SET external_id='901' WHERE external_id='100'").run();
  const report = await inspectPrivateSnapshotReconciliationPage(f.env, { family: 'horse_profile' });
  assert.equal(report.classifications.missing_identity, 1);
  assert.equal(report.classifications.missing_candidate, 0);
});

test('the manual public Actions workflow does not print private cursor or run a write command', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/production-storage-fact-reconciliation.yml', import.meta.url), 'utf8'
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: kentaurai-production-operation/);
  assert.match(workflow, /\.workflow_runs\[0\]\.head_sha/);
  assert.match(workflow, /Run full QA without Cloudflare credentials/);
  assert.match(workflow, /Remove temporary credential/);
  assert.match(workflow, /always\(\)/);
  assert.match(workflow, /secret delete STORAGE_CLEANUP_TOKEN/);
  assert.match(workflow, /repairAuthorized == false/);
  assert.match(workflow, /revisionCounterMatchesProof == true/);
  assert.match(workflow, /historicalIdentityProofEstablished == false/);
  assert.match(workflow, /jq -c '\{family,sourcesExamined/);
  const printed = workflow.split('            jq -c ')[1]?.split(' "$output"')[0] || '';
  assert.doesNotMatch(printed, /\bcursor\b|\bsource_record_id\b|\braw_object_key\b/);
  assert.doesNotMatch(workflow, /\bwrangler (?:deploy|d1 execute|d1 migrations)\b/);
});


test('deployed Worker entrypoint enforces private API authentication before any D1/R2 reads', async () => {
  const f = await fixture();
  const url = 'https://example.invalid/v1/storage-cleanup/reconciliation/page?family=horse_profile';
  const before = { ...f.d1Metrics };
  const noAuth = await productionWorker.fetch(new Request(url), f.env);
  assert.equal(noAuth.status, 401);
  const body = await noAuth.json();
  assert.equal(body.error, 'unauthorized');
  assert.deepEqual(f.d1Metrics, before);

  const authorized = await productionWorker.fetch(new Request(url, {
    headers: { authorization: 'Bearer ' + f.env.ADMIN_TOKEN }
  }), f.env);
  assert.equal(authorized.status, 200);
  const result = await authorized.json();
  assert.equal(result.classificationOnly, true);
  assert.equal(result.repairAuthorized, false);
  assert.equal(f.d1Metrics.runs, 0);
  assert.equal(f.d1Metrics.batches, 0);
});

test('production release verifies unauthenticated reconciliation route on exact deployed Worker', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/production-release-v060.yml', import.meta.url), 'utf8'
  );
  assert.match(workflow, /'\/v1\/storage-cleanup\/reconciliation\/page\?family=horse_profile'/);
  assert.match(workflow, /Expected \$path to return 401 without authorization/);
});


test('all four families keep predecessor reports aggregate-only and explicitly unverified', async () => {
  const f = await fixture();
  for (const family of FAMILIES) {
    const report = await inspectPrivateSnapshotReconciliationPage(f.env, { family });
    assert.deepEqual(report.predecessorHints, {
      examined: 1, deferred: 0, noEarlierDirect: 1,
      earlierCompletedSourceSameFacts: 0,
      earlierCompletedSourceDifferentFacts: 0,
      earlierUnconfirmedSource: 0,
      historicalIdentityVerified: false,
      completeChronologyVerified: false,
      repairAuthorized: false
    });
    assert.equal(report.budget.rowsWritten, 0);
    assert.ok(report.budget.queries <= 40);
    for (const secret of [f.first.id, 'h101', 't601', 'Synthetic Horse']) {
      assert.equal(JSON.stringify(report).includes(secret), false);
    }
  }
});

test('verified same-value predecessor is an observation hint, not repair authorization', async () => {
  const f = await fixture();
  const before = '2026-09-10T09:00:00Z';
  f.db.prepare(
    "INSERT INTO source_records(id,source_type,fetched_at,quality_status) " +
    "VALUES ('earlier','official_provider',?,'normalized_verified_subset')"
  ).run(before);
  f.db.prepare(
    "INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,horse_profile_count) " +
    "VALUES ('earlier','complete','2026-09-10T10:00:00Z',1)"
  ).run();
  f.db.prepare(
    "INSERT INTO storage_cleanup_audit_source_counts(audit_run_id,family,source_record_id,actual_count) " +
    "VALUES (?,'horse_profile','earlier',1)"
  ).run(AUDIT);
  f.db.prepare(
    "INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id,quality_status) " +
    "VALUES ('earlier-h101','h101',?,5,'earlier','verified_official_snapshot')"
  ).run(before);
  const view = () => inspectPrivateSnapshotReconciliationPage(f.env, { family:'horse_profile' });
  let report = await view();
  assert.equal(report.predecessorHints.earlierCompletedSourceSameFacts, 1);
  assert.equal(report.predecessorHints.earlierCompletedSourceDifferentFacts, 0);
  assert.equal(report.classifications.missing_unverified_chronology, 1);
  assert.equal(report.classifications.missing_candidate, 0);
  assert.equal(report.predecessorHints.repairAuthorized, false);

  f.db.prepare("UPDATE horse_profile_snapshots SET age_years=6 WHERE id='earlier-h101'").run();
  report = await view();
  assert.equal(report.predecessorHints.earlierCompletedSourceDifferentFacts, 1);
  assert.equal(report.predecessorHints.earlierCompletedSourceSameFacts, 0);

  f.db.prepare("UPDATE official_snapshot_source_sync SET status='failed' WHERE source_record_id='earlier'").run();
  report = await view();
  assert.equal(report.predecessorHints.earlierUnconfirmedSource, 1);
  assert.equal(report.predecessorHints.earlierCompletedSourceDifferentFacts, 0);
});

test('record scope and ordinal are respected by predecessor lookup', async () => {
  const f = await fixture();
  const before = '2026-09-10T09:00:00Z';
  f.db.prepare(
    "INSERT INTO source_records(id,source_type,fetched_at,quality_status) " +
    "VALUES ('earlier-record','official_provider',?,'normalized_verified_subset')"
  ).run(before);
  f.db.prepare(
    "INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,horse_record_count) " +
    "VALUES ('earlier-record','complete','2026-09-10T10:00:00Z',1)"
  ).run();
  f.db.prepare(
    "INSERT INTO storage_cleanup_audit_source_counts(audit_run_id,family,source_record_id,actual_count) " +
    "VALUES (?,'horse_record','earlier-record',1)"
  ).run(AUDIT);
  f.db.prepare(
    "INSERT INTO horse_record_snapshots(id,horse_id,observed_at,record_scope,record_ordinal,code,source_record_id,quality_status) " +
    "VALUES ('rec-other','h101',?,'life',0,'aK','earlier-record','verified_official_snapshot')"
  ).run(before);
  let report = await inspectPrivateSnapshotReconciliationPage(f.env, { family:'horse_record' });
  assert.equal(report.predecessorHints.noEarlierDirect, 1);
  f.db.prepare("UPDATE horse_record_snapshots SET record_scope='current' WHERE id='rec-other'").run();
  report = await inspectPrivateSnapshotReconciliationPage(f.env, { family:'horse_record' });
  assert.equal(report.predecessorHints.earlierCompletedSourceSameFacts, 1);
});
