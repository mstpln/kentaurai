import worker from './worker-v070.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  ANALYSIS_DECISION_POLICY_VERSION,
  ANALYSIS_DECISION_PROBABILITY_VERSION,
  createDecisionProbabilityV1,
  persistDecisionProbabilityV1
} from './analysis-decision-probability-v1.js';

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

function decisionOptions(url) {
  return {
    lockId: url.searchParams.get('lock_id'),
    lockHash: url.searchParams.get('lock_hash'),
    asOf: url.searchParams.get('as_of')
  };
}

async function handleDecision(request, env, roundId, url) {
  const options = decisionOptions(url);
  if (request.method === 'GET') {
    const decision = await createDecisionProbabilityV1(env, roundId, options);
    return json({
      decision_probability_version: ANALYSIS_DECISION_PROBABILITY_VERSION,
      policy_version: ANALYSIS_DECISION_POLICY_VERSION,
      persisted: false,
      decision
    });
  }
  const persisted = await persistDecisionProbabilityV1(env, roundId, options);
  return json({
    decision_probability_version: ANALYSIS_DECISION_PROBABILITY_VERSION,
    policy_version: ANALYSIS_DECISION_POLICY_VERSION,
    persisted: true,
    decision_run: persisted
  }, persisted.reused ? 200 : 201);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminMatch = path.match(/^\/v1\/analysis-decision-probability\/([^/]+)$/);

    if (adminMatch && (request.method === 'GET' || request.method === 'POST')) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        return await handleDecision(request, env, decodeURIComponent(adminMatch[1]), url);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-decision-probability' && (request.method === 'GET' || request.method === 'POST')) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        return await handleDecision(request, env, roundId, url);
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
