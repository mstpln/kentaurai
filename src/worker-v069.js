import worker from './worker-v068.js';
import { requireAdmin } from './auth.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  buildStep1RevisionPackV1,
  captureStep1RevisionBasisForLock,
  importStep1RevisionV1,
  ANALYSIS_STEP1_REVISION_VERSION
} from './analysis-step1-revision-v1.js';
import {
  getAnalysisStep1RevisionPromptV1,
  ANALYSIS_STEP1_REVISION_PROMPT_VERSION
} from './analysis-step1-revision-prompt-v1.js';

const MAX_REVISION_BYTES = 4 * 1024 * 1024;

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

function assertUrlRound(payload, roundId) {
  const payloadRound = String(payload?.round_id ?? '').trim();
  if (!payloadRound || payloadRound !== roundId) throw new Error('URL round_id must match the Step 1 revision round_id');
}

async function captureBasisAfterInitialLock(response, env) {
  if (response.status !== 201) return response;
  try {
    const body = await response.clone().json();
    const lockId = String(body?.lock?.lock_id || '').trim();
    if (!lockId) throw new Error('sealed Step 1 lock response is missing lock_id');
    await captureStep1RevisionBasisForLock(env, { lockId });
    return response;
  } catch (error) {
    console.error(error);
    const body = await response.clone().json().catch(() => ({}));
    return json({
      ...body,
      revision_basis_status: 'unavailable',
      revision_basis_warning: 'Step 1 lock was sealed, but its D3 revision basis could not be captured; a later factual change will require the safe full-round fallback.'
    }, 201);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const adminRevision = path.match(/^\/v1\/analysis-step1-revision\/([^/]+)$/);

    if (adminRevision && (request.method === 'GET' || request.method === 'POST')) {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const roundId = decodeURIComponent(adminRevision[1]);
        if (request.method === 'GET') {
          const pack = await buildStep1RevisionPackV1(env, {
            roundId,
            parentLockId: url.searchParams.get('parent_lock_id') || null,
            targetAsOf: url.searchParams.get('as_of') || null
          });
          return json({ revision_pack: pack, revision_version: ANALYSIS_STEP1_REVISION_VERSION });
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
        return json({
          prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
          provider,
          prompt: getAnalysisStep1RevisionPromptV1(provider)
        });
      } catch (error) {
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (request.method === 'GET' && path === '/app/api/settings/analysis-step1-revision-prompt') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const provider = url.searchParams.get('provider') || 'openai';
        return json({
          prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
          provider,
          prompt: getAnalysisStep1RevisionPromptV1(provider)
        });
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
          const pack = await buildStep1RevisionPackV1(env, {
            roundId,
            parentLockId: url.searchParams.get('parent_lock_id') || null,
            targetAsOf: url.searchParams.get('as_of') || null
          });
          return json({ revision_pack: pack, revision_version: ANALYSIS_STEP1_REVISION_VERSION });
        }
        const payload = await readJsonBody(request);
        assertUrlRound(payload, roundId);
        return json({ revision: await importStep1RevisionV1(env, payload), revision_version: ANALYSIS_STEP1_REVISION_VERSION }, 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const adminInitialLockPost = request.method === 'POST' && /^\/v1\/analysis-step1-lock\/[^/]+$/.test(path);
    const appInitialLockPost = request.method === 'POST' && path === '/app/api/settings/analysis-step1-lock';
    if (adminInitialLockPost || appInitialLockPost) {
      return captureBasisAfterInitialLock(await worker.fetch(request, env, ctx), env);
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
