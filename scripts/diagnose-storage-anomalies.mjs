import { fileURLToPath } from 'node:url';

export const SNAPSHOT_DIAGNOSTIC_FAMILIES = Object.freeze({
  horse_profile: Object.freeze({ table: 'horse_profile_snapshots', count: 'horse_profile_count' }),
  horse_stat: Object.freeze({ table: 'horse_stat_snapshots', count: 'horse_stat_count' }),
  horse_record: Object.freeze({ table: 'horse_record_snapshots', count: 'horse_record_count' }),
  person_stat: Object.freeze({ table: 'person_stat_snapshots', count: 'person_stat_count' })
});

const SELECTED_AUDIT = [
  'SELECT id,completed_at,dataset_revision,status,failure_reason,continuation_count',
  'FROM storage_cleanup_audit_runs',
  "WHERE status='failed' AND failure_reason='integrity_anomaly' AND completed_at IS NOT NULL",
  'ORDER BY julianday(completed_at) DESC,id DESC LIMIT 1'
].join(' ');

export const PROOF_QUERY = [
  'WITH selected AS MATERIALIZED (' + SELECTED_AUDIT + ')',
  'SELECT r.status,r.failure_reason,r.continuation_count,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_progress p WHERE p.audit_run_id=r.id) AS target_count,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_progress p WHERE p.audit_run_id=r.id AND (p.is_complete<>1 OR p.pending_page_id IS NOT NULL)) AS pending_targets,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_pages p WHERE p.audit_run_id=r.id AND p.status<>\'accepted\') AS unsettled_pages,',
  'CASE WHEN r.dataset_revision=d.revision THEN 1 ELSE 0 END AS same_revision',
  'FROM selected r JOIN storage_cleanup_dataset_revision d ON d.singleton=1'
].join(' ');

export function summaryQueryForFamily(family) {
  const definition = SNAPSHOT_DIAGNOSTIC_FAMILIES[family];
  if (!definition) throw new Error('unsupported_snapshot_family');
  return [
    'WITH selected AS MATERIALIZED (' + SELECTED_AUDIT + '),',
    'observed AS MATERIALIZED (',
    'SELECT sync.' + definition.count + ' AS expected_count,',
    'COALESCE(counts.actual_count,0) AS actual_count,',
    'CASE WHEN counts.source_record_id IS NULL THEN 1 ELSE 0 END AS ledger_missing,',
    'CASE WHEN sr.raw_object_key IS NULL THEN 1 ELSE 0 END AS raw_key_missing,',
    'CASE WHEN sr.quality_status<>\'normalized_verified_subset\' THEN 1 ELSE 0 END AS unusual_source_quality,',
    "CASE WHEN julianday(sync.processed_at) IS NULL THEN 'unknown' ",
    "WHEN julianday(sync.processed_at)<julianday('2026-09-28T00:00:00Z') THEN 'earlier' ELSE 'later' END AS cohort",
    'FROM selected run JOIN official_snapshot_source_sync sync ON sync.status=\'complete\'',
    'JOIN source_records sr ON sr.id=sync.source_record_id',
    'LEFT JOIN storage_cleanup_audit_source_counts counts ON counts.audit_run_id=run.id',
    "AND counts.family='" + family + "' AND counts.source_record_id=sync.source_record_id",
    'WHERE julianday(sync.processed_at)<=julianday(run.completed_at)',
    '), classified AS (',
    'SELECT *,CASE WHEN expected_count=actual_count THEN \'matched\'',
    "WHEN expected_count>0 AND actual_count=0 THEN 'none_recorded'",
    "WHEN expected_count>actual_count THEN 'partial_shortfall' ELSE 'excess' END AS category",
    'FROM observed)',
    'SELECT cohort,category,COUNT(*) AS sources,',
    'COALESCE(SUM(expected_count),0) AS expected_total,',
    'COALESCE(SUM(actual_count),0) AS actual_total,',
    'COALESCE(SUM(CASE WHEN expected_count>actual_count THEN expected_count-actual_count ELSE 0 END),0) AS missing_total,',
    'COALESCE(SUM(CASE WHEN actual_count>expected_count THEN actual_count-expected_count ELSE 0 END),0) AS excess_total,',
    'COALESCE(SUM(ledger_missing),0) AS no_ledger_rows,',
    'COALESCE(SUM(CASE WHEN expected_count>actual_count AND raw_key_missing=1 THEN 1 ELSE 0 END),0) AS short_sources_without_raw_key,',
    'COALESCE(SUM(CASE WHEN expected_count>actual_count AND unusual_source_quality=1 THEN 1 ELSE 0 END),0) AS short_sources_with_unusual_quality',
    'FROM classified GROUP BY cohort,category ORDER BY cohort,category'
  ].join(' ');
}

