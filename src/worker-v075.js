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
import {
  EXTERNAL_ANALYSIS_FLOW_VERSION,
  buildMarketInput,
  buildRegistrationContext,
  getExternalAnalysisStep1Prompt,
  getExternalAnalysisStep2Prompt,
  getRegistrationPrompt,
  importRecordedSystem,
  listExternalAnalysisRounds
} from './external-analysis-flow-v1.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

async function requireSession(request, env) {
  if (!appAuthConfigured(env)) return json({ error: 'service_unavailable' }, 503);
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  return null;
}

function attachmentJson(data, filename, status = 200) {
  return json(data, status, { 'content-disposition': 'attachment; filename="' + filename + '"' });
}

async function readJson(request, maxBytes = 2 * 1024 * 1024) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('JSON body is too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('JSON body is too large');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('request body must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be a JSON object');
  return value;
}

function removeLegacyAnalysisUiScripts(html) {
  return [
    'kentaurai-analysis-export-download-fix',
    'kentaurai-step1-lock-v3-overlay'
  ].reduce((source, id) => source.replace(
    new RegExp(`<script id="${id}">[\\s\\S]*?<\\/script>`),
    ''
  ), String(html));
}

async function enhancedAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceF3PrivateUiHtml(removeLegacyAnalysisUiScripts(await response.text()));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/app/api/settings/external-rounds') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const scope = url.searchParams.get('scope') || 'analysis';
        return json({ contract_version: EXTERNAL_ANALYSIS_FLOW_VERSION, rounds: await listExternalAnalysisRounds(env, scope) });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/external-step1-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json({ prompt_version: 'external-analysis-prompt-v1', prompt: getExternalAnalysisStep1Prompt(url.searchParams.get('provider') || 'openai') });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/external-market') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        const data = await buildMarketInput(env, roundId, url.searchParams.get('as_of') || null);
        const safe = roundId.replace(/[^a-zA-Z0-9._-]+/g, '_');
        return attachmentJson(data, 'kentaurai-market_' + safe + '.json');
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/external-step2-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json({ prompt_version: 'external-analysis-prompt-v1', prompt: getExternalAnalysisStep2Prompt(url.searchParams.get('provider') || 'openai') });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/system-import-context') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        const data = await buildRegistrationContext(env, roundId);
        const safe = roundId.replace(/[^a-zA-Z0-9._-]+/g, '_');
        return attachmentJson(data, 'kentaurai-system-import_' + safe + '.json');
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/system-import-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        return json({ prompt_version: 'external-analysis-prompt-v1', prompt: getRegistrationPrompt(url.searchParams.get('provider') || 'openai') });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'POST' && path === '/app/api/settings/system-import') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const payload = await readJson(request);
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        if (String(payload.round_id || '') !== roundId) throw new Error('payload round_id must match selected round');
        const result = await importRecordedSystem(env, payload);
        return json(result, result.reused ? 200 : 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

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
