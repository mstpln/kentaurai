import worker from './worker-v076.js';
import { createAppSessionCookie } from './app-auth.js';
import { enhanceAppPerformanceHtml } from './app-performance-v1.js';
import { enhanceEntityDetailUiHtml } from './entity-detail-ui.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function enhanceApp(request, response) {
  if (request.method !== 'GET') return response;
  const path = new URL(request.url).pathname;
  if (path !== '/app/') return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const html = enhanceAppPerformanceHtml(await response.text());
  return new Response(enhanceEntityDetailUiHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1;
}

async function entityDetailUiHealth(request, env, ctx) {
  if (!env.APP_PASSWORD) return json({ ok:false, error:'app_auth_not_configured' }, 503);
  const cookie = (await createAppSessionCookie(env)).split(';', 1)[0];
  const url = new URL(request.url);
  url.pathname = '/app/';
  url.search = '';
  url.hash = '';
  const appRequest = new Request(url.toString(), { headers:{ cookie } });
  const appResponse = await enhanceApp(appRequest, await worker.fetch(appRequest, env, ctx));
  const type = appResponse.headers.get('content-type') || '';
  if (appResponse.status !== 200 || !type.includes('text/html')) {
    return json({ ok:false, error:'app_payload_unavailable', status:appResponse.status }, 503);
  }
  const html = await appResponse.text();
  const checks = {
    canonicalHorseTabs: html.includes("if(type==='horse')return [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['data','Data']]"),
    canonicalTrainerTabs: html.includes("if(type==='trainer')return [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']]"),
    canonicalDriverTabs: html.includes("return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']]"),
    scorecardRuntimeOnce: occurrenceCount(html, 'id="kentaurai-entity-detail-statistics-v2-script"') === 1,
    canonicalMountExposed: html.includes('__kentauraiEntityDetailStatistics={mount'),
    alignedHorseTabOverrideAbsent: !html.includes('priorAlignedDetailTabs'),
    finalDetailWrapperAbsent: !html.includes('kentaurai-entity-detail-ui-runtime'),
    legacyDetailHostsAbsent: !/horseStatsBuildB|trainerStatsBuildD|driverStatsBuildC/.test(html)
  };
  const ok = Object.values(checks).every(Boolean);
  return json({ ok, service:'kentaurai-api', check:'entity-detail-ui', version:'core-owner-v1', checks }, ok ? 200 : 503);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health/entity-detail-ui') {
      return entityDetailUiHealth(request, env, ctx);
    }
    return enhanceApp(request, await worker.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
