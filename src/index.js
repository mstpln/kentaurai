import { requireAdmin } from './auth.js';
import { archiveRawPayload } from './raw.js';
import { importEditorial } from './import/editorial.js';
import { importReferenceRound } from './import/reference-round-safe.js';
import { normalizeCapturedOfficialGameSequential } from './import/official-live-sequential.js';
import { captureUpcomingOfficialGames, normalizeNextPendingOfficialGame } from './import/official-live-scheduled.js';
import { normalizeCapturedXlabsRace } from './import/xlabs-telemetry.js';
import { normalizeCapturedOfficialRace } from './import/official-historical-race.js';
import { getHistoricalBackfill, runHistoricalBackfillStep, startHistoricalBackfill } from './import/official-historical-backfill.js';
import { ensureDailyXlabsJob, getXlabsBackfill, runXlabsBackfillStep, startXlabsBackfill } from './import/xlabs-backfill.js';
import { captureCalendar, captureGame, captureRace } from './provider/official.js';
import { captureXlabsDate } from './provider/xlabs.js';
import { captureXlabsRaceJson } from './provider/xlabs-race.js';
import { captureReferencedXlabsScript, captureXlabsContextScripts, XLABS_SCRIPT_SELECTOR_VERSION } from './provider/xlabs-script.js';
import { getRound } from './routes/rounds.js';
import { createHypothesis } from './routes/learning.js';
import { verifyCapturedOfficialNormalization } from './routes/official-verification.js';
import { verifyCapturedXlabsNormalization } from './routes/xlabs-verification.js';
import { inspectCapturedXlabs } from './routes/xlabs-inspection.js';
import { inspectCapturedXlabsScript } from './routes/xlabs-script-inspection.js';
import { resolveCapturedXlabsRequestPath } from './routes/xlabs-path-resolution.js';
import { getEntityDetail, getEntitySummary, listEntities, searchEntities } from './routes/entities.js';
import { getEntityStartHistory } from './routes/entity-history.js';
import { getLinkedHorses } from './routes/entity-links.js';
import { toEntityAppView } from './routes/entity-view.js';
import { getGameHistoryDetail, listGameHistory } from './routes/games.js';
import { getGameHistorySummary } from './routes/game-summary.js';
import { appAuthConfigured, appPasswordMatches, createAppSessionCookie, hasValidAppSession } from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage, renderLoginPage } from './app-page-history.js';
import { renderReferenceImportPage } from './app-reference-import.js';

const BACKFILL_CRON = '* * * * *';
const LIVE_MORNING_CRON = '15 5 * * *';
const LIVE_EVENING_CRON = '15 17 * * *';
const XLABS_DAILY_CRON = '30 4 * * *';
const MAX_REFERENCE_IMPORT_BYTES = 1024 * 1024;

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

async function readJsonLimited(request, maxBytes) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('content-type must be application/json');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('reference round payload exceeds 1 MB limit');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('reference round payload exceeds 1 MB limit');
  return JSON.parse(text);
}

async function handleProviderCapture(env, body) {
  const kind = String(body.kind || '').toLowerCase();
  if (kind === 'calendar') return captureCalendar(env, body.date);
  if (kind === 'game') return captureGame(env, body.game_id);
  if (kind === 'race') return captureRace(env, body.race_id);
  throw new Error('kind must be calendar, game or race');
}

