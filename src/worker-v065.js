import worker from './worker-v064.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { getTrainerCalendarYearDetailStatistics } from './trainer-detail-statistics.js';
import { enhanceTrainerDetailStatisticsHtml } from './trainer-detail-statistics-ui.js';

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

function detailOptions(url) {
  return {
    year: url.searchParams.get('year'),
    raceScope: url.searchParams.get('race_scope'),
    trackId: url.searchParams.get('track_id'),
    raceType: url.searchParams.get('race_type'),
    breedType: url.searchParams.get('breed_type'),
    sex: url.searchParams.get('sex'),
    age: url.searchParams.get('age'),
    startMethod: url.searchParams.get('start_method'),
    distanceGroup: url.searchParams.get('distance_group'),
    voltLane: url.searchParams.get('volt_lane'),
    handicapM: url.searchParams.get('handicap_m')
  };
}

async function enhanceAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceTrainerDetailStatisticsHtml(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/app\/api\/trainers\/([^/]+)\/calendar-statistics$/);
    if (request.method === 'GET' && match) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getTrainerCalendarYearDetailStatistics(env, decodeURIComponent(match[1]), detailOptions(url));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }
    return enhanceAppResponse(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
