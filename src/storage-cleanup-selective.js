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
  if (!d || !Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 25)
    throw new Error('unsupported selective source proof scope');
  const bind = Array(sourceCount).fill('?').join(',');
  return [
    'SELECT sr.id AS source_id, sr.content_hash, sr.raw_object_key,',
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
    '       AND (s.id IS NULL OR NOT (' + d.identity + ')',
    '         OR julianday(o.observed_at) IS NULL',
    '         OR julianday(o.observed_at) IS NOT julianday(sr.fetched_at))) AS invalid_observation_count',
    'FROM source_records sr',
    'LEFT JOIN official_snapshot_source_sync sync ON sync.source_record_id=sr.id',
    'WHERE sr.id IN (' + bind + ')'
  ].join(' ');
}

export async function verifySelectiveSourceFamilies(env, family, sourceIds) {
  if (!env?.DB) throw new Error('DB is not configured');
  const ids = [...new Set(sourceIds.map(String))];
  if (ids.length === 0) return new Set();
  const statement = buildSelectiveSourceProofSql(family, ids.length);
  const { results = [] } = await env.DB.prepare(statement)
    .bind(family, family, ...ids).all();
  const safe = new Set();
  for (const row of results) {
    const expected = Number(row.expected_count);
    const total = Number(row.direct_count) + Number(row.remote_count);
    if (row.status !== 'complete' || !Number.isSafeInteger(expected)
      || expected < 1 || total !== expected
      || Number(row.invalid_direct_count) !== 0
      || Number(row.invalid_observation_count) !== 0
      || !/^[a-f0-9]{64}$/.test(String(row.content_hash || ''))
      || !String(row.raw_object_key || '').startsWith('raw/')) continue;
    safe.add(row.source_id);
  }
  return safe;
}
