import { boundedCleanupLimit, SNAPSHOT_FAMILIES, snapshotFactsEqual } from './storage-cleanup-plans.js';

const MAX_BATCH = 25;
const MAX_RAW_COPY_BYTES = 10 * 1024 * 1024;
export const CLEANUP_CONFIRMATION = 'execute-reviewed-storage-cleanup-batch';

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const encoded = String(value).replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function cursorSignature(env, payload) {
  const secret = env?.STORAGE_CLEANUP_CURSOR_SECRET || env?.ADMIN_TOKEN;
  if (!secret) throw new Error('cleanup cursor signing is not configured');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

async function encodeCursor(env, value) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${payload}.${await cursorSignature(env, payload)}`;
}

async function decodeCursor(env, value, kind) {
  if (value == null || value === '') return null;
  try {
    const [payload, signature, extra] = String(value).split('.');
    if (!payload || !signature || extra || signature !== await cursorSignature(env, payload)) throw new Error();
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (parsed?.v !== 1 || parsed?.kind !== kind) throw new Error();
    return parsed;
  } catch {
    throw new Error('cleanup cursor is invalid');
  }
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenFor(value) {
  return sha256Hex(JSON.stringify(value));
}

function assertExecutionRequest({ planToken, confirmation }) {
  if (!/^[a-f0-9]{64}$/.test(String(planToken || ''))) throw new Error('valid plan_token is required');
  if (confirmation !== CLEANUP_CONFIRMATION) throw new Error('cleanup confirmation is invalid');
}

function snapshotPartitionKey(row, columns) {
  return JSON.stringify(columns.map((column) => row[column]));
}

function snapshotTuple(row, columns) {
  return columns.map((column) => row[column]);
}

function snapshotOrderExpression(family, column) {
  return family === 'horse_record' && column === 'stat_year' ? 'COALESCE(stat_year,-1)' : column;
}

function snapshotOrderValue(family, row, column) {
  return family === 'horse_record' && column === 'stat_year' ? (row[column] ?? -1) : row[column];
}

function snapshotOrderTuple(family, row, columns) {
  return columns.map((column) => snapshotOrderValue(family, row, column));
}

function snapshotObservationIdentity(family, row) {
  if (family === 'horse_profile') {
    return { entityKey: row.horse_id, scopeKey: 'profile' };
  }
  if (family === 'horse_stat') {
    return { entityKey: row.horse_id, scopeKey: row.snapshot_scope };
  }
  if (family === 'horse_record') {
    const scope = row.record_scope === 'year' ? `year:${row.stat_year}` : row.record_scope;
    return { entityKey: row.horse_id, scopeKey: `${scope}:${row.record_ordinal}` };
  }
  if (family === 'person_stat') {
    return { entityKey: `${row.person_type}:${row.person_id}`, scopeKey: String(row.stat_year) };
  }
  throw new Error('unsupported snapshot family');
}


async function detailedSnapshotPlan(env, { family, limit, cursor = null }) {
  if (!env?.DB) throw new Error('DB is not configured');
  const definition = SNAPSHOT_FAMILIES[String(family || '')];
  if (!definition) throw new Error('unsupported snapshot family');
  const rowLimit = boundedCleanupLimit(limit, MAX_BATCH);
  const partition = [...definition.entity, ...definition.scope];
  const decoded = await decodeCursor(env, cursor, `snapshot:${family}`);
  let sql = `SELECT * FROM ${definition.table}`;
  let bindings = [];
  if (decoded) {
    if (!Array.isArray(decoded.order) || decoded.order.length !== partition.length + 2) throw new Error('cleanup cursor is invalid');
    const left = [...partition.map((column) => snapshotOrderExpression(family, column)), 'observed_at', 'id'].join(',');
    const right = [...partition.map(() => '?'), '?', '?'].join(',');
    sql += ` WHERE (${left}) > (${right})`;
    bindings = decoded.order;
  }
  sql += ` ORDER BY ${partition.map((column) => snapshotOrderExpression(family, column)).join(',')}, observed_at, id LIMIT ?`;
  const { results = [] } = await env.DB.prepare(sql).bind(...bindings, rowLimit + 1).all();
  const truncated = results.length > rowLimit;
  const rows = results.slice(0, rowLimit);
  let priorPartition = decoded?.priorPartition ?? null;
  let priorFacts = decoded?.priorFacts ?? null;
  let retainedId = decoded?.retainedId ?? null;
  let rowsRetained = 0;
  const candidates = [];
  for (const row of rows) {
    const partitionKey = snapshotPartitionKey(row, partition);
    const facts = snapshotTuple(row, definition.facts);
    if (partitionKey === priorPartition && snapshotFactsEqual(facts, priorFacts)) {
      const observation = snapshotObservationIdentity(family, row);
      candidates.push({
        removeId: row.id,
        retainId: retainedId,
        sourceRecordId: row.source_record_id,
        observedAt: row.observed_at,
        entityKey: observation.entityKey,
        scopeKey: observation.scopeKey
      });
    } else {
      rowsRetained += 1;
      priorPartition = partitionKey;
      priorFacts = facts;
      retainedId = row.id;
    }
  }
  const last = rows.at(-1);
  const nextCursor = truncated && last ? await encodeCursor(env, {
    v: 1,
    kind: `snapshot:${family}`,
    order: [...snapshotOrderTuple(family, last, partition), last.observed_at, last.id],
    priorPartition,
    priorFacts,
    retainedId
  }) : null;
  const material = { kind: 'snapshot', family, cursor: cursor || null, candidates, nextCursor };
  return {
    family,
    definition,
    candidates,
    nextCursor,
    planToken: await tokenFor(material),
    report: {
      dryRun: true,
      family,
      table: definition.table,
      limit: rowLimit,
      rowsScanned: rows.length,
      rowsRetained,
      rowsRemovable: candidates.length,
      truncated,
      warnings: truncated ? ['limit_reached_results_incomplete'] : [],
      planToken: await tokenFor(material),
      nextCursor
    }
  };
}

export async function planSnapshotCleanupBatch(env, options = {}) {
  return (await detailedSnapshotPlan(env, options)).report;
}

export async function executeSnapshotCleanupBatch(env, options = {}) {
  assertExecutionRequest(options);
  const plan = await detailedSnapshotPlan(env, options);
  if (plan.planToken !== options.planToken) throw new Error('cleanup plan changed; run dry-run again');
  if (plan.candidates.length === 0) return { executed: true, family: plan.family, rowsRemoved: 0, nextCursor: plan.nextCursor };
  const batchId = crypto.randomUUID();
  const statements = [env.DB.prepare(`
    INSERT INTO storage_cleanup_batches
      (id,cleanup_kind,target,plan_token,expected_changes,status)
    VALUES (?,'snapshot',?,?,?,'started')
  `).bind(batchId, plan.family, plan.planToken, plan.candidates.length)];
  for (const candidate of plan.candidates) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO official_snapshot_observations
        (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
      VALUES (?,?,?,?,?,?,0)
    `).bind(
      candidate.sourceRecordId,
      plan.family,
      candidate.entityKey,
      candidate.scopeKey,
      candidate.observedAt,
      candidate.retainId
    ));
    statements.push(env.DB.prepare(`
      UPDATE official_snapshot_observations SET snapshot_id=?,factual_changed=0
      WHERE snapshot_family=? AND snapshot_id=?
    `).bind(candidate.retainId, plan.family, candidate.removeId));
  }
  const partition = [...plan.definition.entity, ...plan.definition.scope];
  const samePartition = partition.map((column) => `prior.${column} IS doomed.${column}`).join(' AND ');
  const betweenPartition = partition.map((column) => `between_row.${column} IS doomed.${column}`).join(' AND ');
  const sameFacts = plan.definition.facts.map((column) => `prior.${column} IS doomed.${column}`).join(' AND ');
  const betweenSameFacts = plan.definition.facts.map((column) => `between_row.${column} IS doomed.${column}`).join(' AND ');
  const candidateGuards = plan.candidates.map(() => `(
    doomed.id=? AND EXISTS (
      SELECT 1 FROM ${plan.definition.table} prior
      WHERE prior.id=? AND ${samePartition} AND ${sameFacts}
        AND NOT EXISTS (
          SELECT 1 FROM ${plan.definition.table} between_row
          WHERE ${betweenPartition}
            AND (julianday(between_row.observed_at),between_row.id) > (julianday(prior.observed_at),prior.id)
            AND (julianday(between_row.observed_at),between_row.id) < (julianday(doomed.observed_at),doomed.id)
            AND NOT (${betweenSameFacts})
        )
    )
  )`).join(' OR ');
  statements.push(env.DB.prepare(`
    DELETE FROM ${plan.definition.table} AS doomed
    WHERE (${candidateGuards})
      AND NOT EXISTS (
        SELECT 1 FROM official_snapshot_observations o
        WHERE o.snapshot_family=? AND o.snapshot_id=doomed.id
      )
  `).bind(...plan.candidates.flatMap((candidate) => [candidate.removeId, candidate.retainId]), plan.family));
  statements.push(env.DB.prepare(`
    UPDATE storage_cleanup_batches
    SET actual_changes=changes(),status='complete',completed_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(batchId));
  await env.DB.batch(statements);
  return { executed: true, family: plan.family, rowsRemoved: plan.candidates.length, nextCursor: plan.nextCursor };
}

function extensionFromKey(value) {
  const match = String(value || '').match(/\.([a-z0-9]{1,10})$/i);
  return match ? match[1].toLowerCase() : null;
}

function hashFromKey(value) {
  const match = String(value || '').match(/\/([a-f0-9]{64})\.[a-z0-9]{1,10}$/i);
  return match ? match[1].toLowerCase() : null;
}

async function detailedRawPlan(env, { sourceType = null, limit, cursor = null }) {
  if (!env?.DB || !env?.RAW_BUCKET) throw new Error('DB and RAW_BUCKET are required');
  const rowLimit = boundedCleanupLimit(limit, MAX_BATCH);
  const normalizedSourceType = sourceType == null ? null : String(sourceType);
  const decoded = await decodeCursor(env, cursor, 'raw_object');
  let sql = `SELECT id,source_type,content_hash,raw_object_key FROM source_records
    WHERE content_hash IS NOT NULL AND raw_object_key IS NOT NULL`;
  const bindings = [];
  if (normalizedSourceType != null) { sql += ' AND source_type=?'; bindings.push(normalizedSourceType); }
  if (decoded) {
    if (!Array.isArray(decoded.order) || decoded.order.length !== 3) throw new Error('cleanup cursor is invalid');
    sql += ' AND (source_type,content_hash,id) > (?,?,?)';
    bindings.push(...decoded.order);
  }
  sql += ' ORDER BY source_type,content_hash,id LIMIT ?';
  const { results = [] } = await env.DB.prepare(sql).bind(...bindings, rowLimit + 1).all();
  const truncated = results.length > rowLimit;
  const rows = results.slice(0, rowLimit);
  const warnings = [];
  let selected = null;
  for (const row of rows) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(String(row.source_type || ''))) { warnings.push('invalid_source_type'); continue; }
    const hash = String(row.content_hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) { warnings.push('invalid_content_hash'); continue; }
    const extension = extensionFromKey(row.raw_object_key);
    if (!extension) { warnings.push('invalid_legacy_extension'); continue; }
    if (hashFromKey(row.raw_object_key) !== hash) { warnings.push('content_hash_key_mismatch'); continue; }
    const canonicalKey = `raw/${row.source_type}/${hash}.${extension}`;
    if (canonicalKey !== row.raw_object_key) { selected = { row, hash, extension, canonicalKey, legacyKey: row.raw_object_key }; break; }
  }
  const last = rows.at(-1);
  const pageCursor = truncated && last ? await encodeCursor(env, { v: 1, kind: 'raw_object', order: [last.source_type, last.content_hash, last.id] }) : null;
  let references = [];
  let legacyReferences = 0;
  let canonicalReferences = 0;
  if (selected) {
    const count = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN raw_object_key=? THEN 1 ELSE 0 END) AS legacy_n,
        SUM(CASE WHEN raw_object_key=? THEN 1 ELSE 0 END) AS canonical_n
      FROM source_records WHERE raw_object_key IN (?,?)
    `).bind(selected.legacyKey, selected.canonicalKey, selected.legacyKey, selected.canonicalKey).first();
    legacyReferences = Number(count?.legacy_n || 0);
    canonicalReferences = Number(count?.canonical_n || 0);
    const result = await env.DB.prepare(`
      SELECT id FROM source_records
      WHERE raw_object_key=? AND source_type=? AND content_hash=?
      ORDER BY id LIMIT ?
    `).bind(selected.legacyKey, selected.row.source_type, selected.hash, MAX_BATCH).all();
    references = result.results || [];
    if (references.length !== Math.min(legacyReferences, MAX_BATCH)) warnings.push('legacy_reference_conflict');
  }
  if (truncated) warnings.push('limit_reached_results_incomplete');
  const material = selected ? {
    kind: 'raw_object',
    cursor: cursor || null,
    sourceType: normalizedSourceType,
    source: selected.row.source_type,
    hash: selected.hash,
    extension: selected.extension,
    legacyKey: selected.legacyKey,
    canonicalKey: selected.canonicalKey,
    referenceIds: references.map((row) => row.id),
    legacyReferences,
    canonicalReferences
  } : { kind: 'raw_object', cursor: cursor || null, sourceType: normalizedSourceType, empty: true, pageCursor };
  const planToken = await tokenFor(material);
  return {
    selected,
    references,
    legacyReferences,
    canonicalReferences,
    pageCursor,
    planToken,
    warnings: [...new Set(warnings)].sort(),
    report: {
      dryRun: true,
      sourceType: normalizedSourceType,
      limit: rowLimit,
      rowsScanned: rows.length,
      referenceRewrites: references.length,
      legacyReferences,
      canonicalReferences,
      redundantObjectCandidates: selected && legacyReferences === references.length ? 1 : 0,
      conflictsSkipped: warnings.filter((warning) => warning !== 'limit_reached_results_incomplete').length,
      truncated,
      warnings: [...new Set(warnings)].sort(),
      planToken,
      nextCursor: selected ? (cursor || null) : pageCursor
    }
  };
}

