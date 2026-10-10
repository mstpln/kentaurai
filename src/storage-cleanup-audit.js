import { DEFAULT_COST_SAFETY_THRESHOLDS } from './cost-safety.js';

const FAMILY_AUDITS = Object.freeze({
  horse_profile: {
    table: 'horse_profile_snapshots',
    expectedColumn: 'horse_profile_count',
    directIdentity: "horse_id AS entity_key, 'profile' AS scope_key",
    identityPredicate: "o.entity_key=s.horse_id AND o.scope_key='profile'"
  },
  horse_stat: {
    table: 'horse_stat_snapshots',
    expectedColumn: 'horse_stat_count',
    directIdentity: "horse_id AS entity_key, snapshot_scope AS scope_key",
    identityPredicate: 'o.entity_key=s.horse_id AND o.scope_key=s.snapshot_scope'
  },
  horse_record: {
    table: 'horse_record_snapshots',
    expectedColumn: 'horse_record_count',
    directIdentity: "horse_id AS entity_key, (CASE WHEN record_scope='year' THEN 'year:' || stat_year ELSE record_scope END) || ':' || record_ordinal AS scope_key",
    identityPredicate: "o.entity_key=s.horse_id AND o.scope_key=((CASE WHEN s.record_scope='year' THEN 'year:' || s.stat_year ELSE s.record_scope END) || ':' || s.record_ordinal)"
  },
  person_stat: {
    table: 'person_stat_snapshots',
    expectedColumn: 'person_stat_count',
    directIdentity: "person_type || ':' || person_id AS entity_key, CAST(stat_year AS TEXT) AS scope_key",
    identityPredicate: "o.entity_key=(s.person_type || ':' || s.person_id) AND o.scope_key=CAST(s.stat_year AS TEXT)"
  }
});

export const STORAGE_CLEANUP_AUDIT_FAMILIES = Object.freeze(Object.keys(FAMILY_AUDITS));

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// Anchor counts to completed source sync rows. A global UNION over all historical
// snapshots makes the safety preflight scan unrelated history on every dry-run.
// The source and family indexes bound each lookup to the source being checked.
export function buildStorageCleanupRepresentationAuditSql(family) {
  const definition = FAMILY_AUDITS[String(family || '')];
  if (!definition) throw new Error('unsupported storage cleanup audit family');
  return `
    WITH source_counts AS MATERIALIZED (
      SELECT
        sync.source_record_id,
        sync.${definition.expectedColumn} AS expected_count,
        (
          SELECT COUNT(*)
          FROM ${definition.table} direct_snapshot INDEXED BY idx_${definition.table}_source_record
          WHERE direct_snapshot.source_record_id=sync.source_record_id
        ) + (
          SELECT COUNT(*)
          FROM official_snapshot_observations o INDEXED BY sqlite_autoindex_official_snapshot_observations_1
          WHERE o.source_record_id=sync.source_record_id
            AND o.snapshot_family=?
            AND NOT EXISTS (
              SELECT 1
              FROM ${definition.table} same_source_snapshot
              WHERE same_source_snapshot.id=o.snapshot_id
                AND same_source_snapshot.source_record_id=o.source_record_id
            )
        ) AS actual_count
      FROM official_snapshot_source_sync sync INDEXED BY idx_official_snapshot_source_sync_status_source
      WHERE sync.status='complete'
    )
    SELECT
      COUNT(*) AS mismatched_sources,
      COALESCE(SUM(
        CASE WHEN expected_count > actual_count
          THEN expected_count - actual_count ELSE 0 END
      ),0) AS missing_representations,
      COALESCE(SUM(
        CASE WHEN actual_count > expected_count
          THEN actual_count - expected_count ELSE 0 END
      ),0) AS excess_representations
    FROM source_counts
    WHERE expected_count <> actual_count
  `;
}

