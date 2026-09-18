import worker from './worker-v076.js';
import { enhanceAppPerformanceHtml } from './app-performance-v1.js';

async function enhanceApp(request, response) {
  if (request.method !== 'GET') return response;
  const path = new URL(request.url).pathname;
  if (path !== '/app/') return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(enhanceAppPerformanceHtml(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    return enhanceApp(request, await worker.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
