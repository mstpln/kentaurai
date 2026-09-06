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
