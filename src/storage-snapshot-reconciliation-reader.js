// Private, cost-bounded, immutable-original comparison. No D1/R2 writes.
// The returned cursor is AES-GCM encrypted; the underlying source id never
// leaves the Worker as plaintext. Treat its presence as pagination, not proof.
import { collectOfficialSnapshotFacts } from './import/official-snapshots.js';
import { reconcileSnapshotFacts, snapshotFactMatches, SNAPSHOT_RECONCILIATION_STATUSES } from './storage-snapshot-reconciliation.js';

const FAMILY = Object.freeze({
  horse_profile: Object.freeze({
    table: 'horse_profile_snapshots', count: 'horse_profile_count', facts: 'horseProfiles',
    select: "id,source_record_id,observed_at,quality_status,horse_id AS entity_key,'profile' AS scope_key,age_years"
  }),
  horse_stat: Object.freeze({
    table: 'horse_stat_snapshots', count: 'horse_stat_count', facts: 'horseStats',
    select: 'id,source_record_id,observed_at,quality_status,horse_id AS entity_key,snapshot_scope AS scope_key,stat_year,starts,earnings_raw,wins,seconds,thirds,win_percentage_raw,place_percentage_raw,earnings_per_start_raw,start_points'
  }),
  horse_record: Object.freeze({
    table: 'horse_record_snapshots', count: 'horse_record_count', facts: 'horseRecords',
    select: "id,source_record_id,observed_at,quality_status,horse_id AS entity_key,(CASE WHEN record_scope='year' THEN 'year:' || stat_year ELSE record_scope END) || ':' || record_ordinal AS scope_key,record_scope,stat_year,record_ordinal,code,start_method,distance_group,time_minutes,time_seconds,time_tenths,place"
  }),
  person_stat: Object.freeze({
    table: 'person_stat_snapshots', count: 'person_stat_count', facts: 'personStats',
    select: "id,source_record_id,observed_at,quality_status,person_type || ':' || person_id AS entity_key,CAST(stat_year AS TEXT) AS scope_key,person_type,stat_year,starts,earnings_raw,wins,seconds,thirds,win_percentage_raw"
  })
});

const PROOF_SQL = [
  'SELECT a.id AS proof_id,a.completed_at,a.dataset_revision,',
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

const MAX_D1_READS_QUERY = 250000;
const MAX_D1_READS_REQUEST = 1000000;
const MAX_D1_QUERIES = 40;
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_FACTS = 512;
const MAX_ROWS = 1024;
const MAX_IDS_PER_QUERY = 75;
const MAX_PREDECESSOR_CHECKS = 24;
const MAX_PREDECESSOR_R2_SOURCES = 4;
const MAX_R2_READS = 5; // one current original and at most four earlier originals
const MAX_R2_TOTAL_BYTES = 8 * 1024 * 1024;

function boundedInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('reconciliation_invalid_count');
  return number;
}

function readonlyReader(db) {
  let queries = 0;
  let rowsRead = 0;
  return {
    async query(sql, ...params) {
      if (!/^\s*SELECT\b/i.test(sql) || sql.includes(';') ||
          /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|ATTACH|PRAGMA)\b/i.test(sql)) {
        throw new Error('reconciliation_nonselect_sql');
      }
      if (++queries > MAX_D1_QUERIES || params.length > 100) throw new Error('reconciliation_query_cap');
      const data = await db.prepare(sql).bind(...params).all();
      if (!data || data.success === false || !Array.isArray(data.results)) throw new Error('reconciliation_query_failed');
      const read = boundedInteger(data.meta?.rows_read);
      const written = boundedInteger(data.meta?.rows_written);
      rowsRead += read;
      if (written || read > MAX_D1_READS_QUERY || rowsRead > MAX_D1_READS_REQUEST) {
        throw new Error('reconciliation_D1_cost_stop');
      }
      return data.results;
    },
    cost() { return { rowsRead, rowsWritten: 0, queries }; }
  };
}

