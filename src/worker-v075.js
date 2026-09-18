import worker from './worker-v074.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { enhanceF3PrivateUiHtml } from './app-f3-private-ui.js';
import {
  F3_PRIVATE_UI_VERSION,
  buildF3OperationalStatus,
  buildF3WorkflowState,
  createF3AnalysisPackBundleResponse,
  listF3AnalysisRounds
} from './f3-private-ui.js';

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

function removeLegacyAnalysisExportUi(html) {
  return String(html).replace(
    /<script id="kentaurai-analysis-export-download-fix">[\s\S]*?<\/script>/,
    ''
  );
}

async function enhancedAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceF3PrivateUiHtml(removeLegacyAnalysisExportUi(await response.text()));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/app/api/settings/f3-rounds') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json({ contract_version: F3_PRIVATE_UI_VERSION, rounds: await listF3AnalysisRounds(env) });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/f3-workflow-state') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        const state = await buildF3WorkflowState(env, roundId);
        return state ? json(state) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/f3-analysis-pack') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await createF3AnalysisPackBundleResponse(env, roundId, { asOf: url.searchParams.get('as_of') || null });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/f3-operational-status') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json(await buildF3OperationalStatus(env));
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return enhancedAppResponse(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