async function auditFamily(env, family, definition) {
  // Each query returns one aggregate row. Preserve its provider-reported read
  // cost so a failed dry-run identifies the costly check without exposing IDs.
  const readCostByCheck = {};
  async function scalar(check, sql, bindings = []) {
    let statement = env.DB.prepare(sql);
    if (bindings.length) statement = statement.bind(...bindings);
    const response = await statement.all();
    const read = Number(response?.meta?.rows_read);
    readCostByCheck[check] = Number.isFinite(read) && read >= 0 ? read : null;
    return response?.results?.[0] || null;
  }
  const exceededReadSafety = () =>
    Object.values(readCostByCheck).reduce((total, value) => total + Number(value || 0), 0)
    > DEFAULT_COST_SAFETY_THRESHOLDS.rowsRead;
  const incompleteAudit = () => ({
    family,
    auditIncomplete: true,
    ok: false,
    readCostByCheck
  });

  const representation = await scalar(
    'representations',
    buildStorageCleanupRepresentationAuditSql(family),
    [family]
  );
  // Do not spend more reads on subsequent checks after the current audit
  // family has already exhausted the unchanged per-operation safety limit.
  if (exceededReadSafety()) return incompleteAudit();

  const observation = await scalar('observations', `
    SELECT
      SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS dangling_observations,
      SUM(CASE WHEN s.id IS NOT NULL AND NOT (${definition.identityPredicate}) THEN 1 ELSE 0 END) AS identity_mismatch_observations,
      SUM(CASE WHEN sr.id IS NULL OR julianday(o.observed_at) IS NOT julianday(sr.fetched_at) THEN 1 ELSE 0 END) AS observation_time_mismatches
    FROM official_snapshot_observations o
    LEFT JOIN ${definition.table} s ON s.id=o.snapshot_id
    LEFT JOIN source_records sr ON sr.id=o.source_record_id
    WHERE o.snapshot_family=?
  `, [family]);
  if (exceededReadSafety()) return incompleteAudit();

  const directTimeline = await scalar('direct_timeline', `
    SELECT COUNT(*) AS n
    FROM ${definition.table} s
    LEFT JOIN source_records sr ON sr.id=s.source_record_id
    WHERE sr.id IS NULL OR julianday(s.observed_at) IS NOT julianday(sr.fetched_at)
  `);
  const result = {
    family,
    mismatchedSources: number(representation?.mismatched_sources),
    missingRepresentations: number(representation?.missing_representations),
    excessRepresentations: number(representation?.excess_representations),
    danglingObservations: number(observation?.dangling_observations),
    identityMismatchObservations: number(observation?.identity_mismatch_observations),
    timestampMismatchRepresentations: number(observation?.observation_time_mismatches) + number(directTimeline?.n),
    readCostByCheck
  };
  result.ok = result.mismatchedSources === 0
    && result.missingRepresentations === 0
    && result.excessRepresentations === 0
    && result.danglingObservations === 0
    && result.identityMismatchObservations === 0
    && result.timestampMismatchRepresentations === 0;
  return result;
}

