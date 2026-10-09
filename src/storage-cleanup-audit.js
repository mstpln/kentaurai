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
          FROM ${definition.table} direct_snapshot
          WHERE direct_snapshot.source_record_id=sync.source_record_id
        ) + (
          SELECT COUNT(*)
          FROM official_snapshot_observations o
          WHERE o.source_record_id=sync.source_record_id
            AND o.snapshot_family=?
            AND NOT EXISTS (
              SELECT 1
              FROM ${definition.table} same_source_snapshot
              WHERE same_source_snapshot.id=o.snapshot_id
                AND same_source_snapshot.source_record_id=o.source_record_id
            )
        ) AS actual_count
      FROM official_snapshot_source_sync sync
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

  const representation = await scalar(
    'representations',
    buildStorageCleanupRepresentationAuditSql(family),
    [family]
  );

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

export async function bindStorageCleanupIntegrityAudit(env, options = {}, precomputedAudit = null) {
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

  const audit = precomputedAudit || await auditStorageCleanupIntegrity(env);
  if (!audit.ok) return { ...audit, sessionId, auditVerified: false };

  await env.DB.prepare(`
    INSERT INTO storage_cleanup_session_audits(session_id,source_sha,verified_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(session_id) DO UPDATE SET
      source_sha=excluded.source_sha,
      verified_at=CURRENT_TIMESTAMP
  `).bind(sessionId, sourceSha).run();

  return { ...audit, sessionId, auditVerified: true };
}
