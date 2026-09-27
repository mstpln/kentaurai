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

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function auditFamily(env, family, definition) {
  const representation = await env.DB.prepare(`
    WITH represented AS (
      SELECT source_record_id, ${definition.directIdentity}
      FROM ${definition.table}
      UNION
      SELECT source_record_id,entity_key,scope_key
      FROM official_snapshot_observations
      WHERE snapshot_family=?
    ), represented_counts AS (
      SELECT source_record_id,COUNT(*) AS n
      FROM represented
      GROUP BY source_record_id
    )
    SELECT
      COUNT(*) AS mismatched_sources,
      COALESCE(SUM(
        CASE WHEN sync.${definition.expectedColumn} > COALESCE(represented_counts.n,0)
          THEN sync.${definition.expectedColumn} - COALESCE(represented_counts.n,0)
          ELSE 0 END
      ),0) AS missing_representations,
      COALESCE(SUM(
        CASE WHEN COALESCE(represented_counts.n,0) > sync.${definition.expectedColumn}
          THEN COALESCE(represented_counts.n,0) - sync.${definition.expectedColumn}
          ELSE 0 END
      ),0) AS excess_representations
    FROM official_snapshot_source_sync sync
    LEFT JOIN represented_counts ON represented_counts.source_record_id=sync.source_record_id
    WHERE sync.status='complete'
      AND sync.${definition.expectedColumn} <> COALESCE(represented_counts.n,0)
  `).bind(family).first();

  const observation = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS dangling_observations,
      SUM(CASE WHEN s.id IS NOT NULL AND NOT (${definition.identityPredicate}) THEN 1 ELSE 0 END) AS identity_mismatch_observations
    FROM official_snapshot_observations o
    LEFT JOIN ${definition.table} s ON s.id=o.snapshot_id
    WHERE o.snapshot_family=?
  `).bind(family).first();

  const result = {
    family,
    mismatchedSources: number(representation?.mismatched_sources),
    missingRepresentations: number(representation?.missing_representations),
    excessRepresentations: number(representation?.excess_representations),
    danglingObservations: number(observation?.dangling_observations),
    identityMismatchObservations: number(observation?.identity_mismatch_observations)
  };
  result.ok = result.mismatchedSources === 0
    && result.missingRepresentations === 0
    && result.excessRepresentations === 0
    && result.danglingObservations === 0
    && result.identityMismatchObservations === 0;
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

  const toObject = (rows) => Object.fromEntries(
    (rows || []).map((row) => [String(row.status), number(row.n)])
  );
  return {
    batchStatuses: toObject(batches?.results),
    sessionStatuses: toObject(sessions?.results)
  };
}

export async function auditStorageCleanupIntegrity(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const families = [];
  for (const [family, definition] of Object.entries(FAMILY_AUDITS)) {
    families.push(await auditFamily(env, family, definition));
  }
  const operations = await operationalCounts(env);
  return {
    ok: families.every((family) => family.ok),
    families,
    operations
  };
}
