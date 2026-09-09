import worker from './index.js';
import { requireAdmin } from './auth.js';
import { runNextPostRaceReview } from './post-race-review.js';
import { pwaIcon, pwaManifest, pwaServiceWorker } from './pwa.js';

const BACKFILL_CRON = '* * * * *';

function staticResponse(body, contentType) {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const path = url.pathname;
      if (path === '/app/manifest.webmanifest') return staticResponse(JSON.stringify(pwaManifest()), 'application/manifest+json; charset=utf-8');
      if (path === '/app/icon.svg') return staticResponse(pwaIcon(), 'image/svg+xml; charset=utf-8');
      if (path === '/app/icon-maskable.svg') return staticResponse(pwaIcon({ maskable: true }), 'image/svg+xml; charset=utf-8');
      if (path === '/app/sw.js') return new Response(pwaServiceWorker(), {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache',
          'service-worker-allowed': '/app/',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/post-race/review-next') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return json(await runNextPostRaceReview(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return worker.fetch(request, env);
  },
  async scheduled(controller, env, ctx) {
    worker.scheduled(controller, env, ctx);
    if (controller.cron === BACKFILL_CRON) {
      ctx.waitUntil(runNextPostRaceReview(env).catch((error) => console.error(error)));
    }
  }
};
