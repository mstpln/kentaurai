import { captureCalendarDay, captureGameById } from './routes/capture.js';
import { importReferenceRound } from './routes/reference-import.js';
import { normalizeOfficialGame } from './routes/normalize-official-game.js';
import { verifyNormalizedOfficialGame } from './routes/verify-normalized-game.js';
import { importEditorialSignals } from './routes/editorial-import.js';
import {
  getEntityDetail,
  getInterfaceSummary,
  listEntities,
  searchEntities
} from './routes/entities.js';
import {
  createAppSessionCookie,
  hasValidAppSession,
  isCorrectAppPassword,
  makeExpiredAppSessionCookie,
  parseFormBody
} from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage, renderLoginPage, safeReturnPath } from './app-page.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function requireAdmin(request, env) {
  const configured = env.ADMIN_TOKEN;
  if (!configured) return json({ error: 'admin_token_not_configured' }, 503);

  const authorization = request.headers.get('authorization') || '';
  const expected = `Bearer ${configured}`;
  if (authorization !== expected) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function handleApp(request, env, url) {
  const path = url.pathname;

  if (request.method === 'GET' && path === '/app/login') {
    if (await hasValidAppSession(request, env)) return redirectResponse('/app');
    return htmlResponse(renderLoginPage({ error: url.searchParams.get('error') === '1' }));
  }

  if (request.method === 'POST' && path === '/app/login') {
    const form = await parseFormBody(request);
    const password = form.get('password');
    const returnTo = safeReturnPath(form.get('return_to'));
    if (!isCorrectAppPassword(password, env)) return redirectResponse('/app/login?error=1');
    const cookie = await createAppSessionCookie(env);
    return redirectResponse(returnTo, { 'set-cookie': cookie });
  }

  if (request.method === 'POST' && path === '/app/logout') {
    return redirectResponse('/app/login', { 'set-cookie': makeExpiredAppSessionCookie() });
  }

  if (path.startsWith('/app/api/')) {
    if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    if (path === '/app/api/summary') return json(await getInterfaceSummary(env));
    if (path === '/app/api/search') return json(await searchEntities(env, url.searchParams.get('q') || ''));

    const listMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)$/);
    if (listMatch) {
      return json(await listEntities(env, listMatch[1], {
        q: url.searchParams.get('q') || '',
        limit: url.searchParams.get('limit'),
        offset: url.searchParams.get('offset')
      }));
    }

    const detailMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)\/([^/]+)$/);
    if (detailMatch) return json(await getEntityDetail(env, detailMatch[1], decodeURIComponent(detailMatch[2])));

    return json({ error: 'not_found' }, 404);
  }

  if (request.method === 'GET' && (path === '/app' || path === '/app/')) {
    if (!(await hasValidAppSession(request, env))) return redirectResponse('/app/login');
    return htmlResponse(renderAppPage());
  }

  return json({ error: 'not_found' }, 404);
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/health') {
    return json({ ok: true, service: 'kentaurai-api', version: '0.4.3' });
  }

  if (path === '/') return redirectResponse('/app');
  if (path.startsWith('/app')) return handleApp(request, env, url);

  if (path.startsWith('/v1/')) {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
  }

  if (request.method === 'POST' && path === '/v1/capture/calendar-day') {
    return captureCalendarDay(request, env);
  }

  if (request.method === 'POST' && path === '/v1/capture/game') {
    return captureGameById(request, env);
  }

  if (request.method === 'POST' && path === '/v1/import/reference') {
    return importReferenceRound(request, env);
  }

  if (request.method === 'POST' && path === '/v1/import/editorial-signals') {
    return importEditorialSignals(request, env);
  }

  if (request.method === 'POST' && path === '/v1/normalize/official-game') {
    return normalizeOfficialGame(request, env);
  }

  if (request.method === 'POST' && path === '/v1/verify/official-game') {
    return verifyNormalizedOfficialGame(request, env);
  }

  if (request.method === 'GET' && path.startsWith('/v1/rounds/')) {
    return json({ error: 'not_found' }, 404);
  }

  return json({ error: 'not_found' }, 404);
}

async function scheduled(_event, env, ctx) {
  ctx.waitUntil(
    Promise.resolve().then(() => console.log(JSON.stringify({
      event: 'scheduled_readiness',
      automatic_live_acquisition: false,
      timestamp: new Date().toISOString()
    })))
  );
}

export default { fetch: handleFetch, scheduled };
export { handleFetch, json, requireAdmin };
