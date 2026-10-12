// An independently checkable, source/family-local proof for selective planning.
// Unknown, incomplete or contradictory sources are quarantined, not deleted.
// Source IDs are processed privately; preview results contain only aggregates and a signed pagination cursor.
const FAMILY = Object.freeze({
  horse_profile: {
    table: 'horse_profile_snapshots', expected: 'horse_profile_count',
    identity: "o.entity_key=s.horse_id AND o.scope_key='profile'"
  },
  horse_stat: {
    table: 'horse_stat_snapshots', expected: 'horse_stat_count',
    identity: 'o.entity_key=s.horse_id AND o.scope_key=s.snapshot_scope'
  },
  horse_record: {
    table: 'horse_record_snapshots', expected: 'horse_record_count',
    identity: "o.entity_key=s.horse_id AND o.scope_key=((CASE WHEN s.record_scope='year' THEN 'year:' || s.stat_year ELSE s.record_scope END) || ':' || s.record_ordinal)"
  },
  person_stat: {
    table: 'person_stat_snapshots', expected: 'person_stat_count',
    identity: "o.entity_key=(s.person_type || ':' || s.person_id) AND o.scope_key=CAST(s.stat_year AS TEXT)"
  }
});

export function buildSelectiveSourceProofSql(family, sourceCount) {
  const d = FAMILY[String(family || '')];
  if (!d || !Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 26)
    throw new Error('unsupported selective source proof scope');
  const bind = Array(sourceCount).fill('?').join(',');
  return [
    'SELECT sr.id AS source_id, sr.source_type, sr.content_hash, sr.raw_object_key,',
    '  sync.status, sync.' + d.expected + ' AS expected_count,',
    '  (SELECT COUNT(*) FROM ' + d.table + ' direct INDEXED BY idx_' + d.table + '_source_record',
    '     WHERE direct.source_record_id=sr.id) AS direct_count,',
    '  (SELECT COUNT(*) FROM official_snapshot_observations o',
    '     INDEXED BY sqlite_autoindex_official_snapshot_observations_1',
    '     WHERE o.source_record_id=sr.id AND o.snapshot_family=?',
    '       AND NOT EXISTS (SELECT 1 FROM ' + d.table + ' own',
    '         WHERE own.id=o.snapshot_id AND own.source_record_id=sr.id)) AS remote_count,',
    '  (SELECT COUNT(*) FROM ' + d.table + ' direct INDEXED BY idx_' + d.table + '_source_record',
    '     WHERE direct.source_record_id=sr.id',
    '       AND (julianday(direct.observed_at) IS NULL OR',
    '            julianday(direct.observed_at) IS NOT julianday(sr.fetched_at))) AS invalid_direct_count,',
    '  (SELECT COUNT(*) FROM official_snapshot_observations o',
    '     INDEXED BY sqlite_autoindex_official_snapshot_observations_1',
    '     LEFT JOIN ' + d.table + ' s ON s.id=o.snapshot_id',
    '     WHERE o.source_record_id=sr.id AND o.snapshot_family=?',
    '       AND (s.id IS NULL OR COALESCE((' + d.identity + '),0)<>1',
    '         OR julianday(o.observed_at) IS NULL',
    '         OR julianday(o.observed_at) IS NOT julianday(sr.fetched_at))) AS invalid_observation_count',
    'FROM source_records sr',
    'LEFT JOIN official_snapshot_source_sync sync ON sync.source_record_id=sr.id',
    'WHERE sr.id IN (' + bind + ')'
  ].join(' ');
}

export async function verifySelectiveSourceFamilies(env, family, sourceIds, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const ids = [...new Set(sourceIds.map(String))];
  if (ids.length === 0) {
    if (options.diagnostic) options.diagnostic.sourceProofRowsRead = 0;
    return new Set();
  }
  const statement = buildSelectiveSourceProofSql(family, ids.length);
  const { results = [], meta = {} } = await env.DB.prepare(statement)
    .bind(family, family, ...ids).all();
  if (options.diagnostic) {
    const reads = meta?.rows_read == null ? null : Number(meta.rows_read);
    options.diagnostic.sourceProofRowsRead = Number.isSafeInteger(reads) && reads >= 0 ? reads : null;
  }
  const safe = new Set();
  if (options.verifyRawHead === true && !env.RAW_BUCKET?.head)
    throw new Error('selective source proof requires R2 HEAD access');
  for (const row of results) {
    const expected = Number(row.expected_count);
    const total = Number(row.direct_count) + Number(row.remote_count);
    if (row.source_type !== 'official_provider' || row.status !== 'complete' || !Number.isSafeInteger(expected)
      || expected < 1 || total !== expected
      || Number(row.invalid_direct_count) !== 0
      || Number(row.invalid_observation_count) !== 0
      || !/^[a-f0-9]{64}$/.test(String(row.content_hash || ''))
      || !String(row.raw_object_key || '').startsWith('raw/')) continue;
    if (options.verifyRawHead === true) {
      // Missing or inconsistent originals stay quarantined. Transient R2
      // transport errors must propagate and stop the entire preview.
      if (options.diagnostic) options.diagnostic.rawHeadRequests += 1;
      const raw = await env.RAW_BUCKET.head(row.raw_object_key);
      if (!raw || !Number.isFinite(Number(raw.size)) || Number(raw.size) < 1
          || raw.customMetadata?.contentHash !== row.content_hash
          || raw.customMetadata?.sourceType !== row.source_type) continue;
    }
    safe.add(row.source_id);
  }
  return safe;
}