async function operationalCounts(env) {
  const batches = await env.DB.prepare(`
    SELECT status,COUNT(*) AS n
    FROM storage_cleanup_batches
    GROUP BY status
  `).all();
  const sessions = await env.DB.prepare(`
    SELECT status,COUNT(*) AS n
    FROM storage_cleanup_sessions
    GROUP BY status
  `).all();
  const anomalies = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN b.status='started' THEN 1 ELSE 0 END),0) AS started_batches,
      COALESCE(SUM(CASE
        WHEN b.cleanup_kind='raw_object'
          AND b.status='references_rewritten'
          AND NOT EXISTS (
            SELECT 1 FROM source_records sr WHERE sr.raw_object_key=b.legacy_key
          )
        THEN 1 ELSE 0 END),0) AS stranded_raw_batches
    FROM storage_cleanup_batches b
  `).first();

  const toObject = (rows) => Object.fromEntries(
    (rows || []).map((row) => [String(row.status), number(row.n)])
  );
  const result = {
    batchStatuses: toObject(batches?.results),
    sessionStatuses: toObject(sessions?.results),
    startedBatches: number(anomalies?.started_batches),
    strandedRawBatches: number(anomalies?.stranded_raw_batches)
  };
  result.ok = result.startedBatches === 0 && result.strandedRawBatches === 0;
  return result;
}

export async function auditStorageCleanupFamilyIntegrity(env, family) {
  if (!env?.DB) throw new Error('DB is not configured');
  const definition = FAMILY_AUDITS[String(family || '')];
  if (!definition) throw new Error('unsupported storage cleanup audit family');
  return auditFamily(env, family, definition);
}

export async function auditStorageCleanupOperationalIntegrity(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  return operationalCounts(env);
}

export function combineStorageCleanupIntegrityAudit(families, operations) {
  const normalizedFamilies = Array.isArray(families) ? families : [];
  const normalizedOperations = operations || {
    batchStatuses: {},
    sessionStatuses: {},
    startedBatches: 0,
    strandedRawBatches: 0,
    ok: false
  };
  return {
    ok: normalizedFamilies.length === STORAGE_CLEANUP_AUDIT_FAMILIES.length
      && normalizedFamilies.every((family) => family?.ok === true)
      && normalizedOperations.ok === true,
    families: normalizedFamilies,
    operations: normalizedOperations
  };
}

export async function auditStorageCleanupIntegrity(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const families = [];
  for (const family of STORAGE_CLEANUP_AUDIT_FAMILIES) {
    families.push(await auditStorageCleanupFamilyIntegrity(env, family));
  }
  const operations = await auditStorageCleanupOperationalIntegrity(env);
  return combineStorageCleanupIntegrityAudit(families, operations);
}


function normalizeSessionId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('valid cleanup session_id is required');
  }
  return id;
}

function normalizeSha(value) {
  const sha = String(value || '');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('valid source_sha is required');
  return sha;
}

export async function bindStorageCleanupIntegrityAudit(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const sessionId = normalizeSessionId(options.session_id);
  const sourceSha = normalizeSha(options.source_sha);
  const session = await env.DB.prepare(`
    SELECT id,source_sha,status,expires_at
    FROM storage_cleanup_sessions
    WHERE id=?
    LIMIT 1
  `).bind(sessionId).first();
  if (!session) throw new Error('cleanup session not found');
  if (session.source_sha !== sourceSha) throw new Error('cleanup session source_sha changed; start a new session');
  if (session.status !== 'running') throw new Error('cleanup session is not running');
  const expiry = Date.parse(String(session.expires_at || ''));
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('cleanup session expired; start a new session');

  const auditRunId = normalizeSessionId(options.audit_run_id);
  const audit = await getStorageCleanupAuditRun(env, auditRunId);
  if (audit.sourceSha !== sourceSha) throw new Error('cleanup audit source_sha changed; start a new audit');
  if (auditExpired(audit)) {
    await markAuditRunExpired(env, auditRunId);
    throw new Error('cleanup audit run expired; start a new audit');
  }
  if (audit.status !== 'complete' || audit.ok !== true) {
    return { ...audit, sessionId, auditVerified: false };
  }
  const revision = await currentDatasetRevision(env);
  if (revision !== audit.datasetRevision) {
    await markAuditRunStale(env, auditRunId);
    return { ...audit, status: 'stale', ok: false, sessionId, auditVerified: false };
  }

  await env.DB.prepare(`
    INSERT INTO storage_cleanup_session_audits
      (session_id,source_sha,verified_at,audit_run_id,dataset_revision)
    VALUES (?,?,CURRENT_TIMESTAMP,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      source_sha=excluded.source_sha,
      audit_run_id=excluded.audit_run_id,
      dataset_revision=excluded.dataset_revision,
      verified_at=CURRENT_TIMESTAMP
  `).bind(sessionId, sourceSha, auditRunId, revision).run();

  return { ...audit, sessionId, auditVerified: true };
}

const AUDIT_TTL_HOURS = 24;
const AUDIT_MAX_CONTINUATIONS = 48;
const AUDIT_TARGETS = Object.freeze([
  ...STORAGE_CLEANUP_AUDIT_FAMILIES.flatMap((family) => [
    `${family}:direct_representations`,
    `${family}:observation_representations`,
    `${family}:representation_compare`,
    `${family}:observations`,
    `${family}:direct_timeline`
  ]),
  'operations:batches',
  'operations:sessions'
]);

function auditExpired(run) {
  const value = Date.parse(String(run?.expires_at || run?.expiresAt || ''));
  return !Number.isFinite(value) || value <= Date.now();
}

async function currentDatasetRevision(env) {
  const row = await env.DB.prepare(`
    SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1
  `).first();
  const revision = Number(row?.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('cleanup dataset revision is unavailable');
  return revision;
}

async function markAuditRunStale(env, id) {
  await env.DB.prepare(`
    UPDATE storage_cleanup_audit_runs
    SET status='stale',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('running','complete')
  `).bind(id).run();
}

async function markAuditRunExpired(env, id) {
  await env.DB.prepare(`
    UPDATE storage_cleanup_audit_runs
    SET status='expired',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('running','complete')
  `).bind(id).run();
}

async function loadAuditRun(env, id) {
  return env.DB.prepare(`
    SELECT id,source_sha,dataset_revision,status,continuation_count,created_at,updated_at,expires_at,completed_at
    FROM storage_cleanup_audit_runs WHERE id=?
  `).bind(id).first();
}

function parseCursor(value, expectedLength) {
  if (value == null || value === '') return Array(expectedLength).fill('');
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.length !== expectedLength || parsed.some((item) => typeof item !== 'string')) throw new Error();
    return parsed;
  } catch {
    throw new Error('cleanup audit cursor is invalid');
  }
}

function cursorJson(values) {
  return values == null ? null : JSON.stringify(values.map((value) => String(value)));
}

function pageComplete(rowsChecked, limit) {
  return Number(rowsChecked || 0) < limit;
}

function familyDefinition(family) {
  const definition = FAMILY_AUDITS[family];
  if (!definition) throw new Error('unsupported storage cleanup audit family');
  return definition;
}

async function directRepresentationPage(env, auditRunId, family, cursor) {
  const definition = familyDefinition(family);
  const limit = 5000;
  const after = parseCursor(cursor, 2);
  const sourceIndex = `idx_cleanup_${family}_source_page`;
  const boundary = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT source_record_id,id
      FROM ${definition.table} INDEXED BY ${sourceIndex}
      WHERE (source_record_id,id)>(?,?)
      ORDER BY source_record_id,id
      LIMIT ?
    )
    SELECT COUNT(*) AS rows_checked,
      (SELECT json_array(source_record_id,id) FROM page
       ORDER BY source_record_id DESC,id DESC LIMIT 1) AS next_cursor
    FROM page
  `).bind(...after, limit).first();
  const rowsChecked = number(boundary?.rows_checked);
  const next = boundary?.next_cursor == null ? null : parseCursor(boundary.next_cursor, 2);
  if (rowsChecked > 0) {
    await env.DB.prepare(`
      INSERT INTO storage_cleanup_audit_source_counts
        (audit_run_id,family,source_record_id,actual_count)
      SELECT ?,?,source_record_id,COUNT(*)
      FROM ${definition.table} INDEXED BY ${sourceIndex}
      WHERE (source_record_id,id)>(?,?) AND (source_record_id,id)<=(?,?)
      GROUP BY source_record_id
      ON CONFLICT(audit_run_id,family,source_record_id) DO UPDATE SET
        actual_count=actual_count+excluded.actual_count
    `).bind(auditRunId, family, ...after, ...next).run();
  }
  return { limit, rowsChecked, nextCursor: next == null ? null : cursorJson(next), deltas: {} };
}

