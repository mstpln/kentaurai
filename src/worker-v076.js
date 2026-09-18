import workerV3 from './worker-v075.js';
import workerLegacy from './worker-v074.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { createF4Step2BundleResponse } from './f4-step2-bundle.js';

export const F4_CUTOVER_VERSION = 'analysis-v3-default-f4';
export const F4_DEFAULT_MODE = 'v3';
export const F4_ROLLBACK_MODE = 'legacy_v2';

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

function workflowMode(env) {
  const configured = String(env?.ANALYSIS_WORKFLOW_MODE || '').trim();
  if (!configured || configured === F4_DEFAULT_MODE) return F4_DEFAULT_MODE;
  if (configured === F4_ROLLBACK_MODE) return F4_ROLLBACK_MODE;
  return null;
}

function deprecationHeaders() {
  return {
    deprecation: 'true',
    'x-kentaurai-analysis-cutover': F4_CUTOVER_VERSION,
    'x-kentaurai-legacy-read-only': 'true'
  };
}

function gone(message) {
  return json({
    error: 'legacy_analysis_creation_disabled',
    message,
    analysis_workflow: F4_DEFAULT_MODE,
    cutover_version: F4_CUTOVER_VERSION
  }, 410, deprecationHeaders());
}

async function requireSession(request, env) {
  if (!appAuthConfigured(env)) return json({ error: 'service_unavailable' }, 503);
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  return null;
}

function isLegacyAdminRead(path, method) {
  if (method !== 'GET') return false;
  if (path === '/v1/analysis/rounds') return true;
  if (/^\/v1\/analysis\/rounds\/[^/]+\/context$/.test(path)) return true;
  if (/^\/v1\/analysis\/rounds\/[^/]+\/submissions(?:\/[^/]+)?$/.test(path)) return true;
  return false;
}

function isLegacyAppGeneration(path, method) {
  return method === 'GET' && new Set([
    '/app/api/settings/analysis-rounds',
    '/app/api/settings/export',
    '/app/api/settings/analysis-method-prompt',
    '/app/api/settings/analysis-prompt'
  ]).has(path);
}

async function withLegacyReadHeaders(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(deprecationHeaders())) headers.set(key, value);
  headers.delete('content-length');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function healthResponse(request, env, ctx, mode) {
  const response = await workerV3.fetch(request, env, ctx);
  if (!response.ok) return response;
  const data = await response.json();
  return json({
    ...data,
    analysisWorkflow: mode,
    analysisCutoverVersion: F4_CUTOVER_VERSION,
    legacyAnalysisCreationEnabled: mode === F4_ROLLBACK_MODE
  }, response.status);
}

export default {
  async fetch(request, env, ctx) {
    const mode = workflowMode(env);
    if (!mode) {
      return json({
        error: 'service_unavailable',
        message: 'ANALYSIS_WORKFLOW_MODE must be v3 or legacy_v2'
      }, 503);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return healthResponse(request, env, ctx, mode);
    }

    if (mode === F4_ROLLBACK_MODE) {
      return workerLegacy.fetch(request, env, ctx);
    }

    if (request.method === 'GET' && path === '/app/api/settings/f4-step2-bundle') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await createF4Step2BundleResponse(env, roundId, { asOf: url.searchParams.get('as_of') || null });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const legacyAdminWrite = path.match(/^\/v1\/analysis\/rounds\/[^/]+\/submissions$/);
    if (request.method === 'POST' && legacyAdminWrite) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      return gone('Legacy v1/v2 analysis creation is disabled after the F4 cutover. Use the v3 pack -> sealed Step 1 -> market -> Step 2 -> code optimizer workflow.');
    }

    if (request.method === 'POST' && path === '/app/api/settings/import-analysis') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      return gone('Legacy combined-analysis import is read-only after the F4 cutover. Create new analyses through the guided v3 workflow.');
    }

    if (isLegacyAppGeneration(path, request.method)) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      return gone('This legacy analysis-generation route is deprecated after the F4 cutover. The private UI now uses the v3 workflow.');
    }

    if (isLegacyAdminRead(path, request.method)) {
      const response = await workerV3.fetch(request, env, ctx);
      return withLegacyReadHeaders(response);
    }

    return workerV3.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const mode = workflowMode(env);
    if (!mode) throw new Error('ANALYSIS_WORKFLOW_MODE must be v3 or legacy_v2');
    return (mode === F4_ROLLBACK_MODE ? workerLegacy : workerV3).scheduled(controller, env, ctx);
  }
};
