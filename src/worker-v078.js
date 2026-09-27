import worker from './worker-v077.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  getUpcomingEntryFacts,
  getUpcomingGameLeg,
  getUpcomingGameRound,
  getUpcomingLegHorseForms,
  listUpcomingGames
} from './routes/upcoming-games.js';
import { enhanceUpcomingGamesHtml } from './app-upcoming-games-ui.js';
import { getGameStatistics } from './routes/game-statistics.js';
import {
  automaticWorkflowGate,
  getAutomationControl,
  nextAutomaticRunAt,
  setAutomationControl
} from './automation-control.js';
import { getCloudflareUsageOverview } from './cloudflare-usage.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff'
    }
  });
}

async function requireSession(request, env) {
  if (!appAuthConfigured(env)) return json({ error:'service_unavailable' }, 503);
  if (!(await hasValidAppSession(request, env))) return json({ error:'unauthorized' }, 401);
  return null;
}

async function enhanceApp(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(enhanceUpcomingGamesHtml(await response.text()), {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/app/api/settings/automation' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const control = await getAutomationControl(env);
        return json({
          ...control,
          nextRunAt: control.enabled ? nextAutomaticRunAt() : null,
          cron: '15 5 * * *'
        });
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:'Kunde inte läsa automatikstatus.' }, 503);
      }
    }

    if (path === '/app/api/settings/automation' && request.method === 'POST') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const contentType = String(request.headers.get('content-type') || '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
          return json({ error:'invalid_request', message:'content-type must be application/json' }, 415);
        }
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.enabled !== 'boolean') {
          return json({ error:'invalid_request', message:'enabled must be a boolean' }, 400);
        }
        const control = await setAutomationControl(env, body.enabled, { via:'app' });
        return json({
          ...control,
          nextRunAt: control.enabled ? nextAutomaticRunAt() : null,
          cron: '15 5 * * *'
        });
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:'Kunde inte ändra automatikstatus.' }, 500);
      }
    }

    if (path === '/app/api/settings/cloudflare-usage' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getCloudflareUsageOverview(env));
      } catch (error) {
        console.error(error);
        return json({
          error:'cloudflare_usage_unavailable',
          message:'Cloudflare-användningen kunde inte läsas just nu.'
        }, 502);
      }
    }

    if (request.method === 'GET' && path === '/app/api/games/statistics') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await getGameStatistics(env, { gameType:url.searchParams.get('type') }));
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/games/upcoming') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await listUpcomingGames(env, {
          gameType:url.searchParams.get('type'),
          limit:url.searchParams.get('limit')
        }));
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    const legForms = path.match(/^\/app\/api\/games\/upcoming\/([^/]+)\/legs\/(\d+)\/forms$/);
    if (request.method === 'GET' && legForms) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getUpcomingLegHorseForms(env, decodeURIComponent(legForms[1]), Number(legForms[2]));
        return data ? json(data) : json({ error:'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    const entryFacts = path.match(/^\/app\/api\/games\/upcoming\/([^/]+)\/legs\/(\d+)\/entries\/([^/]+)\/facts$/);
    if (request.method === 'GET' && entryFacts) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getUpcomingEntryFacts(
          env,
          decodeURIComponent(entryFacts[1]),
          Number(entryFacts[2]),
          decodeURIComponent(entryFacts[3])
        );
        return data ? json(data) : json({ error:'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    const legMatch = path.match(/^\/app\/api\/games\/upcoming\/([^/]+)\/legs\/(\d+)$/);
    if (request.method === 'GET' && legMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getUpcomingGameLeg(env, decodeURIComponent(legMatch[1]), Number(legMatch[2]));
        return data ? json(data) : json({ error:'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    const roundMatch = path.match(/^\/app\/api\/games\/upcoming\/([^/]+)$/);
    if (request.method === 'GET' && roundMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const data = await getUpcomingGameRound(env, decodeURIComponent(roundMatch[1]));
        return data ? json(data) : json({ error:'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    return enhanceApp(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    const gate = await automaticWorkflowGate(env);
    if (!gate.allowed) {
      return {
        skipped:true,
        reason:gate.reason,
        cron:controller.cron,
        automation:{
          enabled:false,
          updatedAt:gate.updatedAt,
          updatedVia:gate.updatedVia
        }
      };
    }
    return worker.scheduled(controller, env, ctx);
  }
};
