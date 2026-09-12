import worker from './worker-v064.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { getHorseFilterOptions } from './statistics/horses-complete.js';
import {
  getDriverCalendarYearDetailStatistics,
  getHorseCalendarYearDetailStatistics,
  getTrainerCalendarYearDetailStatistics
} from './entity-detail-calendar-statistics.js';
import { enhanceEntityDetailStatisticsHtml } from './entity-detail-statistics-ui.js';

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

function calendarOptions(url) {
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

async function enhancedAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceEntityDetailStatisticsHtml(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

const calendarHandlers = {
  trainers: getTrainerCalendarYearDetailStatistics,
  drivers: getDriverCalendarYearDetailStatistics,
  horses: getHorseCalendarYearDetailStatistics
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/app/api/horses/statistics/filter-options') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try { return json(await getHorseFilterOptions(env)); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    const calendarMatch = path.match(/^\/app\/api\/(trainers|drivers|horses)\/([^/]+)\/calendar-statistics$/);
    if (request.method === 'GET' && calendarMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const entityType = calendarMatch[1];
        const data = await calendarHandlers[entityType](env, decodeURIComponent(calendarMatch[2]), calendarOptions(url));
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
