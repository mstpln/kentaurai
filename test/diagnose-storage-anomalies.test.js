import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import {
  SNAPSHOT_DIAGNOSTIC_FAMILIES,
  PROOF_QUERY,
  summaryQueryForFamily,
  independentSampleQueryForFamily,
  diagnoseSnapshotAnomalies,
  createCloudflareReadonlyQuery
} from '../scripts/diagnose-storage-anomalies.mjs';

function fixture() {
  const { db } = createTestEnv();
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  db.prepare(
    "INSERT INTO storage_cleanup_audit_runs(id,source_sha,dataset_revision,status,continuation_count,expires_at,completed_at,failure_reason) " +
    "VALUES (?,'1111111111111111111111111111111111111111',0,'failed',20,'2026-10-12T10:00:00Z','2026-10-11T11:00:00Z','integrity_anomaly')"
  ).run(runId);
  const targets = [
    ...Object.keys(SNAPSHOT_DIAGNOSTIC_FAMILIES).flatMap((family) =>
      ['direct_representations','observation_representations','representation_compare','observations','direct_timeline']
        .map((target) => family + ':' + target)),
    'operations:batches','operations:sessions'
  ];
  for (const target of targets) {
    db.prepare("INSERT INTO storage_cleanup_audit_progress(audit_run_id,target,is_complete) VALUES (?,?,1)").run(runId,target);
  }
  db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('synthetic-horse','Synthetic Horse')").run();
  for (const id of ['synthetic-normal','synthetic-missing','synthetic-undercounted']) {
    db.prepare("INSERT INTO source_records(id,source_type,fetched_at,quality_status,raw_object_key) VALUES (?,'official_provider','2026-09-10T08:00:00Z','normalized_verified_subset',?)")
      .run(id,'synthetic/raw.json');
    db.prepare("INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,horse_profile_count) VALUES (?,'complete','2026-10-10 08:00:00',?)")
      .run(id,id==='synthetic-normal'?1:2);
  }
  db.prepare("INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) VALUES ('synthetic-direct-1','synthetic-horse','2026-09-10T08:00:00Z',4,'synthetic-normal')").run();
  db.prepare("INSERT INTO horse_profile_snapshots(id,horse_id,observed_at,age_years,source_record_id) VALUES ('synthetic-direct-2','synthetic-horse','2026-09-10T08:00:00Z',5,'synthetic-undercounted')").run();
  db.prepare("INSERT INTO storage_cleanup_audit_source_counts(audit_run_id,family,source_record_id,actual_count) VALUES (?,'horse_profile','synthetic-normal',1)").run(runId);
  // The other source has one real row but zero in the audit ledger,
  // distinguishing a bad audit counter from genuine absence.
  return { db, runId, query: async (sql) => db.prepare(sql).all() };
}

test('read-only diagnostic uses verified proof and detects both real deficit and audit counter error', async () => {
  const f = fixture();
  assert.equal(f.db.prepare(PROOF_QUERY).get().target_count, 22);
  const report = await diagnoseSnapshotAnomalies(f.query);
  assert.equal(report.mode,'read_only_diagnostic');
  assert.equal(report.sameDatasetRevision,true);
  assert.equal(report.families.length,4);
  const profile=report.families[0];
  const shortfall=profile.groups.filter((group)=>group.missing>0);
  assert.equal(shortfall.reduce((n,g)=>n+g.missing,0),4);
  assert.equal(profile.sampledSources,2);
  assert.equal(profile.auditCounterDisagreements,1);
  assert.equal(profile.independentlyShortSources,2);
  assert.equal(profile.independentlyMissing,3);
  assert.equal(JSON.stringify(report).includes('synthetic-missing'),false);
  assert.equal(JSON.stringify(report).includes('synthetic-undercounted'),false);
  assert.equal(JSON.stringify(report).includes('synthetic/raw.json'),false);
});

