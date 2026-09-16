import worker from './worker-v068.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  ANALYSIS_STEP1_REVISION_VERSION,
  buildStep1RevisionInputV1,
  getAnalysisStep1RevisionPromptV1,
  importStep1RevisionV1
} from './analysis-step1-revision-v1.js';

const MAX_REVISION_BYTES = 2 * 1024 * 1024;

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
  if (Number.isFinite(declared) && declared > MAX_REVISION_BYTES) throw new Error('Step 1 revision exceeds maximum upload size');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REVISION_BYTES) throw new Error('Step 1 revision exceeds maximum upload size');
  try { return JSON.parse(text); } catch { throw new Error('Step 1 revision must be valid JSON'); }
}

function queryRevisionOptions(url, roundId) {
  return {
    roundId,
    parentLockId: url.searchParams.get('parent_lock_id') || null,
    asOf: url.searchParams.get('as_of') || null
  };
}

function assertUrlRound(payload, roundId) {
  const payloadRound = String(payload?.round_id ?? '').trim();
  if (!payloadRound || payloadRound !== roundId) throw new Error('URL round_id must match the Step 1 revision round_id');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminMatch = path.match(/^\/v1\/analysis-step1-revision\/([^/]+)$/);

    if (adminMatch && (request.method === 'GET' || request.method === 'POST')) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const roundId = decodeURIComponent(adminMatch[1]);
        if (request.method === 'GET') {
          return json({ revision: await buildStep1RevisionInputV1(env, queryRevisionOptions(url, roundId)), revision_version: ANALYSIS_STEP1_REVISION_VERSION });
        }
        const payload = await readJsonBody(request);
        assertUrlRound(payload, roundId);
        return json({ revision: await importStep1RevisionV1(env, payload), revision_version: ANALYSIS_STEP1_REVISION_VERSION }, 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/v1/analysis-step1-revision-prompt') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({ revision_version: ANALYSIS_STEP1_REVISION_VERSION, provider, prompt: getAnalysisStep1RevisionPromptV1(provider) });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-step1-revision-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({ revision_version: ANALYSIS_STEP1_REVISION_VERSION, provider, prompt: getAnalysisStep1RevisionPromptV1(provider) });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/app/api/settings/analysis-step1-revision' && (request.method === 'GET' || request.method === 'POST')) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const roundId = String(url.searchParams.get('round_id') || '').trim();
        if (!roundId) throw new Error('round_id is required');
        if (request.method === 'GET') {
          return json({ revision: await buildStep1RevisionInputV1(env, queryRevisionOptions(url, roundId)), revision_version: ANALYSIS_STEP1_REVISION_VERSION });
        }
        const payload = await readJsonBody(request);
        assertUrlRound(payload, roundId);
        return json({ revision: await importStep1RevisionV1(env, payload), revision_version: ANALYSIS_STEP1_REVISION_VERSION }, 201);
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
