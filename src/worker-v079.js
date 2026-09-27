import worker from './worker-v078.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { enhanceSettingsDriftHtml } from './settings-drift-ui.js';
import { getAutomationControl, getDriftOverview, setAutomationControl } from './settings-drift.js';

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
  return new Response(enhanceSettingsDriftHtml(await response.text()), {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

async function readBooleanBody(request) {
  const type = String(request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new Error('content-type must be application/json');
  const data = await request.json();
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.enabled !== 'boolean') {
    throw new Error('enabled must be boolean');
  }
  return data.enabled;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/app/api/settings/drift' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      return json(await getDriftOverview(env));
    }

    if (path === '/app/api/settings/automation' && request.method === 'POST') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const enabled = await readBooleanBody(request);
        return json({ ok:true, automation:await setAutomationControl(env, enabled) });
      } catch (error) {
        return json({ error:'request_failed', message:error.message }, 400);
      }
    }

    return enhanceApp(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    let automation;
    try {
      automation = await getAutomationControl(env);
    } catch (error) {
      console.error('automatic workflow control unavailable', error);
      return { skipped:true, reason:'automation_control_unavailable', failClosed:true };
    }
    if (!automation.enabled) {
      return { skipped:true, reason:'automatic_workflows_paused', pausedAt:automation.updatedAt || null };
    }
    return worker.scheduled(controller, env, ctx);
  }
};
