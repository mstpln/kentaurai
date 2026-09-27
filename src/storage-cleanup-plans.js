export const SNAPSHOT_FAMILIES = Object.freeze({
  horse_profile: {
    table: 'horse_profile_snapshots', entity: ['horse_id'], scope: [],
    facts: ['age_years']
  },
  horse_stat: {
    table: 'horse_stat_snapshots', entity: ['horse_id'], scope: ['snapshot_scope'],
    facts: ['stat_year','starts','earnings_raw','wins','seconds','thirds','win_percentage_raw','place_percentage_raw','earnings_per_start_raw','start_points']
  },
  horse_record: {
    table: 'horse_record_snapshots', entity: ['horse_id'], scope: ['record_scope','stat_year','record_ordinal'],
    facts: ['code','start_method','distance_group','time_minutes','time_seconds','time_tenths','place']
  },
  person_stat: {
    table: 'person_stat_snapshots', entity: ['person_type','person_id'], scope: ['stat_year'],
    facts: ['starts','earnings_raw','wins','seconds','thirds','win_percentage_raw']
  }
});

export function boundedCleanupLimit(value, max = 10000) {
  const limit = value == null ? 1000 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new Error(`limit must be between 1 and ${max}`);
  return limit;
}

function tuple(row, columns) { return columns.map((column) => row[column]); }
function equalTuple(left, right) { return left.length === right.length && left.every((value, index) => Object.is(value, right[index])); }
function key(row, columns) { return JSON.stringify(tuple(row, columns)); }
export function snapshotFactsEqual(left, right) { return equalTuple(left, right); }
function chunks(values, size = 80) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

export async function planOfficialSnapshotCleanup(env, { family, limit } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const definition = SNAPSHOT_FAMILIES[String(family || '')];
  if (!definition) throw new Error('unsupported snapshot family');
  const rowLimit = boundedCleanupLimit(limit);
  const partition = [...definition.entity, ...definition.scope];
  const { results = [] } = await env.DB.prepare(
    `SELECT * FROM ${definition.table} ORDER BY ${partition.join(',')}, julianday(observed_at), id LIMIT ?`
  ).bind(rowLimit + 1).all();
  const truncated = results.length > rowLimit;
  const rows = results.slice(0, rowLimit);
  let rowsRetained = 0;
  let rowsRemovable = 0;
  let priorPartition = null;
  let priorFacts = null;
  for (const row of rows) {
    const partitionKey = key(row, partition);
    const facts = tuple(row, definition.facts);
    if (partitionKey === priorPartition && equalTuple(facts, priorFacts)) rowsRemovable += 1;
    else rowsRetained += 1;
    priorPartition = partitionKey;
    priorFacts = facts;
  }
  return {
    dryRun: true,
    family,
    table: definition.table,
    limit: rowLimit,
    rowsScanned: rows.length,
    rowsRetained,
    rowsRemovable,
    warnings: truncated ? ['limit_reached_results_incomplete'] : []
  };
}

function extensionFromKey(keyValue) {
  const match = String(keyValue || '').match(/\.([a-z0-9]{1,10})$/i);
  return match ? match[1].toLowerCase() : null;
}

function hashFromKey(keyValue) {
  const match = String(keyValue || '').match(/\/([a-f0-9]{64})\.[a-z0-9]{1,10}$/i);
  return match ? match[1].toLowerCase() : null;
}

export async function planRawObjectDeduplication(env, { sourceType = null, limit } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const rowLimit = boundedCleanupLimit(limit);
  const filter = sourceType == null ? '' : 'AND source_type = ?';
  const statement = env.DB.prepare(`
    SELECT id,source_type,content_hash,raw_object_key
    FROM source_records
    WHERE content_hash IS NOT NULL AND raw_object_key IS NOT NULL ${filter}
    ORDER BY source_type,content_hash,id
    LIMIT ?
  `);
  const bound = sourceType == null ? statement.bind(rowLimit + 1) : statement.bind(String(sourceType), rowLimit + 1);
  const { results = [] } = await bound.all();
  const truncated = results.length > rowLimit;
  const rows = results.slice(0, rowLimit);
  let referenceRewrites = 0;
  const oldKeys = new Set();
  const warnings = [];
  for (const row of rows) {
    const contentHash = String(row.content_hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentHash)) { warnings.push('invalid_content_hash'); continue; }
    const extension = extensionFromKey(row.raw_object_key);
    if (!extension) { warnings.push('invalid_legacy_extension'); continue; }
    const keyHash = hashFromKey(row.raw_object_key);
    if (!keyHash) { warnings.push('legacy_key_hash_unverifiable'); continue; }
    if (keyHash !== contentHash) { warnings.push('content_hash_key_mismatch'); continue; }
    const canonicalKey = `raw/${row.source_type}/${contentHash}.${extension}`;
    if (row.raw_object_key !== canonicalKey) {
      referenceRewrites += 1;
      oldKeys.add(row.raw_object_key);
    }
  }
  const selectedCounts = new Map();
  for (const row of rows) selectedCounts.set(row.raw_object_key, (selectedCounts.get(row.raw_object_key) || 0) + 1);
  let redundantObjectCandidates = 0;
  for (const group of chunks([...oldKeys])) {
    const { results: references = [] } = await env.DB.prepare(
      `SELECT raw_object_key,COUNT(*) AS n FROM source_records WHERE raw_object_key IN (${group.map(() => '?').join(',')}) GROUP BY raw_object_key`
    ).bind(...group).all();
    for (const row of references) {
      if (Number(row.n || 0) === Number(selectedCounts.get(row.raw_object_key) || 0)) redundantObjectCandidates += 1;
    }
  }
  if (truncated) warnings.push('limit_reached_results_incomplete');
  return {
    dryRun: true,
    sourceType: sourceType == null ? null : String(sourceType),
    limit: rowLimit,
    rowsScanned: rows.length,
    referenceRewrites,
    redundantObjectCandidates,
    warnings: [...new Set(warnings)].sort()
  };
}
