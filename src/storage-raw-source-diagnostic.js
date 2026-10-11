import { collectOfficialSnapshotFacts } from './import/official-snapshots.js';

// Only aggregate read-only classification is returned. Source IDs, horse IDs,
// R2 keys/hashes, source payloads and per-source findings remain private.
const FAMILIES = Object.freeze({
  horse_profile: Object.freeze({ column: 'horse_profile_count', facts: 'horseProfiles' }),
  horse_stat: Object.freeze({ column: 'horse_stat_count', facts: 'horseStats' }),
  horse_record: Object.freeze({ column: 'horse_record_count', facts: 'horseRecords' }),
  person_stat: Object.freeze({ column: 'person_stat_count', facts: 'personStats' })
});
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_OBJECT_READS = 16;
const MAX_D1_READS_PER_QUERY = 250_000;
const MAX_D1_READS_TOTAL = 1_000_000;
const MAX_D1_QUERIES = 12;

const PROOF_SQL = [
  'SELECT a.id AS internal_audit_id,a.completed_at,a.dataset_revision,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_progress p WHERE p.audit_run_id=a.id) AS target_count,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_progress p WHERE p.audit_run_id=a.id',
  'AND (p.is_complete<>1 OR p.pending_page_id IS NOT NULL)) AS unfinished,',
  '(SELECT COUNT(*) FROM storage_cleanup_audit_pages p WHERE p.audit_run_id=a.id',
  "AND p.status<>'accepted') AS unsettled,",
  '(SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1) AS current_revision',
  'FROM storage_cleanup_audit_runs a',
  "WHERE a.status='failed' AND a.failure_reason='integrity_anomaly'",
  'AND a.completed_at IS NOT NULL',
  'ORDER BY julianday(a.completed_at) DESC,a.id DESC LIMIT 1'
].join(' ');

function safeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('raw_diagnostic_invalid_integer');
  return number;
}

function makeReadOnlyQuery(env) {
  let rowsRead = 0;
  let queryCount = 0;
  const query = async (sql, ...params) => {
    if (!/^\s*SELECT\b/i.test(sql) || sql.includes(';') ||
        /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i.test(sql)) {
      throw new Error('raw_diagnostic_nonselect_query');
    }
    if (++queryCount > MAX_D1_QUERIES) throw new Error('raw_diagnostic_query_cap');
    const result = await env.DB.prepare(sql).bind(...params).all();
    if (!Array.isArray(result?.results) || result?.success === false) {
      throw new Error('raw_diagnostic_query_failed');
    }
    const read = safeInteger(result.meta?.rows_read);
    const written = safeInteger(result.meta?.rows_written);
    if (written !== 0 || read > MAX_D1_READS_PER_QUERY || (rowsRead += read) > MAX_D1_READS_TOTAL) {
      throw new Error('raw_diagnostic_D1_budget_stop');
    }
    return result.results;
  };
  return { query, cost: () => ({ rowsRead, rowsWritten: 0, queries: queryCount }) };
}

function sourceSampleSql(family, kind) {
  const definition = FAMILIES[family];
  if (!definition || !['without_ledger','partial'].includes(kind)) throw new Error('raw_diagnostic_invalid_selection');
  return [
    'SELECT s.source_record_id,s.' + definition.column + ' AS expected_count,',
    'COALESCE(c.actual_count,0) AS observed_count,',
    'sr.raw_object_key,sr.content_hash,sr.quality_status',
    'FROM official_snapshot_source_sync s INDEXED BY idx_official_snapshot_source_sync_status_source',
    'JOIN source_records sr ON sr.id=s.source_record_id',
    'LEFT JOIN storage_cleanup_audit_source_counts c',
    'ON c.audit_run_id=? AND c.family=? AND c.source_record_id=s.source_record_id',
    "WHERE s.status='complete' AND sr.source_type='official_provider'",
    'AND julianday(s.processed_at)<=julianday(?)',
    'AND s.' + definition.column + '>COALESCE(c.actual_count,0)',
    kind === 'without_ledger' ? 'AND c.source_record_id IS NULL' : 'AND c.source_record_id IS NOT NULL',
    'ORDER BY s.source_record_id LIMIT ?'
  ].join(' ');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function inspectRawObject(env, source, budget) {
  const key = source.raw_object_key;
  if (typeof key !== 'string' || !key) return { status: 'missing_raw_reference' };
  if (typeof env.RAW_BUCKET.head !== 'function' || typeof env.RAW_BUCKET.get !== 'function') {
    return { status: 'raw_binding_unavailable' };
  }
  if (budget.cache.has(key)) return budget.cache.get(key);
  if (budget.reads >= MAX_OBJECT_READS) return { status: 'object_budget_exhausted' };
  let metadata;
  try {
    metadata = await env.RAW_BUCKET.head(key);
  } catch {
    return { status: 'raw_read_error' };
  }
  if (!metadata) return { status: 'raw_object_missing' };
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_BYTES) {
    return { status: 'raw_object_too_large' };
  }
  if (budget.bytes + size > MAX_TOTAL_BYTES) return { status: 'object_budget_exhausted' };
  budget.bytes += size;
  budget.reads++;
  let body;
  try {
    const object = await env.RAW_BUCKET.get(key);
    if (!object) return { status: 'raw_object_missing' };
    body = await object.text();
  } catch {
    return { status: 'raw_read_error' };
  }
  if (new TextEncoder().encode(body).byteLength !== size) {
    return { status: 'raw_object_size_conflict' };
  }
  const hash = await sha256Hex(body);
  const metadataHash = metadata.customMetadata?.contentHash;
  const metadataSource = metadata.customMetadata?.sourceType;
  const result = {
    status: 'hash_verified',
    hash,
    metadataConflict: (metadataHash != null && metadataHash !== hash)
      || (metadataSource != null && metadataSource !== 'official_provider')
  };
  try {
    const facts = collectOfficialSnapshotFacts(JSON.parse(body));
    result.counts = Object.fromEntries(
      Object.entries(FAMILIES).map(([family, definition]) => [family, facts[definition.facts].size])
    );
  } catch {
    result.status = 'raw_json_or_facts_invalid';
  }
  budget.cache.set(key, result);
  return result;
}

