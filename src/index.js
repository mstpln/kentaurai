import { requireAdmin } from './auth.js';
import { archiveRawPayload } from './raw.js';
import { importEditorial } from './import/editorial.js';
import { importReferenceRound } from './import/reference-round-safe.js';
import { normalizeCapturedOfficialGameSequential } from './import/official-live-sequential.js';
import { captureCalendar, captureGame } from './provider/official.js';
import { captureXlabsDate } from './provider/xlabs.js';
import { captureReferencedXlabsScript, XLABS_SCRIPT_SELECTOR_VERSION } from './provider/xlabs-script.js';
import { getRound } from './routes/rounds.js';
import { createHypothesis } from './routes/learning.js';
import { verifyCapturedOfficialNormalization } from './routes/official-verification.js';
import { inspectCapturedXlabs } from './routes/xlabs-inspection.js';
import { inspectCapturedXlabsScript } from './routes/xlabs-script-inspection.js';
import { getEntityDetail, getEntitySummary, listEntities, searchEntities } from './routes/entities.js';
import { getEntityStartHistory } from './routes/entity-history.js';
import { getLinkedHorses } from './routes/entity-links.js';
import { toEntityAppView } from './routes/entity-view.js';
import { getGameHistoryDetail, listGameHistory } from './routes/games.js';
import { getGameHistorySummary } from './routes/game-summary.js';
import { appAuthConfigured, appPasswordMatches, createAppSessionCookie, hasValidAppSession } from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage, renderLoginPage } from './app-page-history.js';

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

  if (request.method === 'GET' && path === '/app/api/summary') return json(await getEntitySummary(env));
  if (request.method === 'GET' && path === '/app/api/search') return json(await searchEntities(env, url.searchParams.get('q'), url.searchParams.get('limit')));
  if (request.method === 'GET' && path === '/app/api/games/summary') return json(await getGameHistorySummary(env));
  if (request.method === 'GET' && path === '/app/api/games') {
    return json(await listGameHistory(env, {
      gameType: url.searchParams.get('type'),
      sort: url.searchParams.get('sort'),
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }

  const gameDetailMatch = path.match(/^\/app\/api\/games\/([^/]+)$/);
  if (request.method === 'GET' && gameDetailMatch) {
    const data = await getGameHistoryDetail(env, decodeURIComponent(gameDetailMatch[1]));
    return data ? json(data) : json({ error: 'not_found' }, 404);
  }

  const historyMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)\/([^/]+)\/starts$/);
  if (request.method === 'GET' && historyMatch) {
    return json(await getEntityStartHistory(env, historyMatch[1], decodeURIComponent(historyMatch[2]), {
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }

  const linkedHorsesMatch = path.match(/^\/app\/api\/entities\/(trainers|drivers)\/([^/]+)\/horses$/);
  if (request.method === 'GET' && linkedHorsesMatch) {
    return json(await getLinkedHorses(env, linkedHorsesMatch[1], decodeURIComponent(linkedHorsesMatch[2]), {
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }

  const detailMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)\/([^/]+)$/);
  if (request.method === 'GET' && detailMatch) {
    const data = await getEntityDetail(env, detailMatch[1], decodeURIComponent(detailMatch[2]));
    return data ? json(toEntityAppView(data)) : json({ error: 'not_found' }, 404);
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
    if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) return htmlResponse(renderLoginPage({ error: true }), 400);
    const form = await request.formData();
    if (!appPasswordMatches(env, form.get('password'))) return redirectResponse('/app/login?error=1');
    return redirectResponse('/app', { 'set-cookie': await createAppSessionCookie(env) });
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
  if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'kentaurai-api', version: '0.4.5', xlabsScriptSelector: XLABS_SCRIPT_SELECTOR_VERSION });
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
  if (request.method === 'POST' && path === '/v1/provider/capture') return json(await handleProviderCapture(env, await readJson(request)), 201);
  if (request.method === 'POST' && path === '/v1/xlabs/capture') {
    const body = await readJson(request);
    return json(await captureXlabsDate(env, body.date), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/capture-script') {
    const body = await readJson(request);
    return json(await captureReferencedXlabsScript(env, body.source_record_id, body.script_name), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/inspect') {
    const body = await readJson(request);
    return json(await inspectCapturedXlabs(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/inspect-script') {
    const body = await readJson(request);
    return json(await inspectCapturedXlabsScript(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/provider/normalize') {
    const body = await readJson(request);
    return json(await normalizeCapturedOfficialGameSequential(env, body.source_record_id, body.cursor ?? 0));
  }
  if (request.method === 'POST' && path === '/v1/provider/verify-normalization') {
    const body = await readJson(request);
    return json(await verifyCapturedOfficialNormalization(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/import/editorial') return json(await importEditorial(env, await readJson(request)), 201);
  if (request.method === 'POST' && path === '/v1/import/reference-round') return json(await importReferenceRound(env, await readJson(request)), 201);
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
  if (request.method === 'POST' && path === '/v1/learning/hypotheses') return json(await createHypothesis(env, await readJson(request)), 201);
  return json({ error: 'not_found' }, 404);
}

async function handleScheduled(controller, env) {
  const now = new Date(controller.scheduledTime || Date.now()).toISOString();
  const id = `cron_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO import_runs (id, source_type, started_at, finished_at, status, metadata_json) VALUES (?, 'scheduled_orchestrator', ?, ?, 'success', ?)`)
    .bind(id, now, now, JSON.stringify({ cron: controller.cron, phase: '1C_verified_mapper_no_automatic_live_calls' })).run();
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
