import worker from './worker-v067.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { enhanceStep1LockV3Html } from './app-step1-lock-v3-overlay.js';
import { getAnalysisStep1PromptV3, ANALYSIS_STEP1_PROMPT_V3_VERSION } from './analysis-step1-prompt-v3.js';
import { getStep1LockV1, importStep1LockV1, ANALYSIS_STEP1_LOCK_VERSION } from './analysis-step1-lock-v1.js';

const MAX_LOCK_BYTES = 2 * 1024 * 1024;

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

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_LOCK_BYTES) throw new Error('Step 1 lock exceeds maximum upload size');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_LOCK_BYTES) throw new Error('Step 1 lock exceeds maximum upload size');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Step 1 lock must be valid JSON'); }
  return value;
}

function assertUrlRound(payload, roundId) {
  const payloadRound = String(payload?.round_id ?? payload?.roundId ?? '').trim();
  if (!payloadRound || payloadRound !== roundId) throw new Error('URL round_id must match the Step 1 lock round_id');
}

async function enhancedAppResponse(request, response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceStep1LockV3Html(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminMatch = path.match(/^\/v1\/analysis-step1-lock\/([^/]+)$/);

    if (adminMatch && (request.method === 'GET' || request.method === 'POST')) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const roundId = decodeURIComponent(adminMatch[1]);
        if (request.method === 'GET') return json({ lock: await getStep1LockV1(env, { roundId }) });
        const payload = await readJsonBody(request);
        assertUrlRound(payload, roundId);
        return json({ lock: await importStep1LockV1(env, payload) }, 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/v1/analysis-step1-prompt') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({ prompt_version: ANALYSIS_STEP1_PROMPT_V3_VERSION, provider, prompt: getAnalysisStep1PromptV3(provider) });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-step1-v3-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({ prompt_version: ANALYSIS_STEP1_PROMPT_V3_VERSION, provider, prompt: getAnalysisStep1PromptV3(provider) });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-step1-lock' && (request.method === 'GET' || request.method === 'POST')) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        if (request.method === 'GET') return json({ lock: await getStep1LockV1(env, { roundId }), lock_version: ANALYSIS_STEP1_LOCK_VERSION });
        const payload = await readJsonBody(request);
        assertUrlRound(payload, roundId);
        return json({ lock: await importStep1LockV1(env, payload), lock_version: ANALYSIS_STEP1_LOCK_VERSION }, 201);
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