function blankFamily(family) {
  return {
    family,
    sampled: 0,
    noLedger: 0,
    partial: 0,
    rawHashVerified: 0,
    rawContainsAtLeastRecordedFacts: 0,
    rawBelowRecordedFacts: 0,
    originalAbsent: 0,
    originalInvalid: 0,
    provenanceConflict: 0,
    deferredByBudget: 0,
    rawBindingUnavailable: 0
  };
}

export async function inspectPrivateRawSnapshotEvidence(env) {
  if (!env?.DB || !env?.RAW_BUCKET) throw new Error('raw_diagnostic_bindings_missing');
  const reader = makeReadOnlyQuery(env);
  const proof = await reader.query(PROOF_SQL);
  if (proof.length !== 1 || safeInteger(proof[0].target_count) !== 22
      || safeInteger(proof[0].unfinished) !== 0
      || safeInteger(proof[0].unsettled) !== 0) {
    throw new Error('raw_diagnostic_incomplete_proof');
  }
  if (safeInteger(proof[0].dataset_revision) !== safeInteger(proof[0].current_revision)) {
    throw new Error('raw_diagnostic_dataset_revision_changed');
  }
  const audit = proof[0]; // private audit ID remains inside Worker
  const budget = { reads: 0, bytes: 0, cache: new Map() };
  const families = [];
  for (const family of Object.keys(FAMILIES)) {
    const summary = blankFamily(family);
    for (const [kind, limit] of [['without_ledger', 1], ['partial', 3]]) {
      const sources = await reader.query(sourceSampleSql(family, kind),
        audit.internal_audit_id, family, audit.completed_at, limit);
      for (const source of sources) {
        summary.sampled++;
        if (kind === 'without_ledger') summary.noLedger++;
        else summary.partial++;
        const inspection = await inspectRawObject(env, source, budget);
        if (inspection.status === 'object_budget_exhausted') {
          summary.deferredByBudget++;
        } else if (inspection.status === 'raw_binding_unavailable') {
          summary.rawBindingUnavailable++;
        } else if (['missing_raw_reference','raw_object_missing'].includes(inspection.status)) {
          summary.originalAbsent++;
        } else if (inspection.status !== 'hash_verified') {
          summary.originalInvalid++;
        } else if (!/^[a-f0-9]{64}$/.test(String(source.content_hash || ''))
          || source.content_hash !== inspection.hash
          || inspection.metadataConflict
          || source.quality_status !== 'normalized_verified_subset') {
          summary.provenanceConflict++;
        } else {
          summary.rawHashVerified++;
          if (safeInteger(inspection.counts[family]) >= safeInteger(source.expected_count)) {
            summary.rawContainsAtLeastRecordedFacts++;
          } else {
            summary.rawBelowRecordedFacts++;
          }
        }
      }
    }
    families.push(summary);
  }
  // Concurrent imports must not turn a changing dataset into approved evidence.
  const revisions = await reader.query(
    'SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1'
  );
  if (revisions.length !== 1 ||
      safeInteger(revisions[0].revision) !== safeInteger(audit.dataset_revision)) {
    throw new Error('raw_diagnostic_dataset_revision_changed');
  }
  return {
    mode: 'read_only_raw_evidence_sample',
    classificationOnly: true,
    snapshotFactsNotRestored: true,
    revisionCounterMatchesProof: true,
    sampleRule: 'first_deficient_source_per_family_without_ledger_plus_first_three_partial_sources',
    families,
    budget: {
      r2ObjectsRead: budget.reads,
      r2BytesRead: budget.bytes,
      ...reader.cost()
    }
  };
}
