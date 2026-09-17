import worker from './worker-v069.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { createMarketPackV3Response } from './analysis-market-pack-v3.js';

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

function marketOptions(url) {
  return {
    file: url.searchParams.get('file'),
    lockId: url.searchParams.get('lock_id'),
    lockHash: url.searchParams.get('lock_hash'),
    asOf: url.searchParams.get('as_of')
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminMatch = path.match(/^\/v1\/analysis-market-pack\/([^/]+)$/);

    if (request.method === 'GET' && adminMatch) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const roundId = decodeURIComponent(adminMatch[1]);
        return await createMarketPackV3Response(env, roundId, marketOptions(url));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-market-pack') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await createMarketPackV3Response(env, roundId, marketOptions(url));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