async function handleAppApi(request, env, url) {
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const path = url.pathname;

  if (request.method === 'POST' && path === '/app/api/import/reference-round') {
    const payload = await readJsonLimited(request, MAX_REFERENCE_IMPORT_BYTES);
    return json(await importReferenceRound(env, payload), 201);
  }
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
  if (request.method === 'GET' && path === '/app/import/reference-round') {
    if (!(await hasValidAppSession(request, env))) return redirectResponse('/app/login');
    return htmlResponse(renderReferenceImportPage());
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
  if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'kentaurai-api', version: '0.5.0', xlabsScriptSelector: XLABS_SCRIPT_SELECTOR_VERSION });
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
  if (request.method === 'POST' && path === '/v1/live/capture') {
    const body = await readJson(request);
    return json(await captureUpcomingOfficialGames(env, body.scheduled_at ?? Date.now(), {
      includeToday: body.include_today !== false,
      daysAhead: body.days_ahead
    }), 201);
  }
  if (request.method === 'POST' && path === '/v1/live/normalize-next') {
    return json(await normalizeNextPendingOfficialGame(env));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/capture') {
    const body = await readJson(request);
    return json(await captureXlabsDate(env, body.date), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/capture-race-json') {
    const body = await readJson(request);
    return json(await captureXlabsRaceJson(env, body.source_record_id, body.track_id, body.race_number), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/capture-script') {
    const body = await readJson(request);
    return json(await captureReferencedXlabsScript(env, body.source_record_id, body.script_name), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/capture-context') {
    const body = await readJson(request);
    return json(await captureXlabsContextScripts(env, body.source_record_id), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/inspect') {
    const body = await readJson(request);
    return json(await inspectCapturedXlabs(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/inspect-script') {
    const body = await readJson(request);
    return json(await inspectCapturedXlabsScript(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/resolve-request-path') {
    const body = await readJson(request);
    return json(await resolveCapturedXlabsRequestPath(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/normalize') {
    const body = await readJson(request);
    return json(await normalizeCapturedXlabsRace(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/verify-normalization') {
    const body = await readJson(request);
    return json(await verifyCapturedXlabsNormalization(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/xlabs/backfill/start') {
    const body = await readJson(request);
    return json(await startXlabsBackfill(env, body.start_date, body.end_date, { resume: body.resume === true }), 201);
  }
  if (request.method === 'POST' && path === '/v1/xlabs/backfill/step') {
    const body = await readJson(request);
    return json(await runXlabsBackfillStep(env, body.job_id));
  }
  if (request.method === 'GET' && path === '/v1/xlabs/backfill/status') {
    return json(await getXlabsBackfill(env, url.searchParams.get('job_id')));
  }
  if (request.method === 'POST' && path === '/v1/provider/normalize') {
    const body = await readJson(request);
    return json(await normalizeCapturedOfficialGameSequential(env, body.source_record_id, body.cursor ?? 0));
  }
  if (request.method === 'POST' && path === '/v1/provider/normalize-race') {
    const body = await readJson(request);
    return json(await normalizeCapturedOfficialRace(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/provider/verify-normalization') {
    const body = await readJson(request);
    return json(await verifyCapturedOfficialNormalization(env, body.source_record_id));
  }
  if (request.method === 'POST' && path === '/v1/historical/backfill/start') {
    const body = await readJson(request);
    return json(await startHistoricalBackfill(env, body.start_date, body.end_date, { resume: body.resume === true }), 201);
  }
  if (request.method === 'POST' && path === '/v1/historical/backfill/step') {
    const body = await readJson(request);
    return json(await runHistoricalBackfillStep(env, body.job_id));
  }
  if (request.method === 'GET' && path === '/v1/historical/backfill/status') {
    return json(await getHistoricalBackfill(env, url.searchParams.get('job_id')));
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

async function runScheduledPart(name, fn) {
  try {
    return { name, ok: true, result: await fn() };
  } catch (error) {
    console.error(error);
    return { name, ok: false, error: String(error.message).slice(0, 1000) };
  }
}

async function handleScheduled(controller, env) {
  const scheduledAt = new Date(controller.scheduledTime || Date.now()).toISOString();
  const startedAt = new Date().toISOString();
  const id = `cron_${crypto.randomUUID()}`;
  const parts = [];

  if (controller.cron === BACKFILL_CRON) {
    parts.push(await runScheduledPart('historical_backfill', () => runHistoricalBackfillStep(env)));
    parts.push(await runScheduledPart('xlabs_backfill', () => runXlabsBackfillStep(env)));
    parts.push(await runScheduledPart('live_normalize', () => normalizeNextPendingOfficialGame(env)));
  } else if (controller.cron === LIVE_MORNING_CRON) {
    parts.push(await runScheduledPart('live_capture_morning', () => captureUpcomingOfficialGames(env, controller.scheduledTime, { includeToday: true })));
  } else if (controller.cron === LIVE_EVENING_CRON) {
    parts.push(await runScheduledPart('live_capture_evening', () => captureUpcomingOfficialGames(env, controller.scheduledTime, { includeToday: false })));
  } else if (controller.cron === XLABS_DAILY_CRON) {
    parts.push(await runScheduledPart('xlabs_daily_job', () => ensureDailyXlabsJob(env, controller.scheduledTime)));
  } else {
    parts.push({ name: 'unknown_cron', ok: false, error: `unsupported cron ${controller.cron}` });
  }

  const failures = parts.filter((part) => !part.ok);
  await env.DB.prepare(`
    INSERT INTO import_runs
      (id, source_type, started_at, finished_at, status, error_count, error_json, metadata_json)
    VALUES (?, 'scheduled_orchestrator', ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    startedAt,
    new Date().toISOString(),
    failures.length ? 'failed' : 'success',
    failures.length,
    failures.length ? JSON.stringify(failures.map(({ name, error }) => ({ name, error }))) : null,
    JSON.stringify({ cron: controller.cron, scheduledAt, parts })
  ).run();
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
