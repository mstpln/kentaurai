import worker from './worker-v066.js';
import { requireAdmin } from './auth.js';
import { createAnalysisPackV3Response } from './analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from './analysis-pack-v3-asof-guard.js';

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/v1\/analysis-pack\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const roundId = decodeURIComponent(match[1]);
        const asOf = url.searchParams.get('as_of');
        await assertAnalysisPackReplaySafe(env, roundId, asOf);
        return await createAnalysisPackV3Response(env, roundId, {
          file: url.searchParams.get('file'),
          asOf
        });
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
