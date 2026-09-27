function jsonError(error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return jsonError('service_unavailable', 503);
  const auth = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (auth !== expected) return jsonError('unauthorized', 401);
  return null;
}


const CLEANUP_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;

function temporaryCleanupTokenIsFresh(value) {
  const [issuedAt, randomPart, extra] = String(value || '').split('.');
  const issuedAtMs = Number(issuedAt);
  return !extra
    && Number.isFinite(issuedAtMs)
    && randomPart?.length >= 32
    && issuedAtMs <= Date.now()
    && (Date.now() - issuedAtMs) <= CLEANUP_TOKEN_MAX_AGE_MS;
}

export function requireStorageCleanupAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (env?.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return null;
  if (
    env?.STORAGE_CLEANUP_TOKEN
    && temporaryCleanupTokenIsFresh(env.STORAGE_CLEANUP_TOKEN)
    && auth === `Bearer ${env.STORAGE_CLEANUP_TOKEN}`
  ) return null;
  if (!env?.ADMIN_TOKEN && !env?.STORAGE_CLEANUP_TOKEN) return jsonError('service_unavailable', 503);
  return jsonError('unauthorized', 401);
}
