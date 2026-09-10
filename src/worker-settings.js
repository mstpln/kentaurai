import worker from './worker-pwa.js';
import { appAuthConfigured, clearAppSessionCookie, hasValidAppSession } from './app-auth.js';
import { htmlResponse, redirectResponse, renderAppPage } from './app-page-settings.js';
import { XLABS_SCRIPT_SELECTOR_VERSION } from './provider/xlabs-script.js';
import { KENTAURAI_APP_VERSION, createFullDataExportResponse, getSettingsStatus, importAnalysisUpload } from './settings-data.js';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, service: 'kentaurai-api', version: KENTAURAI_APP_VERSION, xlabsScriptSelector: XLABS_SCRIPT_SELECTOR_VERSION });
    }

    if (request.method === 'GET' && (path === '/app' || path === '/app/')) {
      if (appAuthConfigured(env) && await hasValidAppSession(request, env)) return htmlResponse(renderAppPage());
      return worker.fetch(request, env);
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

    return worker.fetch(request, env);
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
