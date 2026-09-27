const TARGETS = Object.freeze(['horse_profile','horse_stat','horse_record','person_stat','raw_object']);
const MAX_CONTINUATIONS = 48;
const SESSION_TTL_HOURS = 24;
const MAX_CURSOR_CHARS = 16384;

function assertDb(env) {
  if (!env?.DB) throw new Error('DB is not configured');
}

function assertSha(value) {
  const sha = String(value || '');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('valid source_sha is required');
  return sha;
}

function assertSessionId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('valid cleanup session_id is required');
  return id;
}

function assertTarget(value) {
  const target = String(value || '');
  if (!TARGETS.includes(target)) throw new Error('unsupported cleanup session target');
  return target;
}

function assertCursor(value, complete) {
  if (complete) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_CURSOR_CHARS) {
    throw new Error('incomplete cleanup checkpoint requires a bounded cursor');
  }
  return value;
}

async function loadSession(env, id) {
  return env.DB.prepare(`
    SELECT id,source_sha,mode,status,continuation_count,created_at,updated_at,expires_at
    FROM storage_cleanup_sessions WHERE id=?
  `).bind(id).first();
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
    cursor: row.cursor ?? null,
    complete: Number(row.is_complete || 0) === 1
  }));
}

function sessionExpired(row) {
  return Date.parse(String(row?.expires_at || '')) <= Date.now();
}

export async function startOrResumeStorageCleanupSession(env, options = {}) {
  assertDb(env);
  const sourceSha = assertSha(options.source_sha);
  const requestedId = options.session_id == null || options.session_id === '' ? null : assertSessionId(options.session_id);

  let session;
  if (!requestedId) {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const statements = [
      env.DB.prepare(`
        INSERT INTO storage_cleanup_sessions
          (id,source_sha,mode,status,continuation_count,expires_at)
        VALUES (?,?,'execute','running',1,?)
      `).bind(id, sourceSha, expiresAt)
    ];
    for (const target of TARGETS) {
      statements.push(env.DB.prepare(`
        INSERT INTO storage_cleanup_session_targets(session_id,target,cursor,is_complete)
        VALUES (?,?,NULL,0)
      `).bind(id, target));
    }
    await env.DB.batch(statements);
    session = await loadSession(env, id);
  } else {
    session = await loadSession(env, requestedId);
    if (!session) throw new Error('cleanup session not found');
    if (session.source_sha !== sourceSha) throw new Error('cleanup session source_sha changed; start a new session');
    if (sessionExpired(session)) throw new Error('cleanup session expired; start a new session');
    if (session.status === 'running') {
      if (Number(session.continuation_count || 0) >= MAX_CONTINUATIONS) {
        throw new Error('cleanup session continuation limit reached');
      }
      await env.DB.prepare(`
        UPDATE storage_cleanup_sessions
        SET continuation_count=continuation_count+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='running'
      `).bind(requestedId).run();
      session = await loadSession(env, requestedId);
    }
  }

  return {
    sessionId: session.id,
    sourceSha: session.source_sha,
    status: session.status,
    continuationCount: Number(session.continuation_count || 0),
    expiresAt: session.expires_at,
    targets: await loadTargets(env, session.id)
  };
}

export async function checkpointStorageCleanupSession(env, options = {}) {
  assertDb(env);
  const sessionId = assertSessionId(options.session_id);
  const sourceSha = assertSha(options.source_sha);
  const target = assertTarget(options.target);
  const complete = options.complete === true;
  const cursor = assertCursor(options.cursor, complete);

  const session = await loadSession(env, sessionId);
  if (!session) throw new Error('cleanup session not found');
  if (session.source_sha !== sourceSha) throw new Error('cleanup session source_sha changed; start a new session');
  if (session.status === 'complete') {
    return { sessionId, target, complete: true, sessionComplete: true };
  }
  if (sessionExpired(session)) throw new Error('cleanup session expired; start a new session');

  const result = await env.DB.prepare(`
    UPDATE storage_cleanup_session_targets
    SET cursor=?,is_complete=?,updated_at=CURRENT_TIMESTAMP
    WHERE session_id=? AND target=?
  `).bind(cursor, complete ? 1 : 0, sessionId, target).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new Error('cleanup session target checkpoint failed');

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM storage_cleanup_session_targets
    WHERE session_id=? AND is_complete=0
  `).bind(sessionId).first();
  const sessionComplete = Number(remaining?.n || 0) === 0;
  if (sessionComplete) {
    await env.DB.prepare(`
      UPDATE storage_cleanup_sessions
      SET status='complete',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running'
    `).bind(sessionId).run();
  } else {
    await env.DB.prepare(`
      UPDATE storage_cleanup_sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(sessionId).run();
  }

  return { sessionId, target, complete, sessionComplete };
}

export const STORAGE_CLEANUP_SESSION_TARGETS = TARGETS;
