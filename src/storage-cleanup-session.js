const TARGETS = Object.freeze([
  'horse_profile',
  'horse_stat',
  'horse_record',
  'person_stat',
  'raw_object'
]);
const MAX_CONTINUATIONS = 48;
const SESSION_TTL_HOURS = 24;
const MAX_CURSOR_CHARS = 16384;

function requireDb(env) {
  if (!env?.DB) throw new Error('DB is not configured');
}

function normalizeSha(value) {
  const sha = String(value || '');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('valid source_sha is required');
  return sha;
}

function normalizeSessionId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('valid cleanup session_id is required');
  }
  return id;
}

function normalizeTarget(value) {
  const target = String(value || '');
  if (!TARGETS.includes(target)) throw new Error('unsupported cleanup session target');
  return target;
}

function normalizeCursor(value, complete) {
  if (complete) return null;
  const cursor = String(value || '');
  if (
    cursor.length < 3
    || cursor.length > MAX_CURSOR_CHARS
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw new Error('incomplete cleanup checkpoint requires a valid signed cursor');
  }
  return cursor;
}

function expired(session) {
  const timestamp = Date.parse(String(session?.expires_at || ''));
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

async function loadSession(env, id) {
  return env.DB.prepare(`
    SELECT id,source_sha,status,continuation_count,created_at,updated_at,expires_at,completed_at
    FROM storage_cleanup_sessions
    WHERE id=?
  `).bind(id).first();
}

async function loadRunningForSource(env, sourceSha) {
  return env.DB.prepare(`
    SELECT id,source_sha,status,continuation_count,created_at,updated_at,expires_at,completed_at
    FROM storage_cleanup_sessions
    WHERE source_sha=? AND status='running'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(sourceSha).first();
}

async function loadTargets(env, id) {
  const { results = [] } = await env.DB.prepare(`
    SELECT target,cursor,is_complete,updated_at
    FROM storage_cleanup_session_targets
    WHERE session_id=?
    ORDER BY CASE target
      WHEN 'horse_profile' THEN 1
      WHEN 'horse_stat' THEN 2
      WHEN 'horse_record' THEN 3
      WHEN 'person_stat' THEN 4
      WHEN 'raw_object' THEN 5
      ELSE 99 END
  `).bind(id).all();
  return results.map((row) => ({
    target: row.target,
    cursor: row.cursor || null,
    complete: Number(row.is_complete || 0) === 1
  }));
}

async function markExpired(env, id) {
  await env.DB.prepare(`
    UPDATE storage_cleanup_sessions
    SET status='expired',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running'
  `).bind(id).run();
}

async function resumeRunningSession(env, session) {
  if (expired(session)) {
    await markExpired(env, session.id);
    throw new Error('cleanup session expired; start a new session');
  }
  const count = Number(session.continuation_count || 0);
  if (count >= MAX_CONTINUATIONS) throw new Error('cleanup session continuation limit reached');
  await env.DB.prepare(`
    UPDATE storage_cleanup_sessions
    SET continuation_count=continuation_count+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running'
  `).bind(session.id).run();
  return loadSession(env, session.id);
}

async function createSession(env, sourceSha) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const statements = [
    env.DB.prepare(`
      INSERT INTO storage_cleanup_sessions
        (id,source_sha,status,continuation_count,expires_at)
      VALUES (?,?,'running',1,?)
    `).bind(id, sourceSha, expiresAt)
  ];
  for (const target of TARGETS) {
    statements.push(env.DB.prepare(`
      INSERT INTO storage_cleanup_session_targets(session_id,target,cursor,is_complete)
      VALUES (?,?,NULL,0)
    `).bind(id, target));
  }
  await env.DB.batch(statements);
  return loadSession(env, id);
}

function toResponse(session, targets) {
  return {
    sessionId: session.id,
    sourceSha: session.source_sha,
    status: session.status,
    continuationCount: Number(session.continuation_count || 0),
    maxContinuations: MAX_CONTINUATIONS,
    expiresAt: session.expires_at,
    targets
  };
}

export async function startOrResumeStorageCleanupSession(env, options = {}) {
  requireDb(env);
  const sourceSha = normalizeSha(options.source_sha);
  const requestedId = options.session_id == null || options.session_id === ''
    ? null
    : normalizeSessionId(options.session_id);

  let session;
  if (requestedId) {
    session = await loadSession(env, requestedId);
    if (!session) throw new Error('cleanup session not found');
    if (session.source_sha !== sourceSha) throw new Error('cleanup session source_sha changed; start a new session');
    if (session.status === 'expired' || expired(session)) {
      if (session.status === 'running') await markExpired(env, session.id);
      throw new Error('cleanup session expired; start a new session');
    }
    if (session.status === 'running') session = await resumeRunningSession(env, session);
  } else {
    session = await loadRunningForSource(env, sourceSha);
    if (session && expired(session)) {
      await markExpired(env, session.id);
      session = null;
    }
    if (session) session = await resumeRunningSession(env, session);
    else session = await createSession(env, sourceSha);
  }

  return toResponse(session, await loadTargets(env, session.id));
}

export async function checkpointStorageCleanupSession(env, options = {}) {
  requireDb(env);
  const sessionId = normalizeSessionId(options.session_id);
  const sourceSha = normalizeSha(options.source_sha);
  const target = normalizeTarget(options.target);
  const complete = options.complete === true;
  const cursor = normalizeCursor(options.cursor, complete);

  let session = await loadSession(env, sessionId);
  if (!session) throw new Error('cleanup session not found');
  if (session.source_sha !== sourceSha) throw new Error('cleanup session source_sha changed; start a new session');
  if (session.status === 'expired' || expired(session)) {
    if (session.status === 'running') await markExpired(env, session.id);
    throw new Error('cleanup session expired; start a new session');
  }
  if (session.status === 'complete') {
    return { sessionId, target, complete: true, sessionComplete: true };
  }

  const result = await env.DB.prepare(`
    UPDATE storage_cleanup_session_targets
    SET
      cursor=CASE WHEN is_complete=1 OR ?=1 THEN NULL ELSE ? END,
      is_complete=CASE WHEN is_complete=1 OR ?=1 THEN 1 ELSE 0 END,
      updated_at=CURRENT_TIMESTAMP
    WHERE session_id=? AND target=?
  `).bind(complete ? 1 : 0, cursor, complete ? 1 : 0, sessionId, target).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new Error('cleanup session target checkpoint failed');

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM storage_cleanup_session_targets
    WHERE session_id=? AND is_complete=0
  `).bind(sessionId).first();
  const sessionComplete = Number(remaining?.n || 0) === 0;
  if (sessionComplete) {
    await env.DB.prepare(`
      UPDATE storage_cleanup_sessions
      SET status='complete',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running'
    `).bind(sessionId).run();
  } else {
    await env.DB.prepare(`
      UPDATE storage_cleanup_sessions SET updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running'
    `).bind(sessionId).run();
  }

  session = await loadSession(env, sessionId);
  return {
    sessionId,
    target,
    complete,
    sessionComplete,
    continuationCount: Number(session?.continuation_count || 0),
    maxContinuations: MAX_CONTINUATIONS
  };
}

export const STORAGE_CLEANUP_SESSION_TARGETS = TARGETS;
export const STORAGE_CLEANUP_MAX_CONTINUATIONS = MAX_CONTINUATIONS;
