import worker from './worker-v066.js';
import { requireAdmin } from './auth.js';
import { createAnalysisPackV3Response } from './analysis-pack-v3.js';

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
        return await createAnalysisPackV3Response(env, decodeURIComponent(match[1]), {
          file: url.searchParams.get('file'),
          asOf: url.searchParams.get('as_of')
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