test('all diagnostic queries are read-only and never select unaggregated source IDs for GitHub', () => {
  for(const family of Object.keys(SNAPSHOT_DIAGNOSTIC_FAMILIES)) {
    for (const sql of [summaryQueryForFamily(family),independentSampleQueryForFamily(family)]) {
      const s=sql.toUpperCase();
      assert.match(s,/^WITH SELECTED AS MATERIALIZED/);
      assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
      assert.doesNotMatch(s,/\bSOURCE_RECORD_ID\s+AS\s+OUTPUT_ID\b/);
    }
  }
  assert.throws(()=>summaryQueryForFamily('unknown'),/unsupported_snapshot_family/);
});

test('no incomplete or partially settled audit can be used for diagnostics', async () => {
  const f=fixture();
  f.db.prepare("UPDATE storage_cleanup_audit_progress SET is_complete=0 WHERE audit_run_id=? AND target='horse_profile:direct_representations'").run(f.runId);
  await assert.rejects(()=>diagnoseSnapshotAnomalies(f.query),/audit_proof_not_complete/);
});

test('Cloudflare query client rejects SQL mutation, excessive read cost and nonzero writes', async () => {
  const configuration={CLOUDFLARE_API_TOKEN:'synthetic',CLOUDFLARE_ACCOUNT_ID:'synthetic',D1_DATABASE_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  let requests=0;
  const mockFetch=async (_url,options)=>{
    requests++;
    assert.equal(options.method,'POST');
    assert.deepEqual(Object.keys(JSON.parse(options.body)),['sql']);
    return {ok:true,json:async()=>({success:true,result:[{success:true,results:[],meta:{rows_read:100,rows_written:0}}]})};
  };
  const client=createCloudflareReadonlyQuery(configuration,mockFetch);
  await assert.rejects(()=>client.query('DELETE FROM storage_cleanup_audit_runs'),/non_readonly_sql_denied/);
  await assert.rejects(()=>client.query('WITH s AS (DELETE FROM source_records) SELECT * FROM s'),/non_readonly_sql_denied/);
  assert.deepEqual(await client.query('SELECT COUNT(*) AS n FROM source_records'),[]);
  assert.equal(client.getCost().rowsRead,100);
  assert.equal(requests,1);
  const writes=createCloudflareReadonlyQuery(configuration,async()=>({ok:true,json:async()=>({success:true,result:[{success:true,results:[],meta:{rows_read:1,rows_written:1}}]})}));
  await assert.rejects(()=>writes.query('SELECT 1'),/read_only_D1_query_wrote_rows/);
  const expensive=createCloudflareReadonlyQuery(configuration,async()=>({ok:true,json:async()=>({success:true,result:[{success:true,results:[],meta:{rows_read:250001,rows_written:0}}]})}));
  await assert.rejects(()=>expensive.query('SELECT 1'),/read_only_D1_cost_budget_exhausted/);
  assert.throws(()=>createCloudflareReadonlyQuery({},mockFetch),/missing_cloudflare/);
});


test('production diagnostic workflow runs only on reviewed main, isolates Cloudflare secrets and shares safety lock', () => {
  const workflow=readFileSync(new URL('../.github/workflows/production-storage-anomaly-diagnosis.yml', import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/push:\s*\n\s+branches: \[main\]\s*\n\s+paths:/);
  assert.match(workflow,/group: kentaurai-production-operation/);
  assert.match(workflow,/cancel-in-progress: false/);
  const qa=workflow.split('      - name: Run QA on diagnostic code')[1]
    ?.split('      - name: Read precomputed audit evidence')[0];
  assert.ok(qa);
  assert.doesNotMatch(qa,/CLOUDFLARE_API_TOKEN/);
  const operation=workflow.split('      - name: Read precomputed audit evidence')[1]
    ?.split('      - name: Report boundaries')[0];
  assert.match(operation,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(operation,/run: node scripts\/diagnose-storage-anomalies\.mjs/);
  assert.doesNotMatch(workflow,/\bwrangler\s+(?:deploy|d1 migrations|d1 execute)\b/);
});