export function independentSampleQueryForFamily(family) {
  const definition = SNAPSHOT_DIAGNOSTIC_FAMILIES[family];
  if (!definition) throw new Error('unsupported_snapshot_family');
  return [
    'WITH selected AS MATERIALIZED (' + SELECTED_AUDIT + '),',
    'suspects AS MATERIALIZED (',
    'SELECT sync.source_record_id, sync.' + definition.count + ' AS expected_count,',
    'COALESCE(counts.actual_count,0) AS ledger_count',
    'FROM selected run JOIN official_snapshot_source_sync sync ON sync.status=\'complete\'',
    'LEFT JOIN storage_cleanup_audit_source_counts counts ON counts.audit_run_id=run.id',
    "AND counts.family='" + family + "' AND counts.source_record_id=sync.source_record_id",
    'WHERE sync.' + definition.count + '>COALESCE(counts.actual_count,0)',
    'AND julianday(sync.processed_at)<=julianday(run.completed_at)',
    'ORDER BY sync.source_record_id LIMIT 20),',
    'independent AS MATERIALIZED (',
    'SELECT suspect.expected_count,suspect.ledger_count,',
    '(SELECT COUNT(*) FROM ' + definition.table + ' direct_snapshot',
    'WHERE direct_snapshot.source_record_id=suspect.source_record_id)',
    '+ (SELECT COUNT(*) FROM official_snapshot_observations o',
    'WHERE o.source_record_id=suspect.source_record_id',
    "AND o.snapshot_family='" + family + "'",
    'AND NOT EXISTS (SELECT 1 FROM ' + definition.table + ' same_source_snapshot',
    'WHERE same_source_snapshot.id=o.snapshot_id',
    'AND same_source_snapshot.source_record_id=o.source_record_id)) AS recount',
    'FROM suspects suspect)',
    'SELECT COUNT(*) AS sampled_sources,',
    'COALESCE(SUM(CASE WHEN ledger_count<>recount THEN 1 ELSE 0 END),0) AS audit_counter_disagreements,',
    'COALESCE(SUM(CASE WHEN expected_count>recount THEN 1 ELSE 0 END),0) AS independently_short_sources,',
    'COALESCE(SUM(CASE WHEN expected_count>recount THEN expected_count-recount ELSE 0 END),0) AS independently_missing',
    'FROM independent'
  ].join(' ');
}

function safeInt(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid_diagnostic_integer_' + field);
  return n;
}

