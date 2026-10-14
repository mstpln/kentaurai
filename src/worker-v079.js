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

async function enhanceApp(request, response, env) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  let html = enhanceSettingsDriftHtml(await response.text());
  if (env.PREVIEW_DATA_MODE === 'synthetic') {
    html = html.replace('</body>', `<div class="synthetic-preview-badge" role="status" aria-label="Synthetic local preview data">SYNTHETIC PREVIEW · local D1</div>
      <style>.synthetic-preview-badge{position:fixed;right:12px;bottom:calc(70px + env(safe-area-inset-bottom));z-index:9999;padding:6px 9px;border:1px solid #f0c36d;border-radius:999px;background:#fff7e6;color:#744b00;font:600 10px/1.2 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 2px 8px #0002;pointer-events:none}@media(min-width:760px){.synthetic-preview-badge{bottom:12px}}</style></body>`);
  }
  return new Response(html, {
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

    // Deployment identity is injected by the reviewed production release.
    // A missing or different SHA fails the separate cleanup preflight closed.
    if (request.method === 'GET' && path === '/health') {
      const response = await worker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const payload = await response.json();
      const sha = String(env.KENTAURAI_DEPLOY_SHA || '');
      return json({
        ...payload,
        deploymentSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null
      }, response.status);
    }

    if (path === '/app/api/settings/drift' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      if (env.PREVIEW_DATA_MODE === 'synthetic') {
        return json({
          automation: await getAutomationControl(env),
          cloudflare: { configured:false, reason:'synthetic_preview_external_access_disabled', billingPeriod:null, metrics:[] },
          preview: { dataMode:'synthetic', localOnly:true }
        });
      }
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

    return enhanceApp(request, await worker.fetch(request, env, ctx), env);
  },

  async scheduled(controller, env, ctx) {
    if (env.PREVIEW_DATA_MODE === 'synthetic') {
      return { skipped:true, reason:'synthetic_preview_external_workflows_disabled' };
    }
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
