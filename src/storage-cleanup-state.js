const TARGETS = Object.freeze([
  'horse_profile',
  'horse_stat',
  'horse_record',
  'person_stat',
  'raw_object'
]);

function requireDb(env) {
  if (!env?.DB) throw new Error('DB is not configured');
}

function normalizeTarget(value) {
  const target = String(value || '');
  if (!TARGETS.includes(target)) throw new Error('unsupported cleanup state target');
  return target;
}

function normalizeCursor(value) {
  if (value == null || value === '') return null;
  const cursor = String(value);
  if (cursor.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error('cleanup state cursor is invalid');
  }
  return cursor;
}

function nonNegativeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer`);
  return number;
}

export async function getStorageCleanupState(env) {
  requireDb(env);
  const { results = [] } = await env.DB.prepare(`
    SELECT target,cursor,complete,pages,rows_scanned,rows_removable,rows_removed,
           references_rewritten,canonical_objects_created,legacy_objects_deleted,
           started_at,updated_at
    FROM storage_cleanup_state
    ORDER BY CASE target
      WHEN 'horse_profile' THEN 1
      WHEN 'horse_stat' THEN 2
      WHEN 'horse_record' THEN 3
      WHEN 'person_stat' THEN 4
      WHEN 'raw_object' THEN 5
      ELSE 99 END
  `).all();
  return {
    targets: results.map((row) => ({
      target: row.target,
      cursor: row.cursor || null,
      complete: Number(row.complete || 0) === 1,
      pages: Number(row.pages || 0),
      rowsScanned: Number(row.rows_scanned || 0),
      rowsRemovable: Number(row.rows_removable || 0),
      rowsRemoved: Number(row.rows_removed || 0),
      referencesRewritten: Number(row.references_rewritten || 0),
      canonicalObjectsCreated: Number(row.canonical_objects_created || 0),
      legacyObjectsDeleted: Number(row.legacy_objects_deleted || 0),
      startedAt: row.started_at,
      updatedAt: row.updated_at
    }))
  };
}

export async function checkpointStorageCleanupState(env, body = {}) {
  requireDb(env);
  const target = normalizeTarget(body.target);
  const complete = body.complete === true ? 1 : 0;
  const cursor = complete ? null : normalizeCursor(body.cursor);
  const values = {
    pages: nonNegativeInteger(body.pages, 'pages'),
    rowsScanned: nonNegativeInteger(body.rowsScanned, 'rowsScanned'),
    rowsRemovable: nonNegativeInteger(body.rowsRemovable, 'rowsRemovable'),
    rowsRemoved: nonNegativeInteger(body.rowsRemoved, 'rowsRemoved'),
    referencesRewritten: nonNegativeInteger(body.referencesRewritten, 'referencesRewritten'),
    canonicalObjectsCreated: nonNegativeInteger(body.canonicalObjectsCreated, 'canonicalObjectsCreated'),
    legacyObjectsDeleted: nonNegativeInteger(body.legacyObjectsDeleted, 'legacyObjectsDeleted')
  };

  await env.DB.prepare(`
    INSERT INTO storage_cleanup_state (
      target,cursor,complete,pages,rows_scanned,rows_removable,rows_removed,
      references_rewritten,canonical_objects_created,legacy_objects_deleted
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(target) DO UPDATE SET
      cursor=CASE WHEN storage_cleanup_state.complete=1 THEN NULL ELSE excluded.cursor END,
      complete=MAX(storage_cleanup_state.complete,excluded.complete),
      pages=MAX(storage_cleanup_state.pages,excluded.pages),
      rows_scanned=MAX(storage_cleanup_state.rows_scanned,excluded.rows_scanned),
      rows_removable=MAX(storage_cleanup_state.rows_removable,excluded.rows_removable),
      rows_removed=MAX(storage_cleanup_state.rows_removed,excluded.rows_removed),
      references_rewritten=MAX(storage_cleanup_state.references_rewritten,excluded.references_rewritten),
      canonical_objects_created=MAX(storage_cleanup_state.canonical_objects_created,excluded.canonical_objects_created),
      legacy_objects_deleted=MAX(storage_cleanup_state.legacy_objects_deleted,excluded.legacy_objects_deleted),
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    target,
    cursor,
    complete,
    values.pages,
    values.rowsScanned,
    values.rowsRemovable,
    values.rowsRemoved,
    values.referencesRewritten,
    values.canonicalObjectsCreated,
    values.legacyObjectsDeleted
  ).run();

  return { ok: true, target, complete: Boolean(complete) };
}
