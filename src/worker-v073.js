import worker from './worker-v072.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { getAnalysisStep2PromptV3, ANALYSIS_STEP2_PROMPT_VERSION } from './analysis-step2-prompt-v3.js';
import {
  ANALYSIS_V3_VERSION,
  buildFinalNarrativePromptV1,
  getAnalysisV3,
  importStep2AndOptimizeV1,
  persistFinalNarrativeV1
} from './analysis-step2-integration-v1.js';

const MAX_JSON_BYTES = 1024 * 1024;

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

async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('JSON body is too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('JSON body is too large');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('request body must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be a JSON object');
  return value;
}

function optimizerPolicy(url) {
  return {
    line_price_sek: url.searchParams.get('line_price_sek'),
    target_budget_min_sek: url.searchParams.get('target_budget_min_sek'),
    max_budget_sek: url.searchParams.get('max_budget_sek'),
    exact_spike_count: url.searchParams.get('exact_spike_count') || undefined,
    system_type: url.searchParams.get('system_type') || undefined
  };
}

async function handleStep2Import(request, env, roundId, url) {
  const payload = await readJson(request);
  if (String(payload.round_id || '') !== roundId) throw new Error('payload round_id must match route round');
  const integrated = await importStep2AndOptimizeV1(env, payload, optimizerPolicy(url));
  return json({
    analysis_version: ANALYSIS_V3_VERSION,
    persisted: true,
    integrated_analysis: integrated,
    final_narrative_prompt: buildFinalNarrativePromptV1(integrated)
  }, integrated.reused ? 200 : 201);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/v1/analysis-step2-prompt' && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({
          prompt_version: ANALYSIS_STEP2_PROMPT_VERSION,
          prompt: getAnalysisStep2PromptV3(provider)
        });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const step2Match = path.match(/^\/v1\/analysis-step2\/([^/]+)$/);
    if (step2Match && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return await handleStep2Import(request, env, decodeURIComponent(step2Match[1]), url);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const analysisMatch = path.match(/^\/v1\/analysis-v3\/([^/]+)$/);
    if (analysisMatch && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const integrated = await getAnalysisV3(env, decodeURIComponent(analysisMatch[1]));
        return integrated ? json(integrated) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const narrativePromptMatch = path.match(/^\/v1\/analysis-v3\/([^/]+)\/narrative-prompt$/);
    if (narrativePromptMatch && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const integrated = await getAnalysisV3(env, decodeURIComponent(narrativePromptMatch[1]));
        if (!integrated) return json({ error: 'not_found' }, 404);
        return json({ prompt: buildFinalNarrativePromptV1(integrated) });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const narrativeMatch = path.match(/^\/v1\/analysis-v3\/([^/]+)\/narrative$/);
    if (narrativeMatch && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const payload = await readJson(request);
        const analysisId = decodeURIComponent(narrativeMatch[1]);
        if (String(payload.analysis_id || '') !== analysisId) throw new Error('payload analysis_id must match route analysis');
        const result = await persistFinalNarrativeV1(env, payload);
        return json(result, result.reused ? 200 : 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-step2-prompt' && request.method === 'GET') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({
          prompt_version: ANALYSIS_STEP2_PROMPT_VERSION,
          prompt: getAnalysisStep2PromptV3(provider)
        });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-step2' && request.method === 'POST') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await handleStep2Import(request, env, roundId, url);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
