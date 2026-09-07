import { requireAdmin } from './auth.js';
import { archiveRawPayload } from './raw.js';
import { importEditorial } from './import/editorial.js';
import { importReferenceRound } from './import/reference-round-safe.js';
import { captureCalendar, captureGame, captureProduct } from './provider/official.js';
import { getRound } from './routes/rounds.js';
import { createHypothesis } from './routes/learning.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
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
  if (kind === 'product') return captureProduct(env, body.game_type);
  if (kind === 'game') return captureGame(env, body.game_id);
  throw new Error('kind must be calendar, product or game');
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/health') {
    return json({ ok: true, service: 'kentaurai-api', version: '0.2.0' });
  }

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
  // Phase 1B records scheduler health only. Live collection remains disabled until a real response is validated.
  const now = new Date(controller.scheduledTime || Date.now()).toISOString();
  const id = `cron_${crypto.randomUUID()}`;
  await env.DB.prepare(`
    INSERT INTO import_runs (id, source_type, started_at, finished_at, status, metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, ?, 'success', ?)
  `).bind(id, now, now, JSON.stringify({ cron: controller.cron, phase: '1B_capture_ready_no_automatic_live_calls' })).run();
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
