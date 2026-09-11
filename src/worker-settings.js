import worker from './worker-pwa.js';
import { appAuthConfigured, clearAppSessionCookie, hasValidAppSession } from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage } from './app-page-aligned.js';
import { XLABS_SCRIPT_SELECTOR_VERSION } from './provider/xlabs-script.js';
import { KENTAURAI_APP_VERSION, createFullDataExportResponse, getSettingsStatus, importAnalysisUpload } from './settings-data-display.js';
import { getEnhancedGameHistoryDetail } from './routes/game-detail-display.js';
import { getFilteredEntityStatBreakdowns } from './routes/entity-stat-breakdowns.js';
import { getTrackDetail, getTrackHomeTrainers, getTrackLaneStats, listTracks } from './routes/tracks.js';
import { getHorseDetailStatistics, getHorseFilterOptions, getHorseRankings } from './statistics/horses.js';
import { getTrendFilterOptions, getTrendLeaderboard } from './statistics/trend.js';
import { enhanceHorseStatisticsHtml } from './horse-statistics-ui.js';
import { enhanceTrendHtml } from './trend-ui.js';

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

function canonicalizeAppRedirect(response) {
  if (!response || response.status < 300 || response.status >= 400) return response;
  if (response.headers.get('location') !== '/app') return response;
  const headers = new Headers(response.headers);
  headers.set('location', '/app/');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function horseStatsOptions(url) {
  return {
    period: url.searchParams.get('period'),
    raceScope: url.searchParams.get('race_scope'),
    trackId: url.searchParams.get('track_id'),
    raceType: url.searchParams.get('race_type'),
    breedType: url.searchParams.get('breed_type'),
    startMethod: url.searchParams.get('start_method'),
    distanceGroup: url.searchParams.get('distance_group'),
    sex: url.searchParams.get('sex'),
    age: url.searchParams.get('age'),
    minStarts: url.searchParams.get('min_starts')
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, service: 'kentaurai-api', version: KENTAURAI_APP_VERSION, xlabsScriptSelector: XLABS_SCRIPT_SELECTOR_VERSION });
    }

    if (request.method === 'GET' && path === '/') return redirectResponse('/app/');
    if (request.method === 'GET' && path === '/app') return redirectResponse('/app/');

    if (request.method === 'GET' && path === '/app/') {
      if (appAuthConfigured(env) && await hasValidAppSession(request, env)) {
        return htmlResponse(enhanceHorseStatisticsHtml(enhanceTrendHtml(renderAppPage())));
      }
      return canonicalizeAppRedirect(await worker.fetch(request, env));
    }

    if (request.method === 'POST' && path === '/app/logout') {
      return redirectResponse('/app/login', { 'set-cookie': clearAppSessionCookie() });
    }

    if (path === '/app/api/settings/status' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getSettingsStatus(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/export' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return await createFullDataExportResponse(env, url.searchParams.get('provider') || 'openai');
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/import-analysis' && request.method === 'POST') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await importAnalysisUpload(env, request), 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/trend/filter-options' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getTrendFilterOptions(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/trend' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getTrendLeaderboard(env, {
          category: url.searchParams.get('category'),
          period: url.searchParams.get('period'),
          raceScope: url.searchParams.get('race_scope'),
          trackId: url.searchParams.get('track_id'),
          raceType: url.searchParams.get('race_type'),
          breedType: url.searchParams.get('breed_type'),
          startMethod: url.searchParams.get('start_method'),
          minStarts: url.searchParams.get('min_starts')
        }));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/horses/statistics/filter-options' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getHorseFilterOptions(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/horses/statistics' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getHorseRankings(env, horseStatsOptions(url)));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const horseStatisticsMatch = path.match(/^\/app\/api\/horses\/([^/]+)\/statistics$/);
    if (request.method === 'GET' && horseStatisticsMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getHorseDetailStatistics(env, decodeURIComponent(horseStatisticsMatch[1]), horseStatsOptions(url));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/tracks' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await listTracks(env, {
          q: url.searchParams.get('q'),
          limit: url.searchParams.get('limit'),
          offset: url.searchParams.get('offset')
        }));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const trackHomeTrainerMatch = path.match(/^\/app\/api\/tracks\/([^/]+)\/home-trainers$/);
    if (request.method === 'GET' && trackHomeTrainerMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getTrackHomeTrainers(env, decodeURIComponent(trackHomeTrainerMatch[1]), {
          limit: url.searchParams.get('limit'),
          offset: url.searchParams.get('offset')
        });
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const trackLaneStatsMatch = path.match(/^\/app\/api\/tracks\/([^/]+)\/lane-stats$/);
    if (request.method === 'GET' && trackLaneStatsMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getTrackLaneStats(env, decodeURIComponent(trackLaneStatsMatch[1]), {
          year: url.searchParams.get('year'),
          startMethod: url.searchParams.get('start_method'),
          distanceGroup: url.searchParams.get('distance_group')
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
        const data = await getTrackDetail(env, decodeURIComponent(trackDetailMatch[1]));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const statBreakdownMatch = path.match(/^\/app\/api\/entities\/(horses|trainers|drivers)\/([^/]+)\/stat-breakdowns$/);
    if (request.method === 'GET' && statBreakdownMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getFilteredEntityStatBreakdowns(env, statBreakdownMatch[1], decodeURIComponent(statBreakdownMatch[2]), {
          year: url.searchParams.get('year'),
          raceScope: url.searchParams.get('race_scope'),
          distanceStartMethod: url.searchParams.get('distance_start_method'),
          trackStartMethod: url.searchParams.get('track_start_method')
        });
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const gameDetailMatch = path.match(/^\/app\/api\/games\/([^/]+)$/);
    if (request.method === 'GET' && gameDetailMatch && gameDetailMatch[1] !== 'summary') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getEnhancedGameHistoryDetail(env, decodeURIComponent(gameDetailMatch[1]));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return canonicalizeAppRedirect(await worker.fetch(request, env));
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};