export async function diagnoseSnapshotAnomalies(query) {
  if (typeof query !== 'function') throw new Error('missing_read_only_query');
  const proofRows = await query(PROOF_QUERY);
  if (!Array.isArray(proofRows) || proofRows.length !== 1) throw new Error('missing_completed_failed_audit');
  const proof = proofRows[0];
  if (proof.status !== 'failed' || proof.failure_reason !== 'integrity_anomaly'
      || safeInt(proof.target_count, 'targets') !== 22
      || safeInt(proof.pending_targets, 'pending') !== 0
      || safeInt(proof.unsettled_pages, 'unsettled') !== 0) {
    throw new Error('audit_proof_not_complete_or_not_integrity_stopped');
  }
  const families = [];
  for (const name of Object.keys(SNAPSHOT_DIAGNOSTIC_FAMILIES)) {
    const cohorts = await query(summaryQueryForFamily(name));
    if (!Array.isArray(cohorts) || cohorts.length > 12) throw new Error('invalid_diagnostic_cohorts');
    const groups = cohorts.map((r) => {
      if (!['earlier','later','unknown'].includes(r.cohort)
          || !['matched','none_recorded','partial_shortfall','excess'].includes(r.category)) {
        throw new Error('invalid_diagnostic_group');
      }
      return {
        cohort: r.cohort, category: r.category,
        sources: safeInt(r.sources, 'sources'),
        expected: safeInt(r.expected_total, 'expected'),
        actual: safeInt(r.actual_total, 'actual'),
        missing: safeInt(r.missing_total, 'missing'),
        excess: safeInt(r.excess_total, 'excess'),
        noLedgerRows: safeInt(r.no_ledger_rows, 'ledger'),
        shortSourcesWithoutRawKey: safeInt(r.short_sources_without_raw_key, 'raw'),
        shortSourcesWithUnusualQuality: safeInt(r.short_sources_with_unusual_quality, 'quality')
      };
    });
    const checkRows = await query(independentSampleQueryForFamily(name));
    if (!Array.isArray(checkRows) || checkRows.length !== 1) throw new Error('invalid_independent_sample');
    const check = checkRows[0];
    families.push({
      family: name,
      groups,
      sampledSources: safeInt(check.sampled_sources, 'sample'),
      auditCounterDisagreements: safeInt(check.audit_counter_disagreements, 'counter'),
      independentlyShortSources: safeInt(check.independently_short_sources, 'short'),
      independentlyMissing: safeInt(check.independently_missing, 'missing')
    });
  }
  return {
    mode: 'read_only_diagnostic', auditFailedIntegrity: true,
    sameDatasetRevision: safeInt(proof.same_revision, 'revision') === 1,
    continuationCount: safeInt(proof.continuation_count, 'continuations'),
    sampleMethod: 'first_20_source_ids_per_family_in_private_D1',
    cutoffIsApproximate: true,
    families
  };
}

export function createCloudflareReadonlyQuery(env, http = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const database = env.D1_DATABASE_ID;
  if (!token || !account || !/^[0-9a-f-]{36}$/i.test(String(database || ''))) {
    throw new Error('missing_cloudflare_readonly_diagnostic_configuration');
  }
  const budget = { read: 0, requests: 0 };
  const query = async (sql) => {
    if (typeof sql !== 'string' || !/^\s*(?:WITH|SELECT)\b/i.test(sql)
        || /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(sql)
        || sql.includes(';')) {
      throw new Error('non_readonly_sql_denied');
    }
    const url = 'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(account) + '/d1/database/' + encodeURIComponent(database) + '/query';
    const response = await http(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw new Error('read_only_D1_query_http_' + String(response.status));
    const data = await response.json();
    const entry = data?.result?.[0];
    if (data?.success !== true || entry?.success !== true || !Array.isArray(entry?.results)) {
      throw new Error('read_only_D1_query_not_successful');
    }
    const read = safeInt(entry.meta?.rows_read, 'D1_read');
    const written = safeInt(entry.meta?.rows_written, 'D1_written');
    budget.read += read;
    budget.requests += 1;
    if (written !== 0) throw new Error('read_only_D1_query_wrote_rows');
    if (read > 250000 || budget.read > 1000000 || budget.requests > 12) {
      throw new Error('read_only_D1_cost_budget_exhausted');
    }
    return entry.results;
  };
  return { query, getCost: () => ({ rowsRead: budget.read, rowsWritten: 0, requests: budget.requests }) };
}

async function main() {
  const db = createCloudflareReadonlyQuery(process.env);
  const report = await diagnoseSnapshotAnomalies(db.query);
  console.log(JSON.stringify({ ...report, cost: db.getCost() }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // Errors are static diagnostic codes; do not echo private SQL, source IDs,
    // Cloudflare response bodies, API tokens, or provider payloads into GitHub.
    console.error('Read-only anomaly diagnosis stopped: ' + String(error?.message || 'unknown_error'));
    process.exitCode = 1;
  });
}