async function observationRepresentationPage(env, auditRunId, family, cursor) {
  const definition = familyDefinition(family);
  const limit = 5000;
  const after = parseCursor(cursor, 3);
  const boundary = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT source_record_id,entity_key,scope_key
      FROM official_snapshot_observations INDEXED BY idx_cleanup_observation_source_page
      WHERE snapshot_family=? AND (source_record_id,entity_key,scope_key)>(?,?,?)
      ORDER BY source_record_id,entity_key,scope_key
      LIMIT ?
    )
    SELECT COUNT(*) AS rows_checked,
      (SELECT json_array(source_record_id,entity_key,scope_key) FROM page
       ORDER BY source_record_id DESC,entity_key DESC,scope_key DESC LIMIT 1) AS next_cursor
    FROM page
  `).bind(family, ...after, limit).first();
  const rowsChecked = number(boundary?.rows_checked);
  const next = boundary?.next_cursor == null ? null : parseCursor(boundary.next_cursor, 3);
  if (rowsChecked > 0) {
    await env.DB.prepare(`
      INSERT INTO storage_cleanup_audit_source_counts
        (audit_run_id,family,source_record_id,actual_count)
      SELECT ?,?,o.source_record_id,COUNT(*)
      FROM official_snapshot_observations o INDEXED BY idx_cleanup_observation_source_page
      WHERE o.snapshot_family=?
        AND (o.source_record_id,o.entity_key,o.scope_key)>(?,?,?)
        AND (o.source_record_id,o.entity_key,o.scope_key)<=(?,?,?)
        AND NOT EXISTS (
          SELECT 1 FROM ${definition.table} same_source_snapshot
          WHERE same_source_snapshot.id=o.snapshot_id
            AND same_source_snapshot.source_record_id=o.source_record_id
        )
      GROUP BY o.source_record_id
      ON CONFLICT(audit_run_id,family,source_record_id) DO UPDATE SET
        actual_count=actual_count+excluded.actual_count
    `).bind(auditRunId, family, family, ...after, ...next).run();
  }
  return { limit, rowsChecked, nextCursor: next == null ? null : cursorJson(next), deltas: {} };
}

async function representationComparisonPage(env, auditRunId, family, cursor) {
  const definition = familyDefinition(family);
  const limit = 5000;
  const after = parseCursor(cursor, 1)[0];
  const row = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT source_record_id,${definition.expectedColumn} AS expected_count
      FROM official_snapshot_source_sync INDEXED BY idx_official_snapshot_source_sync_status_source
      WHERE status='complete' AND source_record_id>?
      ORDER BY source_record_id
      LIMIT ?
    )
    SELECT
      COUNT(*) AS rows_checked,
      COALESCE(SUM(page.expected_count<>COALESCE(counts.actual_count,0)),0) AS mismatched_sources,
      COALESCE(SUM(CASE WHEN page.expected_count>COALESCE(counts.actual_count,0) THEN page.expected_count-COALESCE(counts.actual_count,0) ELSE 0 END),0) AS missing_representations,
      COALESCE(SUM(CASE WHEN COALESCE(counts.actual_count,0)>page.expected_count THEN COALESCE(counts.actual_count,0)-page.expected_count ELSE 0 END),0) AS excess_representations,
      (SELECT source_record_id FROM page ORDER BY source_record_id DESC LIMIT 1) AS next_cursor
    FROM page
    LEFT JOIN storage_cleanup_audit_source_counts counts
      ON counts.audit_run_id=? AND counts.family=? AND counts.source_record_id=page.source_record_id
  `).bind(after, limit, auditRunId, family).first();
  return {
    limit,
    rowsChecked: number(row?.rows_checked),
    nextCursor: row?.next_cursor == null ? null : cursorJson([row.next_cursor]),
    deltas: {
      mismatched_sources: number(row?.mismatched_sources),
      missing_representations: number(row?.missing_representations),
      excess_representations: number(row?.excess_representations)
    }
  };
}

