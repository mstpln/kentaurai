import { requireAdmin } from './auth.js';
import { archiveRawPayload } from './raw.js';
import { importEditorial } from './import/editorial.js';
import { importReferenceRound } from './import/reference-round-safe.js';
import { normalizeCapturedOfficialGameSequential } from './import/official-live-sequential.js';
import { captureCalendar, captureGame } from './provider/official.js';
import { getRound } from './routes/rounds.js';
import { createHypothesis } from './routes/learning.js';
import { verifyCapturedOfficialNormalization } from './routes/official-verification.js';
import { getEntityDetail, getEntitySummary, listEntities, searchEntities } from './routes/entities.js';
import { appAuthConfigured, appPasswordMatches, clearAppSessionCookie, createAppSessionCookie, hasValidAppSession } from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage, renderLoginPage } from './app-page.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('content-type must be application/json');
  return request.json();
}

async function handleProviderCapture(env, body) {
  const kind = String(body.kind || '').toLowerCase();
  if (kind === 'calendar') return captureCalendar(env, body.date);
  if (kind === 'game') return captureGame(env, body.game_id);
  throw new Error('kind must be calendar or game');
}

async function handleAppApi(request, env, url) {
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/app/api/summary') {
    return json(await getEntitySummary(env));
  }

  if (request.method === 'GET' && path === '/app/api/search') {
    return json(await searchEntities(env, url.searchParams.get('q'), url.searchParams.get('limit')));
  }

  const detailMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)\/([^/]+)$/);
  if (request.method === 'GET' && detailMatch) {
    const data = await getEntityDetail(env, detailMatch[1], decodeURIComponent(detailMatch[2]));
    return data ? json(data) : json({ error: 'not_found' }, 404);
  }

  const listMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)$/);
  if (request.method === 'GET' && listMatch) {
    return json(await listEntities(env, listMatch[1], {
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }

  return json({ error: 'not_found' }, 404);
}

async function handleApp(request, env, url) {
  const path = url.pathname;
  if (!appAuthConfigured(env)) {
    if (path.startsWith('/app/api/')) return json({ error: 'service_unavailable' }, 503);
    return htmlResponse(renderLoginPage(), 503);
  }

  if (path.startsWith('/app/api/')) return handleAppApi(request, env, url);

  if (request.method === 'GET' && path === '/app/login') {
    if (await hasValidAppSession(request, env)) return redirectResponse('/app');
    return htmlResponse(renderLoginPage({ error: url.searchParams.get('error') === '1' }));
  }

  if (request.method === 'POST' && path === '/app/login') {
    const type = request.headers.get('content-type') || '';
    if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) {
      return htmlResponse(renderLoginPage({ error: true }), 400);
    }
    const form = await request.formData();
    if (!appPasswordMatches(env, form.get('password'))) return redirectResponse('/app/login?error=1');
    return redirectResponse('/app', { 'set-cookie': await createAppSessionCookie(env) });
  }

  if (request.method === 'POST' && path === '/app/logout') {
    return redirectResponse('/app/login', { 'set-cookie': clearAppSessionCookie() });
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
    return json({ ok: true, service: 'kentaurai-api', version: '0.4.2' });
  }

  if (path === '/') return redirectResponse('/app');
  if (path.startsWith('/app')) return handleApp(request, env, url);

  if (path.startsWith('/v1/')) {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
  }

  if (request.method === 'GET' && path.startsWith('/v1/rounds/')) {
    const roundId = decodeURIComponent(path.slice('/v1/rounds/'.length));
    const data = await getRound(env, roundId);
    return data ? json(data) : json({ error: 'not_found' }, 404);
  }

  if (request.method === 'POST' && path === '/v1/provider/capture') {
    return json(await handleProviderCapture(env, await readJson(request)), 201);
  }

  if (request.method === 'POST' && path === '/v1/provider/normalize') {
    const body = await readJson(request);
    return json(await normalizeCapturedOfficialGameSequential(env, body.source_record_id, body.cursor ?? 0));
  }

  if (request.method === 'POST' && path === '/v1/provider/verify-normalization') {
    const body = await readJson(request);
    return json(await verifyCapturedOfficialNormalization(env, body.source_record_id));
  }

  if (request.method === 'POST' && path === '/v1/import/editorial') {
    return json(await importEditorial(env, await readJson(request)), 201);
  }

  if (request.method === 'POST' && path === '/v1/import/reference-round') {
    return json(await importReferenceRound(env, await readJson(request)), 201);
  }

  if (request.method === 'POST' && path === '/v1/import/raw') {
    const body = await readJson(request);
    const fetchedAt = body.fetched_at || new Date().toISOString();
    const result = await archiveRawPayload(env, {
      sourceType: String(body.source_type || 'manual'),
      externalId: body.external_id || null,
      sourceUrl: body.source_url || null,
      fetchedAt,
      payload: body.payload,
      qualityStatus: body.quality_status || 'unknown',
      rightsStatus: body.rights_status || null,
      metadata: body.metadata || null
    });
    return json(result, 201);
  }

  if (request.method === 'POST' && path === '/v1/learning/hypotheses') {
    return json(await createHypothesis(env, await readJson(request)), 201);
  }

  return json({ error: 'not_found' }, 404);
}

async function handleScheduled(controller, env) {
  const now = new Date(controller.scheduledTime || Date.now()).toISOString();
  const id = `cron_${crypto.randomUUID()}`;
  await env.DB.prepare(`
    INSERT INTO import_runs (id, source_type, started_at, finished_at, status, metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, ?, 'success', ?)
  `).bind(id, now, now, JSON.stringify({ cron: controller.cron, phase: '1C_verified_mapper_no_automatic_live_calls' })).run();
}

export default {
  async fetch(request, env) {
    try {
      return await handleFetch(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: 'request_failed', message: error.message }, 400);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  }
};
