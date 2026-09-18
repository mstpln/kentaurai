import worker from './worker-v071.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  ANALYSIS_OPTIMIZER_POLICY_VERSION,
  ANALYSIS_OPTIMIZER_VERSION,
  createOptimizerV1,
  persistOptimizerV1
} from './analysis-optimizer-v1.js';
import { canonicalOptimizerPolicyForRound } from './analysis-optimizer-policy-config.js';

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

async function optimizerOptions(env, roundId, url) {
  return {
    ...await canonicalOptimizerPolicyForRound(env, roundId),
    decision_run_id: url.searchParams.get('decision_run_id')
  };
}

async function handleOptimizer(request, env, roundId, url) {
  const options = await optimizerOptions(env, roundId, url);
  if (request.method === 'GET') {
    const optimizer = await createOptimizerV1(env, roundId, options);
    return json({
      optimizer_version: ANALYSIS_OPTIMIZER_VERSION,
      policy_version: ANALYSIS_OPTIMIZER_POLICY_VERSION,
      persisted: false,
      optimizer
    });
  }
  const persisted = await persistOptimizerV1(env, roundId, options);
  return json({
    optimizer_version: ANALYSIS_OPTIMIZER_VERSION,
    policy_version: ANALYSIS_OPTIMIZER_POLICY_VERSION,
    persisted: true,
    optimizer_run: persisted
  }, persisted.reused ? 200 : 201);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminMatch = path.match(/^\/v1\/analysis-optimizer\/([^/]+)$/);

    if (adminMatch && (request.method === 'GET' || request.method === 'POST')) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return await handleOptimizer(request, env, decodeURIComponent(adminMatch[1]), url);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-optimizer' && (request.method === 'GET' || request.method === 'POST')) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await handleOptimizer(request, env, roundId, url);
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