async function observationPage(env, family, cursor) {
  const definition = familyDefinition(family);
  const limit = 5000;
  const after = parseCursor(cursor, 3);
  const row = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT source_record_id,entity_key,scope_key,observed_at,snapshot_id
      FROM official_snapshot_observations INDEXED BY sqlite_autoindex_official_snapshot_observations_1
      WHERE snapshot_family=? AND (source_record_id,entity_key,scope_key)>(?,?,?)
      ORDER BY source_record_id,entity_key,scope_key
      LIMIT ?
    )
    SELECT
      COUNT(*) AS rows_checked,
      COALESCE(SUM(s.id IS NULL),0) AS dangling_observations,
      COALESCE(SUM(s.id IS NOT NULL AND NOT (${definition.identityPredicate})),0) AS identity_mismatch_observations,
      COALESCE(SUM(sr.id IS NULL OR julianday(o.observed_at) IS NOT julianday(sr.fetched_at)),0) AS timestamp_mismatches,
      (SELECT json_array(source_record_id,entity_key,scope_key) FROM page
        ORDER BY source_record_id DESC,entity_key DESC,scope_key DESC LIMIT 1) AS next_cursor
    FROM page o
    LEFT JOIN ${definition.table} s ON s.id=o.snapshot_id
    LEFT JOIN source_records sr ON sr.id=o.source_record_id
  `).bind(family, ...after, limit).first();
  return {
    limit,
    rowsChecked: number(row?.rows_checked),
    nextCursor: row?.next_cursor == null ? null : String(row.next_cursor),
    deltas: {
      dangling_observations: number(row?.dangling_observations),
      identity_mismatch_observations: number(row?.identity_mismatch_observations),
      timestamp_mismatches: number(row?.timestamp_mismatches)
    }
  };
}

async function directTimelinePage(env, family, cursor) {
  const definition = familyDefinition(family);
  const limit = 5000;
  const after = parseCursor(cursor, 1)[0];
  const row = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT id,source_record_id,observed_at
      FROM ${definition.table}
      WHERE id>?
      ORDER BY id
      LIMIT ?
    )
    SELECT
      COUNT(*) AS rows_checked,
      COALESCE(SUM(sr.id IS NULL OR julianday(page.observed_at) IS NOT julianday(sr.fetched_at)),0) AS timestamp_mismatches,
      (SELECT id FROM page ORDER BY id DESC LIMIT 1) AS next_cursor
    FROM page
    LEFT JOIN source_records sr ON sr.id=page.source_record_id
  `).bind(after, limit).first();
  return {
    limit,
    rowsChecked: number(row?.rows_checked),
    nextCursor: row?.next_cursor == null ? null : cursorJson([row.next_cursor]),
    deltas: { timestamp_mismatches: number(row?.timestamp_mismatches) }
  };
}

async function operationPage(env, kind, cursor) {
  const limit = 5000;
  const after = parseCursor(cursor, 1)[0];
  if (kind === 'batches') {
    const row = await env.DB.prepare(`
      WITH page AS MATERIALIZED (
        SELECT id,cleanup_kind,status,legacy_key
        FROM storage_cleanup_batches
        WHERE id>?
        ORDER BY id
        LIMIT ?
      )
      SELECT
        COUNT(*) AS rows_checked,
        COALESCE(SUM(status='started'),0) AS started_batches,
        COALESCE(SUM(
          cleanup_kind='raw_object' AND status='references_rewritten'
          AND NOT EXISTS (SELECT 1 FROM source_records sr WHERE sr.raw_object_key=page.legacy_key)
        ),0) AS stranded_raw_batches,
        (SELECT id FROM page ORDER BY id DESC LIMIT 1) AS next_cursor
      FROM page
    `).bind(after, limit).first();
    return {
      limit,
      rowsChecked: number(row?.rows_checked),
      nextCursor: row?.next_cursor == null ? null : cursorJson([row.next_cursor]),
      deltas: {
        started_batches: number(row?.started_batches),
        stranded_raw_batches: number(row?.stranded_raw_batches)
      }
    };
  }
  const row = await env.DB.prepare(`
    WITH page AS MATERIALIZED (
      SELECT id FROM storage_cleanup_sessions WHERE id>? ORDER BY id LIMIT ?
    )
    SELECT COUNT(*) AS rows_checked,
      (SELECT id FROM page ORDER BY id DESC LIMIT 1) AS next_cursor
    FROM page
  `).bind(after, limit).first();
  return {
    limit,
    rowsChecked: number(row?.rows_checked),
    nextCursor: row?.next_cursor == null ? null : cursorJson([row.next_cursor]),
    deltas: {}
  };
}