function toBase64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  if (typeof value !== 'string' || value.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('reconciliation_cursor_invalid');
  }
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function cursorKey(env) {
  if (typeof env.ADMIN_TOKEN !== 'string' || env.ADMIN_TOKEN.length < 16) {
    throw new Error('reconciliation_cursor_key_unavailable');
  }
  const raw = new TextEncoder().encode('kentaurai-reconciliation-cursor-v1:' + env.ADMIN_TOKEN);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptCursor(key, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(JSON.stringify(value))
  ));
  const packed = new Uint8Array(nonce.length + cipher.length);
  packed.set(nonce);
  packed.set(cipher, nonce.length);
  return toBase64Url(packed);
}

async function decryptCursor(key, cursor) {
  try {
    const packed = fromBase64Url(cursor);
    if (packed.length < 29) throw new Error('bad_ciphertext');
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.subarray(0, 12) }, key, packed.subarray(12)
    );
    return JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    throw new Error('reconciliation_cursor_invalid');
  }
}

function chunks(items) {
  const out = [];
  for (let i = 0; i < items.length; i += MAX_IDS_PER_QUERY) out.push(items.slice(i, i + MAX_IDS_PER_QUERY));
  return out;
}

async function readRows(reader, sql, ...params) {
  const rows = await reader.query(sql, ...params);
  if (rows.length > MAX_ROWS) throw new Error('reconciliation_row_limit');
  return rows;
}

async function identitiesForFacts(reader, family, facts) {
  const identities = new Map();
  const byKind = new Map();
  for (const fact of facts.values()) {
    const person = family === 'person_stat';
    const kind = person ? fact.personType : 'horse';
    if (!['horse', 'driver', 'trainer'].includes(kind)) throw new Error('reconciliation_identity_invalid');
    const externalId = String(fact.externalId);
    if (!byKind.has(kind)) byKind.set(kind, new Set());
    byKind.get(kind).add(externalId);
  }
  for (const [kind, values] of byKind) {
    const table = kind === 'horse' ? 'horse_external_ids' :
      kind === 'driver' ? 'driver_external_ids' : 'trainer_external_ids';
    const idColumn = kind === 'horse' ? 'horse_id' :
      kind === 'driver' ? 'driver_id' : 'trainer_id';
    for (const group of chunks([...values])) {
      const rows = await readRows(reader,
        'SELECT external_id,' + idColumn + ' AS canonical_id FROM ' + table +
          " WHERE source_type='official' AND external_id IN (" +
          group.map(() => '?').join(',') + ')', ...group);
      for (const row of rows) {
        const key = (kind === 'horse' ? '' : kind + ':') + row.external_id;
        if (!identities.has(key)) identities.set(key, []);
        identities.get(key).push(row.canonical_id);
      }
    }
  }
  return identities;
}

async function snapshotRows(reader, definition, sourceId, observations) {
  const table = definition.table;
  const projection = definition.select;
  const direct = await readRows(reader,
    'SELECT ' + projection + ' FROM ' + table + ' WHERE source_record_id=? ORDER BY id LIMIT 1025',
    sourceId);
  const seen = new Set(direct.map((row) => row.id));
  const refs = [...new Set(observations.map((row) => row.snapshot_id))].filter((id) => !seen.has(id));
  if (refs.length > MAX_ROWS) throw new Error('reconciliation_reference_limit');
  const referencedSnapshots = [];
  for (const group of chunks(refs)) {
    const rows = await readRows(reader,
      'SELECT ' + projection + ' FROM ' + table + ' WHERE id IN (' +
        group.map(() => '?').join(',') + ')', ...group);
    referencedSnapshots.push(...rows);
  }
  if (referencedSnapshots.length > MAX_ROWS) throw new Error('reconciliation_reference_limit');
  // A timestamp in a snapshot row alone is not enough for as-of evidence.
  // Verify that its own official source existed by that time and is complete.
  const owners = [...new Set(referencedSnapshots.map((row) => row.source_record_id))];
  const ownerEvidence = new Map();
  for (const group of chunks(owners)) {
    const rows = await readRows(reader,
      'SELECT sr.id,sr.fetched_at,sr.source_type,sync.status AS sync_status FROM source_records sr' +
      ' LEFT JOIN official_snapshot_source_sync sync ON sync.source_record_id=sr.id' +
      ' WHERE sr.id IN (' + group.map(() => '?').join(',') + ')', ...group);
    for (const row of rows) ownerEvidence.set(row.id, row);
  }
  for (const row of referencedSnapshots) {
    const owner = ownerEvidence.get(row.source_record_id);
    row.lineage_verified = !!owner &&
      owner.source_type === 'official_provider' &&
      owner.sync_status === 'complete' &&
      owner.fetched_at === row.observed_at;
  }
  return { direct, referencedSnapshots };
}

