import worker from './worker-aligned-final.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { requireAdmin } from './auth.js';
import { enhanceAppHtmlV064 } from './app-v064-overlay.js';
import { enhanceDriverStatisticsHtml } from './driver-statistics-ui.js';
import { enhanceTrainerStatisticsHtml } from './trainer-statistics-ui.js';
import { enhanceHorsePatternsHtml } from './horse-patterns-ui.js';
import { enhanceMobileLayoutPolish } from './mobile-layout-polish.js';
import { buildCombinedAnalysisImportPrompt, recommendedCombinedFilename } from './analysis-import-prompt-v2.js';
import {
  ANALYSIS_COMBINED_VERSION,
  createWorkflowDataExportResponse,
  getAnalysisMethodPrompt,
  getCombinedPromptContext,
  listAnalysisRounds
} from './analysis-workflow-v2.js';
import { importStrictCombinedAnalysisUpload } from './analysis-workflow-v2-strict.js';
import { getTrackDetailV064, getTrackLaneStatsV064 } from './routes/tracks-v064.js';
import { applyTrackContactEnrichment, listTrackContactTargets } from './track-contact-enrichment.js';
import { syncOnePendingHorseStartPointSource } from './import/official-start-points.js';
import { getHorseDetailStatistics, getHorseRankings } from './statistics/horses-complete.js';
import { getDriverDetailStatistics, getDriverFilterOptions, getDriverRankings } from './statistics/drivers.js';
import { getTrainerDetailStatistics, getTrainerFilterOptions, getTrainerRankings } from './statistics/trainers.js';

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
  const body = enhanceMobileLayoutPolish(
    enhanceHorsePatternsHtml(
      enhanceTrainerStatisticsHtml(
        enhanceDriverStatisticsHtml(
          enhanceAppHtmlV064(await response.text())
        )
      )
    )
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function horseStatsOptions(url) {
  return {
    period: url.searchParams.get('period'), raceScope: url.searchParams.get('race_scope'), trackId: url.searchParams.get('track_id'),
    raceType: url.searchParams.get('race_type'), breedType: url.searchParams.get('breed_type'), startMethod: url.searchParams.get('start_method'),
    distanceGroup: url.searchParams.get('distance_group'), sex: url.searchParams.get('sex'), age: url.searchParams.get('age'), minStarts: url.searchParams.get('min_starts')
  };
}

function personStatsOptions(url) {
  return {
    period: url.searchParams.get('period'), raceScope: url.searchParams.get('race_scope'), trackId: url.searchParams.get('track_id'),
    raceType: url.searchParams.get('race_type'), breedType: url.searchParams.get('breed_type'), startMethod: url.searchParams.get('start_method'),
    distanceGroup: url.searchParams.get('distance_group'), sex: url.searchParams.get('sex'), age: url.searchParams.get('age'),
    voltLane: url.searchParams.get('volt_lane'), handicapM: url.searchParams.get('handicap_m'), minStarts: url.searchParams.get('min_starts')
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/v1/admin/tracks/contact-targets') {
      const denied = requireAdmin(request, env); if (denied) return denied;
      try { return json(await listTrackContactTargets(env)); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'POST' && path === '/v1/admin/tracks/contact-enrichment') {
      const denied = requireAdmin(request, env); if (denied) return denied;
      try { return json(await applyTrackContactEnrichment(env, await request.json())); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-rounds') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json({ rounds: await listAnalysisRounds(env) }); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/settings/export') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try {
        return await createWorkflowDataExportResponse(
          env,
          url.searchParams.get('provider') || 'openai',
          url.searchParams.get('stage') || 'pre_market',
          url.searchParams.get('round_id')
        );
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-method-prompt') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try {
        const step = url.searchParams.get('step');
        return json({ step, prompt: getAnalysisMethodPrompt(step) });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-prompt') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        const promptContext = await getCombinedPromptContext(env, provider, url.searchParams.get('round_id'));
        if (!promptContext) return json({ error: 'no_analyzable_round', message: 'Ingen V85/V86-omgång med komplett analyscontext hittades.' }, 404);
        return json({
          contractVersion: ANALYSIS_COMBINED_VERSION,
          stage: 'combined',
          roundId: promptContext.round_id,
          importTiming: promptContext.import_timing,
          learningEligibility: promptContext.learning_eligibility,
          recommendedFilename: recommendedCombinedFilename(provider),
          prompt: buildCombinedAnalysisImportPrompt(provider, promptContext)
        });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'POST' && path === '/app/api/settings/import-analysis') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await importStrictCombinedAnalysisUpload(env, request), 201); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/horses/statistics') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await getHorseRankings(env, horseStatsOptions(url))); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }
    const horseStatisticsMatch = path.match(/^\/app\/api\/horses\/([^/]+)\/statistics$/);
    if (request.method === 'GET' && horseStatisticsMatch) {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { const data = await getHorseDetailStatistics(env, decodeURIComponent(horseStatisticsMatch[1]), horseStatsOptions(url)); return data ? json(data) : json({ error: 'not_found' }, 404); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/drivers/statistics/filter-options') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await getDriverFilterOptions(env)); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }
    if (request.method === 'GET' && path === '/app/api/drivers/statistics') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await getDriverRankings(env, personStatsOptions(url))); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }
    const driverStatisticsMatch = path.match(/^\/app\/api\/drivers\/([^/]+)\/statistics$/);
    if (request.method === 'GET' && driverStatisticsMatch) {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { const data = await getDriverDetailStatistics(env, decodeURIComponent(driverStatisticsMatch[1]), personStatsOptions(url)); return data ? json(data) : json({ error: 'not_found' }, 404); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/trainers/statistics/filter-options') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await getTrainerFilterOptions(env)); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }
    if (request.method === 'GET' && path === '/app/api/trainers/statistics') {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { return json(await getTrainerRankings(env, personStatsOptions(url))); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }
    const trainerStatisticsMatch = path.match(/^\/app\/api\/trainers\/([^/]+)\/statistics$/);
    if (request.method === 'GET' && trainerStatisticsMatch) {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { const data = await getTrainerDetailStatistics(env, decodeURIComponent(trainerStatisticsMatch[1]), personStatsOptions(url)); return data ? json(data) : json({ error: 'not_found' }, 404); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    const trackLaneStatsMatch = path.match(/^\/app\/api\/tracks\/([^/]+)\/lane-stats$/);
    if (request.method === 'GET' && trackLaneStatsMatch) {
      const denied = await requireSession(request, env); if (denied) return denied;
      try {
        const data = await getTrackLaneStatsV064(env, decodeURIComponent(trackLaneStatsMatch[1]), {
          year: url.searchParams.get('year'), raceScope: url.searchParams.get('race_scope'), startMethod: url.searchParams.get('start_method'),
          distanceGroup: url.searchParams.get('distance_group'), stlClass: url.searchParams.get('stl_class'), raceType: url.searchParams.get('race_type')
        });
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    const trackDetailMatch = path.match(/^\/app\/api\/tracks\/([^/]+)$/);
    if (request.method === 'GET' && trackDetailMatch) {
      const denied = await requireSession(request, env); if (denied) return denied;
      try { const data = await getTrackDetailV064(env, decodeURIComponent(trackDetailMatch[1])); return data ? json(data) : json({ error: 'not_found' }, 404); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    return enhancedAppResponse(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    const result = await worker.scheduled(controller, env, ctx);
    const startPointSync = syncOnePendingHorseStartPointSource(env);
    if (ctx?.waitUntil) ctx.waitUntil(startPointSync); else await startPointSync;
    return result;
  }
};