async function auditPage(env, auditRunId, target, cursor) {
  const [scope, check] = String(target).split(':');
  if (scope === 'operations') return operationPage(env, check, cursor);
  if (check === 'direct_representations') return directRepresentationPage(env, auditRunId, scope, cursor);
  if (check === 'observation_representations') return observationRepresentationPage(env, auditRunId, scope, cursor);
  if (check === 'representation_compare') return representationComparisonPage(env, auditRunId, scope, cursor);
  if (check === 'observations') return observationPage(env, scope, cursor);
  if (check === 'direct_timeline') return directTimelinePage(env, scope, cursor);
  throw new Error('unsupported cleanup audit target');
}

async function loadAuditProgress(env, auditRunId) {
  const response = await env.DB.prepare(`
    SELECT * FROM storage_cleanup_audit_progress
    WHERE audit_run_id=?
    ORDER BY CASE target
      WHEN 'horse_profile:direct_representations' THEN 1 WHEN 'horse_profile:observation_representations' THEN 2 WHEN 'horse_profile:representation_compare' THEN 3 WHEN 'horse_profile:observations' THEN 4 WHEN 'horse_profile:direct_timeline' THEN 5
      WHEN 'horse_stat:direct_representations' THEN 6 WHEN 'horse_stat:observation_representations' THEN 7 WHEN 'horse_stat:representation_compare' THEN 8 WHEN 'horse_stat:observations' THEN 9 WHEN 'horse_stat:direct_timeline' THEN 10
      WHEN 'horse_record:direct_representations' THEN 11 WHEN 'horse_record:observation_representations' THEN 12 WHEN 'horse_record:representation_compare' THEN 13 WHEN 'horse_record:observations' THEN 14 WHEN 'horse_record:direct_timeline' THEN 15
      WHEN 'person_stat:direct_representations' THEN 16 WHEN 'person_stat:observation_representations' THEN 17 WHEN 'person_stat:representation_compare' THEN 18 WHEN 'person_stat:observations' THEN 19 WHEN 'person_stat:direct_timeline' THEN 20
      WHEN 'operations:batches' THEN 21 WHEN 'operations:sessions' THEN 22 ELSE 99 END
  `).bind(auditRunId).all();
  return response.results || [];
}

function auditResponse(run, progress) {
  const families = STORAGE_CLEANUP_AUDIT_FAMILIES.map((family) => {
    const rows = progress.filter((row) => row.target.startsWith(`${family}:`));
    const sum = (column) => rows.reduce((total, row) => total + number(row[column]), 0);
    const result = {
      family,
      complete: rows.length === 5 && rows.every((row) => Number(row.is_complete) === 1),
      rowsChecked: sum('rows_checked'),
      pages: sum('pages'),
      mismatchedSources: sum('mismatched_sources'),
      missingRepresentations: sum('missing_representations'),
      excessRepresentations: sum('excess_representations'),
      danglingObservations: sum('dangling_observations'),
      identityMismatchObservations: sum('identity_mismatch_observations'),
      timestampMismatchRepresentations: sum('timestamp_mismatches')
    };
    result.ok = result.complete
      && result.mismatchedSources === 0
      && result.missingRepresentations === 0
      && result.excessRepresentations === 0
      && result.danglingObservations === 0
      && result.identityMismatchObservations === 0
      && result.timestampMismatchRepresentations === 0;
    return result;
  });
  const operations = progress.filter((row) => row.target.startsWith('operations:'));
  const startedBatches = operations.reduce((sum, row) => sum + number(row.started_batches), 0);
  const strandedRawBatches = operations.reduce((sum, row) => sum + number(row.stranded_raw_batches), 0);
  const operationsComplete = operations.length === 2 && operations.every((row) => Number(row.is_complete) === 1);
  return {
    auditRunId: run.id,
    sourceSha: run.source_sha,
    datasetRevision: number(run.dataset_revision),
    status: run.status,
    continuationCount: number(run.continuation_count),
    maxContinuations: AUDIT_MAX_CONTINUATIONS,
    expiresAt: run.expires_at,
    complete: run.status === 'complete' || run.status === 'failed',
    ok: run.status === 'complete',
    families,
    operations: {
      complete: operationsComplete,
      rowsChecked: operations.reduce((sum, row) => sum + number(row.rows_checked), 0),
      startedBatches,
      strandedRawBatches,
      ok: operationsComplete && startedBatches === 0 && strandedRawBatches === 0
    }
  };
}