async function verifiedOriginal(env, source, r2Budget) {
  if (!source.raw_object_key || !/^[a-f0-9]{64}$/.test(String(source.content_hash || '')) ||
      source.quality_status !== 'normalized_verified_subset') return { status: 'provenance_conflict' };
  if (typeof env.RAW_BUCKET.head !== 'function' || typeof env.RAW_BUCKET.get !== 'function') {
    return { status: 'raw_unavailable' };
  }
  let meta, object;
  try { meta = await env.RAW_BUCKET.head(source.raw_object_key); }
  catch { return { status: 'raw_unavailable' }; }
  if (!meta) return { status: 'raw_missing' };
  const size = Number(meta.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OBJECT_BYTES ||
      r2Budget.objectsRead >= MAX_R2_READS ||
      r2Budget.bytesRead + size > MAX_R2_TOTAL_BYTES) {
    return { status: 'raw_deferred' };
  }
  r2Budget.objectsRead++;
  r2Budget.bytesRead += size;
  try { object = await env.RAW_BUCKET.get(source.raw_object_key); }
  catch { return { status: 'raw_unavailable' }; }
  if (!object) return { status: 'raw_missing' };
  let body;
  try { body = await object.text(); }
  catch { return { status: 'raw_unavailable' }; }
  if (new TextEncoder().encode(body).byteLength !== size) return { status: 'provenance_conflict' };
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const hash = [...hashBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (hash !== source.content_hash || (meta.customMetadata?.contentHash != null &&
      meta.customMetadata.contentHash !== hash) || (meta.customMetadata?.sourceType != null &&
      meta.customMetadata.sourceType !== 'official_provider')) {
    return { status: 'provenance_conflict' };
  }
  try { return { status: 'verified', facts: collectOfficialSnapshotFacts(JSON.parse(body)), size }; }
  catch { return { status: 'raw_invalid' }; }
}

// A predecessor hint is NOT an as-of proof: it uses today's canonical mapping,
// checks at most one earlier direct snapshot per missing fact, and only verifies
// the previous snapshot's source metadata/status (not its R2 hash). Missing
// observations, older indirect events and remapped identities remain unknown.
function predecessorWhere(family, mapped, fact) {
  if (family === 'horse_profile') return { where: 'horse_id=?', params: [mapped] };
  if (family === 'horse_stat') {
    return { where: 'horse_id=? AND snapshot_scope=?', params: [mapped, fact.snapshotScope] };
  }
  if (family === 'horse_record') {
    return {
      where: 'horse_id=? AND record_scope=? AND stat_year IS ? AND record_ordinal=?',
      params: [mapped, fact.recordScope, fact.statYear, fact.ordinal]
    };
  }
  if (family === 'person_stat') {
    return {
      where: 'person_type=? AND person_id=? AND stat_year=?',
      params: [fact.personType, mapped, fact.statYear]
    };
  }
  throw new Error('reconciliation_unsupported_predecessor_family');
}

function sameSourceIdentityAndScope(family, earlier, sought) {
  if (earlier.externalId == null || sought.externalId == null ||
      !String(earlier.externalId) || !String(sought.externalId) ||
      String(earlier.externalId) !== String(sought.externalId)) return false;
  if (family === 'horse_profile') return true;
  if (family === 'horse_stat') return earlier.snapshotScope === sought.snapshotScope;
  if (family === 'horse_record') {
    return earlier.recordScope === sought.recordScope &&
      earlier.statYear === sought.statYear && earlier.ordinal === sought.ordinal;
  }
  if (family === 'person_stat') {
    return earlier.personType === sought.personType && earlier.statYear === sought.statYear;
  }
  return false;
}

// The earlier raw source is checked independently of its current direct-row
// metadata. This is still NOT a proof of historical canonical identity or
// of the full as-of timeline.
async function inspectPredecessorHints(reader, env, family, missing, cutoff, r2Budget, currentSource, onVerified = null) {
  const report = {
    examined: 0,
    deferred: missing.length,
    noEarlierDirect: 0,
    earlierCompletedSourceSameFacts: 0,
    earlierCompletedSourceDifferentFacts: 0,
    earlierUnconfirmedSource: 0,
    earlierOriginalVerifiedFacts: 0,
    earlierOriginalFactMismatch: 0,
    earlierOriginalUnverified: 0,
    earlierOriginalDeferred: 0,
    earlierOriginalVerifiedSources: 0,
    historicalIdentityVerified: false,
    completeChronologyVerified: false,
    repairAuthorized: false
  };
  // Reserve one query for final dataset-fence verification. A request cannot
  // exceed the existing 40-query limit even when mappings are numerous.
  const remainingQueries = Math.max(0, MAX_D1_QUERIES - reader.cost().queries - 1);
  const take = Math.min(missing.length, MAX_PREDECESSOR_CHECKS, remainingQueries);
  const definition = FAMILY[family];
  const matchingPredecessors = [];
  for (let i = 0; i < take; i++) {
    const { mapped, fact } = missing[i];
    const predicate = predecessorWhere(family, mapped, fact);
    const table = definition.table;
    const lineageSql =
      'EXISTS (SELECT 1 FROM source_records original_source ' +
      'JOIN official_snapshot_source_sync earlier_sync ' +
      'ON earlier_sync.source_record_id=original_source.id ' +
      'WHERE original_source.id=' + table + '.source_record_id ' +
      "AND original_source.source_type='official_provider' " +
      "AND original_source.quality_status='normalized_verified_subset' " +
      "AND earlier_sync.status='complete' " +
      'AND julianday(original_source.fetched_at)=julianday(' + table + '.observed_at))';
    const rows = await readRows(reader,
      'SELECT ' + definition.select + ', ' +
      "CASE WHEN quality_status='verified_official_snapshot' AND " +
      lineageSql + ' THEN 1 ELSE 0 END AS completed_lineage ' +
      'FROM ' + table + ' WHERE ' + predicate.where +
      ' AND julianday(observed_at)<julianday(?)' +
      ' ORDER BY julianday(observed_at) DESC,id DESC LIMIT 1',
      ...predicate.params, cutoff
    );
    report.examined++;
    report.deferred--;
    if (!rows.length) report.noEarlierDirect++;
    else if (Number(rows[0].completed_lineage) !== 1) report.earlierUnconfirmedSource++;
    else if (snapshotFactMatches(family, rows[0], fact)) {
      report.earlierCompletedSourceSameFacts++;
      matchingPredecessors.push({ row: rows[0], fact, mapped });
    } else report.earlierCompletedSourceDifferentFacts++;
  }
  const verifiedSources = new Map();
  const verifiedMetadata = new Map();
  for (const { row, fact, mapped } of matchingPredecessors) {
    const sourceId = row.source_record_id;
    let original;
    if (verifiedSources.has(sourceId)) {
      original = verifiedSources.get(sourceId);
    } else {
      if (verifiedSources.size >= MAX_PREDECESSOR_R2_SOURCES ||
          reader.cost().queries >= MAX_D1_QUERIES - 1) {
        report.earlierOriginalDeferred++;
        continue;
      }
      const metadata = await readRows(reader,
        'SELECT id,source_type,fetched_at,raw_object_key,content_hash,quality_status' +
        ' FROM source_records WHERE id=? LIMIT 1', sourceId);
      const source = metadata[0];
      if (source) verifiedMetadata.set(sourceId, source);
      if (!source || source.source_type !== 'official_provider' ||
          !Number.isFinite(Date.parse(source.fetched_at)) ||
          Date.parse(source.fetched_at) !== Date.parse(row.observed_at)) {
        original = { status: 'provenance_conflict' };
      } else {
        original = await verifiedOriginal(env, source, r2Budget);
      }
      verifiedSources.set(sourceId, original);
      if (original.status === 'verified') report.earlierOriginalVerifiedSources++;
    }
    // A hash-valid older original can still contain an excessively large
    // fact collection. Quarantine it instead of making an unbounded
    // source-to-fact comparison or misclassifying the missing representation.
    if (original.status === 'verified' && original.facts[definition.facts].size > MAX_FACTS) {
      report.earlierOriginalDeferred++;
    } else if (original.status === 'raw_deferred') {
      report.earlierOriginalDeferred++;
    } else if (original.status !== 'verified') {
      report.earlierOriginalUnverified++;
    } else {
      const matches = [...original.facts[definition.facts].values()].filter((candidate) =>
        sameSourceIdentityAndScope(family, candidate, fact));
      if (matches.length === 1 && snapshotFactMatches(family, row, matches[0])) {
        report.earlierOriginalVerifiedFacts++;
        // This callback is deliberately private. Neither raw identity nor
        // source metadata is ever added to the response/report.
        if (onVerified) onVerified({
          family, canonicalId: mapped, currentFact: fact, priorFact: matches[0],
          priorSnapshot: row,
          currentSource: {
            id: currentSource.source_record_id, fetched_at: currentSource.fetched_at,
            content_hash: currentSource.content_hash,
            quality_status: currentSource.quality_status, source_type: 'official_provider'
          },
          priorSource: verifiedMetadata.get(sourceId)
        });
      } else {
        report.earlierOriginalFactMismatch++;
      }
    }
  }
  return report;
}

function emptySummary(family) {
  return {
    mode: 'read_only_snapshot_fact_reconciliation',
    family,
    classificationOnly: true,
    repairAuthorized: false,
    historicalIdentityProofEstablished: false,
    completeChronologyProofEstablished: false,
    auditLedgerVerified: false,
    sourcesExamined: 0,
    originalVerified: 0,
    originalMissing: 0,
    originalInvalid: 0,
    originalFactCountInsufficient: 0,
    originalDeferred: 0,
    provenanceConflicts: 0,
    actualLogicalRepresentations: 0,
    ledgerShortfall: 0,
    extractedFacts: 0,
    predecessorHints: null,
    classifications: Object.fromEntries(SNAPSHOT_RECONCILIATION_STATUSES.map((status) => [status, 0])),
    cursor: null,
    done: false,
    revisionCounterMatchesProof: false,
    budget: null
  };
}

function classifyRawStatus(report, status) {
  if (status === 'raw_missing') report.originalMissing++;
  else if (status === 'raw_invalid') report.originalInvalid++;
  else if (status === 'raw_deferred' || status === 'raw_unavailable') report.originalDeferred++;
  else report.provenanceConflicts++;
}

function selectSourceSql(family, withCursor) {
  const definition = FAMILY[family];
  return [
    'SELECT sync.source_record_id,sync.' + definition.count + ' AS expected_count,',
    'COALESCE(ledger.actual_count,0) AS ledger_count,',
    'sr.fetched_at,sr.raw_object_key,sr.content_hash,sr.quality_status',
    'FROM official_snapshot_source_sync sync INDEXED BY idx_official_snapshot_source_sync_status_source',
    'JOIN source_records sr ON sr.id=sync.source_record_id',
    'LEFT JOIN storage_cleanup_audit_source_counts ledger',
    'ON ledger.audit_run_id=? AND ledger.family=? AND ledger.source_record_id=sync.source_record_id',
    "WHERE sync.status='complete' AND sr.source_type='official_provider'",
    'AND julianday(sync.processed_at)<=julianday(?)',
    withCursor ? 'AND sync.source_record_id > ?' : '',
    'AND sync.' + definition.count + '>COALESCE(ledger.actual_count,0)',
    'ORDER BY sync.source_record_id LIMIT 1'
  ].join(' ');
}

// The recovery scanner does not depend on a failed/expired historical audit.
// Each private source is freshly counted with the same indexed logical-count
// definition as the production integrity audit. Its source ID is never
// accepted from a public route and never leaves the aggregate response.
function selectLiveRecoverySourceSql(family) {
  const definition = FAMILY[family];
  return [
    'SELECT sync.source_record_id,sync.' + definition.count + ' AS expected_count,',
    '(',
    'SELECT COUNT(*) FROM ' + definition.table +
      ' direct INDEXED BY idx_' + definition.table + '_source_record' +
      ' WHERE direct.source_record_id=sync.source_record_id',
    ') + (',
    'SELECT COUNT(*) FROM official_snapshot_observations obs',
      'INDEXED BY sqlite_autoindex_official_snapshot_observations_1',
    'WHERE obs.source_record_id=sync.source_record_id AND obs.snapshot_family=?',
    'AND NOT EXISTS (SELECT 1 FROM ' + definition.table +
      ' owned WHERE owned.id=obs.snapshot_id',
    'AND owned.source_record_id=obs.source_record_id)',
    ') AS ledger_count,',
    'sr.fetched_at,sr.raw_object_key,sr.content_hash,sr.quality_status',
    'FROM official_snapshot_source_sync sync',
    'JOIN source_records sr ON sr.id=sync.source_record_id',
    "WHERE sync.status='complete' AND sr.source_type='official_provider'",
    'AND sync.source_record_id=? LIMIT 1'
  ].join(' ');
}

export async function inspectPrivateSnapshotReconciliationPage(env, { family, cursor = null, onVerifiedPredecessor = null, internalSourceId = null } = {}) {
  if (onVerifiedPredecessor != null && typeof onVerifiedPredecessor !== 'function') {
    throw new Error('reconciliation_invalid_private_callback');
  }
  if (!FAMILY[family]) throw new Error('reconciliation_invalid_family');
  if (!env?.DB || !env?.RAW_BUCKET) throw new Error('reconciliation_bindings_missing');
  const reader = readonlyReader(env.DB);
  const live = internalSourceId != null;
  if (live && (typeof internalSourceId !== 'string' || internalSourceId.length > 256 ||
      !internalSourceId || cursor != null)) {
    throw new Error('reconciliation_internal_source_invalid');
  }
  const initialEpoch = live ? await reader.query(
    'SELECT revision FROM historical_recovery_epoch WHERE singleton=1'
  ) : null;
  if (live && (initialEpoch.length !== 1 ||
      !Number.isSafeInteger(Number(initialEpoch[0].revision)))) {
    throw new Error('reconciliation_recovery_epoch_missing');
  }
  const proof = live ? null : await reader.query(PROOF_SQL);
  if (!live && (proof.length !== 1 || boundedInteger(proof[0].target_count) !== 22 ||
      boundedInteger(proof[0].unfinished) !== 0 || boundedInteger(proof[0].unsettled) !== 0 ||
      boundedInteger(proof[0].dataset_revision) !== boundedInteger(proof[0].current_revision))) {
    throw new Error('reconciliation_proof_not_current');
  }
  const audit = live ? null : proof[0];
  const key = live ? null : await cursorKey(env);
  let after = null;
  if (!live && cursor != null) {
    const decoded = await decryptCursor(key, cursor);
    if (decoded?.v !== 1 || decoded.family !== family || decoded.proof !== audit.proof_id ||
        decoded.revision !== audit.dataset_revision || typeof decoded.after !== 'string' ||
        !decoded.after || decoded.after.length > 256) {
      throw new Error('reconciliation_cursor_not_current');
    }
    after = decoded.after;
  }
  const rows = live
    ? await reader.query(selectLiveRecoverySourceSql(family), family, internalSourceId)
    : await reader.query(selectSourceSql(family, after != null),
      audit.proof_id, family, audit.completed_at, ...(after == null ? [] : [after]));
  const report = emptySummary(family);
  const r2Budget = { objectsRead: 0, bytesRead: 0 };
  if (rows.length > 1) throw new Error('reconciliation_source_limit');
  if (rows.length) {
    const source = rows[0];
    report.sourcesExamined = 1;
    report.ledgerShortfall = boundedInteger(source.expected_count) - boundedInteger(source.ledger_count);
    if (report.ledgerShortfall <= 0 && !live) throw new Error('reconciliation_invalid_source_deficit');
    const raw = await verifiedOriginal(env, source, r2Budget);
    if (live && report.ledgerShortfall <= 0) {
      // Full-inventory scan: a source without deficit needs no raw download.
      // Excess representations are counted separately and quarantined.
      if (report.ledgerShortfall < 0) report.provenanceConflicts++;
      report.auditLedgerVerified = report.ledgerShortfall === 0;
    } else if (raw.status !== 'verified') classifyRawStatus(report, raw.status);
    else {
      report.originalVerified = 1;
      const facts = raw.facts[FAMILY[family].facts];
      if (facts.size > MAX_FACTS) {
        report.originalDeferred++;
        report.originalVerified = 0;
      } else if (facts.size < boundedInteger(source.expected_count)) {
        // A genuine hash-verified original can disagree with a legacy import
        // counter; this does not make the original itself corrupt.
        report.originalFactCountInsufficient++;
        report.extractedFacts = facts.size;
      } else {
        const observations = await readRows(reader,
          'SELECT source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed' +
          ' FROM official_snapshot_observations WHERE source_record_id=? AND snapshot_family=?' +
          ' ORDER BY entity_key,scope_key LIMIT 1025',
          source.source_record_id, family);
        const { direct, referencedSnapshots } =
          await snapshotRows(reader, FAMILY[family], source.source_record_id, observations);
        const owned = new Set(direct.map((row) => row.id));
        const logicalCount = direct.length +
          observations.filter((obs) => !owned.has(obs.snapshot_id)).length;
        report.actualLogicalRepresentations = logicalCount;
        if (logicalCount !== boundedInteger(source.ledger_count)) {
          throw new Error('reconciliation_audit_count_disagrees');
        }
        report.auditLedgerVerified = true;
        const identities = await identitiesForFacts(reader, family, facts);
        const missingInternal = [];
        const comparison = reconcileSnapshotFacts({
          family, facts, source: { id: source.source_record_id, fetched_at: source.fetched_at },
          identities, direct, observations, referencedSnapshots,
          historicalIdentityVerified: false, chronologyVerified: false,
          onFactClassified: ({ status, fact, mapped }) => {
            if (status === 'missing_unverified_chronology' && mapped) {
              missingInternal.push({ fact, mapped });
            }
          }
        });
        report.extractedFacts = comparison.expectedFacts;
        report.classifications = comparison.classifications;
        report.predecessorHints = await inspectPredecessorHints(
          reader, env, family, missingInternal, source.fetched_at,
          r2Budget, source, onVerifiedPredecessor
        );
        // A source-owned direct row must be a verified official snapshot.
        // A quality anomaly invalidates this source's classification.
        if (direct.some((row) => row.quality_status !== 'verified_official_snapshot') ||
            referencedSnapshots.some((row) => row.quality_status !== 'verified_official_snapshot')) {
          throw new Error('reconciliation_snapshot_quality_conflict');
        }
      }
    }
    if (!live) report.cursor = await encryptCursor(key, {
      v: 1, family, proof: audit.proof_id, revision: audit.dataset_revision,
      after: source.source_record_id
    });
  } else {
    report.done = true;
  }
  const finalRevision = live
    ? await reader.query('SELECT revision FROM historical_recovery_epoch WHERE singleton=1')
    : await reader.query('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1');
  if (finalRevision.length !== 1 || boundedInteger(finalRevision[0].revision) !==
      boundedInteger(live ? initialEpoch[0].revision : audit.dataset_revision)) {
    throw new Error('reconciliation_dataset_revision_changed');
  }
  if (live) {
    report.liveSourceReverified = true;
    report.liveRevision = boundedInteger(finalRevision[0].revision);
  }
  report.revisionCounterMatchesProof = true;
  report.budget = { ...reader.cost(), r2ObjectsRead: r2Budget.objectsRead,
    r2BytesRead: r2Budget.bytesRead };
  return report;
}
