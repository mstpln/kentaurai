import worker from './index.js';
import { pwaIcon, pwaManifest, pwaServiceWorker } from './pwa.js';

function staticResponse(body, contentType) {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      const path = new URL(request.url).pathname;
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
    return worker.fetch(request, env);
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
