import worker from './worker-aligned-final.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { requireAdmin } from './auth.js';
import { enhanceAppHtmlV064 } from './app-v064-overlay.js';
import { buildAnalysisImportPrompt, recommendedAnalysisFilename } from './analysis-import-prompt.js';
import { ANALYSIS_SUBMISSION_VERSION } from './analysis-exchange.js';
import { getTrackDetailV064, getTrackLaneStatsV064 } from './routes/tracks-v064.js';
import { applyTrackContactEnrichment, listTrackContactTargets } from './track-contact-enrichment.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function requireSession(request, env) {
  if (!appAuthConfigured(env)) return json({ error: 'service_unavailable' }, 503);
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function enhancedAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceAppHtmlV064(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/v1/admin/tracks/contact-targets') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return json(await listTrackContactTargets(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'POST' && path === '/v1/admin/tracks/contact-enrichment') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return json(await applyTrackContactEnrichment(env, await request.json()));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      const provider = url.searchParams.get('provider') || 'ai';
      return json({
        contractVersion: ANALYSIS_SUBMISSION_VERSION,
        recommendedFilename: recommendedAnalysisFilename(provider),
        prompt: buildAnalysisImportPrompt(provider)
      });
    }

    const trackLaneStatsMatch = path.match(/^\/app\/api\/tracks\/([^/]+)\/lane-stats$/);
    if (request.method === 'GET' && trackLaneStatsMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getTrackLaneStatsV064(env, decodeURIComponent(trackLaneStatsMatch[1]), {
          year: url.searchParams.get('year'),
          raceScope: url.searchParams.get('race_scope'),
          startMethod: url.searchParams.get('start_method'),
          distanceGroup: url.searchParams.get('distance_group'),
          stlClass: url.searchParams.get('stl_class'),
          raceType: url.searchParams.get('race_type')
        });
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const trackDetailMatch = path.match(/^\/app\/api\/tracks\/([^/]+)$/);
    if (request.method === 'GET' && trackDetailMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getTrackDetailV064(env, decodeURIComponent(trackDetailMatch[1]));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return enhancedAppResponse(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
