import worker from './index.js';
import { requireAdmin } from './auth.js';
import {
  getRoundAnalysisSubmission,
  listAnalyzableRounds,
  listRoundAnalysisSubmissions,
  prepareAnalysisContext,
  readAnalysisSubmissionJson,
  submitAnalysis
} from './analysis-api.js';
import { runNextPostRaceReview } from './post-race-review.js';
import { pwaIcon, pwaManifest, pwaServiceWorker } from './pwa.js';

const BACKFILL_CRON = '* * * * *';

function staticResponse(body, contentType) {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function handleAnalysisApi(request, env, url) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  try {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/v1/analysis/rounds') {
      return json(await listAnalyzableRounds(env, { limit: url.searchParams.get('limit') }));
    }

    const contextMatch = path.match(/^\/v1\/analysis\/rounds\/([^/]+)\/context$/);
    if (request.method === 'GET' && contextMatch) {
      const roundId = decodeURIComponent(contextMatch[1]);
      return json(await prepareAnalysisContext(env, roundId, url.searchParams.get('stage') || 'pre_market', {
        preMarketSubmissionId: url.searchParams.get('pre_market_submission_id')
      }));
    }

    const submissionsMatch = path.match(/^\/v1\/analysis\/rounds\/([^/]+)\/submissions$/);
    if (submissionsMatch && request.method === 'GET') {
      return json(await listRoundAnalysisSubmissions(env, decodeURIComponent(submissionsMatch[1])));
    }
    if (submissionsMatch && request.method === 'POST') {
      const payload = await readAnalysisSubmissionJson(request);
      const roundId = decodeURIComponent(submissionsMatch[1]);
      if (String(payload?.round_id ?? payload?.roundId ?? '') !== roundId) throw new Error('round_id must match the round in the request path');
      return json(await submitAnalysis(env, payload), 201);
    }

    const submissionMatch = path.match(/^\/v1\/analysis\/rounds\/([^/]+)\/submissions\/([^/]+)$/);
    if (request.method === 'GET' && submissionMatch) {
      const result = await getRoundAnalysisSubmission(env, decodeURIComponent(submissionMatch[1]), decodeURIComponent(submissionMatch[2]));
      return result ? json(result) : json({ error: 'not_found' }, 404);
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'request_failed', message: error.message }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const path = url.pathname;
      if (path === '/app/manifest.webmanifest') return staticResponse(JSON.stringify(pwaManifest()), 'application/manifest+json; charset=utf-8');
      if (path === '/app/icon.svg') return staticResponse(pwaIcon(), 'image/svg+xml; charset=utf-8');
      if (path === '/app/icon-maskable.svg') return staticResponse(pwaIcon({ maskable: true }), 'image/svg+xml; charset=utf-8');
      if (path === '/app/sw.js') return new Response(pwaServiceWorker(), {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache',
          'service-worker-allowed': '/app/',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    if (url.pathname.startsWith('/v1/analysis/')) return handleAnalysisApi(request, env, url);

    if (request.method === 'POST' && url.pathname === '/v1/post-race/review-next') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return json(await runNextPostRaceReview(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return worker.fetch(request, env);
  },
  async scheduled(controller, env, ctx) {
    worker.scheduled(controller, env, ctx);
    if (controller.cron === BACKFILL_CRON) {
      ctx.waitUntil(runNextPostRaceReview(env).catch((error) => console.error(error)));
    }
  }
};
