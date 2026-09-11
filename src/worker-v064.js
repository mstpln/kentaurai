import worker from './worker-aligned-final.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { getEnhancedTrackDetail, getEnhancedTrackLaneStats } from './routes/track-enhancements.js';
import { buildAnalysisImportInstructions, ANALYSIS_IMPORT_INSTRUCTIONS_VERSION } from './analysis-import-instructions.js';
import { v064Css, v064Script } from './ui-v064.js';

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

async function enhanceHtml(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(
    body.replace('</head>', `${v064Css}</head>`).replace('</body>', `${v064Script}</body>`),
    { status: response.status, statusText: response.statusText, headers }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/app/api/settings/analysis-import-instructions') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      return json({
        version: ANALYSIS_IMPORT_INSTRUCTIONS_VERSION,
        contractVersion: 'kentaurai-analysis-v1',
        prompt: buildAnalysisImportInstructions()
      });
    }

    const laneMatch = path.match(/^\/app\/api\/tracks\/([^/]+)\/lane-stats$/);
    if (request.method === 'GET' && laneMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getEnhancedTrackLaneStats(env, decodeURIComponent(laneMatch[1]), {
          year: url.searchParams.get('year'),
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

    const detailMatch = path.match(/^\/app\/api\/tracks\/([^/]+)$/);
    if (request.method === 'GET' && detailMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getEnhancedTrackDetail(env, decodeURIComponent(detailMatch[1]));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return enhanceHtml(request, await worker.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