export async function planRawCleanupBatch(env, options = {}) {
  return (await detailedRawPlan(env, options)).report;
}

async function objectBytes(object) {
  if (typeof object.arrayBuffer === 'function') return new Uint8Array(await object.arrayBuffer());
  if (typeof object.text === 'function') return new TextEncoder().encode(await object.text());
  throw new Error('legacy R2 object body is unreadable');
}

function verifiedCanonicalHead(head, hash, sourceType, legacyHead) {
  if (head?.customMetadata?.contentHash !== hash || head?.customMetadata?.sourceType !== sourceType) {
    throw new Error('canonical R2 object metadata/hash conflict');
  }
  if (Number.isFinite(head.size) && Number.isFinite(legacyHead?.size) && head.size !== legacyHead.size) {
    throw new Error('canonical R2 object size conflict');
  }
}

export async function executeRawCleanupBatch(env, options = {}) {
  assertExecutionRequest(options);
  if (typeof env?.RAW_BUCKET?.delete !== 'function') throw new Error('RAW_BUCKET delete is not configured');
  const plan = await detailedRawPlan(env, options);
  if (plan.planToken !== options.planToken) throw new Error('cleanup plan changed; run dry-run again');
  if (!plan.selected) return { executed: true, referencesRewritten: 0, canonicalObjectsCreated: 0, legacyObjectsDeleted: 0, nextCursor: plan.pageCursor };
  if (plan.warnings.some((warning) => warning !== 'limit_reached_results_incomplete')) throw new Error('raw cleanup plan contains a conflict');
  const { selected } = plan;
  const legacyHead = await env.RAW_BUCKET.head(selected.legacyKey);
  if (!legacyHead) throw new Error('referenced legacy R2 object is missing');
  let canonicalHead = await env.RAW_BUCKET.head(selected.canonicalKey);
  let canonicalObjectsCreated = 0;
  const priorVerification = await env.DB.prepare(`
    SELECT legacy_etag,canonical_etag FROM storage_cleanup_batches
    WHERE cleanup_kind='raw_object' AND legacy_key=? AND canonical_key=? AND object_verified=1
    ORDER BY created_at DESC LIMIT 1
  `).bind(selected.legacyKey, selected.canonicalKey).first();
  const legacyEtag = typeof legacyHead.etag === 'string' ? legacyHead.etag : null;
  const canonicalEtag = typeof canonicalHead?.etag === 'string' ? canonicalHead.etag : null;
  const reusableVerification = Boolean(
    priorVerification && legacyEtag && canonicalEtag
    && priorVerification.legacy_etag === legacyEtag
    && priorVerification.canonical_etag === canonicalEtag
  );
  let verifiedLegacyBytes = null;
  if (!reusableVerification) {
    if (Number.isFinite(legacyHead.size) && legacyHead.size > MAX_RAW_COPY_BYTES) throw new Error('legacy R2 object exceeds copy safety limit');
    const legacyObject = await env.RAW_BUCKET.get(selected.legacyKey);
    if (!legacyObject) throw new Error('referenced legacy R2 object is missing');
    verifiedLegacyBytes = await objectBytes(legacyObject);
    if (verifiedLegacyBytes.byteLength > MAX_RAW_COPY_BYTES) throw new Error('legacy R2 object exceeds copy safety limit');
    if (await sha256Hex(verifiedLegacyBytes) !== selected.hash) throw new Error('legacy R2 body hash mismatch');
  }
  if (canonicalHead && !reusableVerification) {
    if (Number.isFinite(canonicalHead.size) && canonicalHead.size > MAX_RAW_COPY_BYTES) throw new Error('canonical R2 object exceeds verification safety limit');
    const canonicalObject = await env.RAW_BUCKET.get(selected.canonicalKey);
    if (!canonicalObject) throw new Error('canonical R2 object disappeared during verification');
    const canonicalBytes = await objectBytes(canonicalObject);
    if (canonicalBytes.byteLength > MAX_RAW_COPY_BYTES) throw new Error('canonical R2 object exceeds verification safety limit');
    if (await sha256Hex(canonicalBytes) !== selected.hash) throw new Error('canonical R2 body hash mismatch');
  }
  if (!canonicalHead) {
    if (!verifiedLegacyBytes) throw new Error('legacy R2 verification state is invalid');
    await env.RAW_BUCKET.put(selected.canonicalKey, verifiedLegacyBytes, {
      httpMetadata: legacyHead.httpMetadata,
      customMetadata: { sourceType: selected.row.source_type, contentHash: selected.hash, contentType: legacyHead.httpMetadata?.contentType || '' }
    });
    canonicalHead = await env.RAW_BUCKET.head(selected.canonicalKey);
    canonicalObjectsCreated = 1;
  }
  verifiedCanonicalHead(canonicalHead, selected.hash, selected.row.source_type, legacyHead);
  const batchId = crypto.randomUUID();
  const ids = plan.references.map((row) => row.id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO storage_cleanup_batches
          (id,cleanup_kind,target,plan_token,expected_changes,status,
           legacy_key,canonical_key,legacy_etag,canonical_etag,object_verified)
        VALUES (?,'raw_object',?,?,?,'started',?,?,?,?,1)
      `).bind(
        batchId, selected.row.source_type, plan.planToken, ids.length,
        selected.legacyKey, selected.canonicalKey,
        typeof legacyHead.etag === 'string' ? legacyHead.etag : null,
        typeof canonicalHead.etag === 'string' ? canonicalHead.etag : null
      ),
      env.DB.prepare(`
        UPDATE source_records SET raw_object_key=?
        WHERE id IN (${placeholders}) AND raw_object_key=? AND source_type=? AND content_hash=?
      `).bind(selected.canonicalKey, ...ids, selected.legacyKey, selected.row.source_type, selected.hash),
      env.DB.prepare(`
        UPDATE storage_cleanup_batches
        SET actual_changes=changes(),status='references_rewritten'
        WHERE id=?
      `).bind(batchId)
    ]);
  }
  const remaining = await env.DB.prepare('SELECT COUNT(*) AS n FROM source_records WHERE raw_object_key=?')
    .bind(selected.legacyKey).first();
  let legacyObjectsDeleted = 0;
  if (Number(remaining?.n || 0) === 0) {
    await env.RAW_BUCKET.delete(selected.legacyKey);
    if (await env.RAW_BUCKET.head(selected.legacyKey)) throw new Error('legacy R2 object deletion could not be verified');
    legacyObjectsDeleted = 1;
    if (ids.length > 0) await env.DB.prepare(`UPDATE storage_cleanup_batches SET status='complete',completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(batchId).run();
  }
  return {
    executed: true,
    referencesRewritten: ids.length,
    canonicalObjectsCreated,
    legacyObjectsDeleted,
    legacyReferencesRemaining: Number(remaining?.n || 0),
    nextCursor: plan.selected ? (options.cursor || null) : plan.pageCursor
  };
}