export async function getStorageCleanupAuditRun(env, auditRunId) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = normalizeSessionId(auditRunId);
  const run = await loadAuditRun(env, id);
  if (!run) throw new Error('cleanup audit run not found');
  return auditResponse(run, await loadAuditProgress(env, id));
}

export async function startOrResumeStorageCleanupAudit(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const sourceSha = normalizeSha(options.source_sha);
  const requestedId = options.audit_run_id == null || options.audit_run_id === ''
    ? null : normalizeSessionId(options.audit_run_id);
  const revision = await currentDatasetRevision(env);
  let run = requestedId ? await loadAuditRun(env, requestedId) : null;
  if (requestedId && !run) throw new Error('cleanup audit run not found');
  if (run) {
    if (run.source_sha !== sourceSha) throw new Error('cleanup audit source_sha changed; start a new audit');
    if (['stale','expired','exhausted'].includes(run.status)) {
      throw new Error(`cleanup audit run is ${run.status}; start a new audit`);
    }
    if (auditExpired(run)) {
      await markAuditRunExpired(env, run.id);
      throw new Error('cleanup audit run expired; start a new audit');
    }
    if (Number(run.dataset_revision) !== revision) {
      await markAuditRunStale(env, run.id);
      throw new Error('cleanup audit dataset changed; start a new audit');
    }
    if (run.status !== 'running') return auditResponse(run, await loadAuditProgress(env, run.id));
    if (Number(run.continuation_count) >= AUDIT_MAX_CONTINUATIONS) {
      await env.DB.prepare("UPDATE storage_cleanup_audit_runs SET status='exhausted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'").bind(run.id).run();
      throw new Error('cleanup audit continuation limit reached');
    }
    await env.DB.prepare(`
      UPDATE storage_cleanup_audit_runs
      SET continuation_count=continuation_count+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running'
    `).bind(run.id).run();
    run = await loadAuditRun(env, run.id);
  } else {
    run = await env.DB.prepare(`
      SELECT id,source_sha,dataset_revision,status,continuation_count,created_at,updated_at,expires_at,completed_at
      FROM storage_cleanup_audit_runs
      WHERE source_sha=? AND dataset_revision=? AND status='running'
      ORDER BY created_at DESC LIMIT 1
    `).bind(sourceSha, revision).first();
    if (run) {
      throw new Error(`cleanup audit is already running; resume it explicitly with audit_run_id ${run.id}`);
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + AUDIT_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const statements = [env.DB.prepare(`
      INSERT INTO storage_cleanup_audit_runs(id,source_sha,dataset_revision,status,continuation_count,expires_at)
      VALUES (?,?,?,'running',1,?)
    `).bind(id, sourceSha, revision, expiresAt)];
    for (const target of AUDIT_TARGETS) {
      statements.push(env.DB.prepare(`
        INSERT INTO storage_cleanup_audit_progress(audit_run_id,target) VALUES (?,?)
      `).bind(id, target));
    }
    await env.DB.batch(statements);
    run = await loadAuditRun(env, id);
  }
  return auditResponse(run, await loadAuditProgress(env, run.id));
}

export async function stepStorageCleanupAudit(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = normalizeSessionId(options.audit_run_id);
  let run = await loadAuditRun(env, id);
  if (!run) throw new Error('cleanup audit run not found');
  if (run.status !== 'running') {
    if (['complete','failed'].includes(run.status)) return auditResponse(run, await loadAuditProgress(env, id));
    throw new Error(`cleanup audit run is ${run.status}; start a new audit`);
  }
  if (auditExpired(run)) {
    await markAuditRunExpired(env, id);
    throw new Error('cleanup audit run expired; start a new audit');
  }
  if (await currentDatasetRevision(env) !== Number(run.dataset_revision)) {
    await markAuditRunStale(env, id);
    throw new Error('cleanup audit dataset changed; start a new audit');
  }
  const progress = await loadAuditProgress(env, id);
  const target = progress.find((row) => Number(row.is_complete) !== 1);
  if (!target) throw new Error('cleanup audit progress is inconsistent');
  const page = await auditPage(env, id, target.target, target.cursor);
  const complete = pageComplete(page.rowsChecked, page.limit);
  const columns = {
    mismatched_sources: 0,
    missing_representations: 0,
    excess_representations: 0,
    dangling_observations: 0,
    identity_mismatch_observations: 0,
    timestamp_mismatches: 0,
    started_batches: 0,
    stranded_raw_batches: 0,
    ...page.deltas
  };
  const updated = await env.DB.prepare(`
    UPDATE storage_cleanup_audit_progress
    SET cursor=?,is_complete=?,pages=pages+1,rows_checked=rows_checked+?,
      mismatched_sources=mismatched_sources+?,
      missing_representations=missing_representations+?,
      excess_representations=excess_representations+?,
      dangling_observations=dangling_observations+?,
      identity_mismatch_observations=identity_mismatch_observations+?,
      timestamp_mismatches=timestamp_mismatches+?,
      started_batches=started_batches+?,
      stranded_raw_batches=stranded_raw_batches+?,
      updated_at=CURRENT_TIMESTAMP
    WHERE audit_run_id=? AND target=? AND is_complete=0
      AND EXISTS (
        SELECT 1 FROM storage_cleanup_dataset_revision
        WHERE singleton=1 AND revision=?
      )
  `).bind(
    complete ? null : page.nextCursor,
    complete ? 1 : 0,
    page.rowsChecked,
    columns.mismatched_sources,
    columns.missing_representations,
    columns.excess_representations,
    columns.dangling_observations,
    columns.identity_mismatch_observations,
    columns.timestamp_mismatches,
    columns.started_batches,
    columns.stranded_raw_batches,
    id,
    target.target,
    Number(run.dataset_revision)
  ).run();
  if (Number(updated?.meta?.changes || 0) !== 1) {
    await markAuditRunStale(env, id);
    throw new Error('cleanup audit dataset changed; start a new audit');
  }

  const refreshed = await loadAuditProgress(env, id);
  if (refreshed.every((row) => Number(row.is_complete) === 1)) {
    const aggregate = auditResponse(run, refreshed);
    const valid = aggregate.families.every((family) => family.ok) && aggregate.operations.ok;
    const finalized = await env.DB.prepare(`
      UPDATE storage_cleanup_audit_runs
      SET status=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running'
        AND EXISTS (
          SELECT 1 FROM storage_cleanup_dataset_revision
          WHERE singleton=1 AND revision=?
        )
    `).bind(valid ? 'complete' : 'failed', id, Number(run.dataset_revision)).run();
    if (Number(finalized?.meta?.changes || 0) !== 1) {
      await markAuditRunStale(env, id);
      throw new Error('cleanup audit dataset changed; start a new audit');
    }
  }
  run = await loadAuditRun(env, id);
  return { ...auditResponse(run, await loadAuditProgress(env, id)), page: {
    target: target.target,
    rowsChecked: page.rowsChecked,
    complete
  } };
}

export async function assertStorageCleanupAuthorization(env, options = {}, { requireSession = false } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const sourceSha = normalizeSha(options.source_sha);
  const revision = await currentDatasetRevision(env);
  if (requireSession || options.session_id) {
    const sessionId = normalizeSessionId(options.session_id);
    const row = await env.DB.prepare(`
      SELECT s.status,s.expires_at,a.audit_run_id,a.dataset_revision,
        r.status AS audit_status,r.expires_at AS audit_expires_at
      FROM storage_cleanup_sessions s
      JOIN storage_cleanup_session_audits a ON a.session_id=s.id AND a.source_sha=s.source_sha
      JOIN storage_cleanup_audit_runs r ON r.id=a.audit_run_id
      WHERE s.id=? AND s.source_sha=?
    `).bind(sessionId, sourceSha).first();
    if (!row || row.status !== 'running' || row.audit_status !== 'complete') throw new Error('cleanup session has no complete integrity audit');
    if (auditExpired(row)) throw new Error('cleanup session expired; start a new session');
    const auditExpiry = Date.parse(String(row.audit_expires_at || ''));
    if (!Number.isFinite(auditExpiry) || auditExpiry <= Date.now()) {
      await markAuditRunExpired(env, row.audit_run_id);
      throw new Error('cleanup integrity audit is expired');
    }
    if (Number(row.dataset_revision) !== revision) {
      await markAuditRunStale(env, row.audit_run_id);
      throw new Error('cleanup integrity audit is stale');
    }
    return { sessionId, auditRunId: row.audit_run_id, datasetRevision: revision };
  }
  const auditRunId = normalizeSessionId(options.audit_run_id);
  const run = await loadAuditRun(env, auditRunId);
  if (!run || run.source_sha !== sourceSha || run.status !== 'complete') throw new Error('complete cleanup integrity audit is required');
  if (auditExpired(run)) {
    await markAuditRunExpired(env, auditRunId);
    throw new Error('cleanup integrity audit is expired');
  }
  if (Number(run.dataset_revision) !== revision) {
    await markAuditRunStale(env, auditRunId);
    throw new Error('cleanup integrity audit is stale');
  }
  return { auditRunId, datasetRevision: revision };
}

export const STORAGE_CLEANUP_AUDIT_TARGETS = AUDIT_TARGETS;
export const STORAGE_CLEANUP_AUDIT_MAX_CONTINUATIONS = AUDIT_MAX_CONTINUATIONS;
