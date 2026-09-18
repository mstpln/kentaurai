import worker from './worker-v073.js';
import { requireAdmin } from './auth.js';
import { createReplayRunV1, getReplayRunV1, stepReplayRunV1 } from './replay-runner-v1.js';

const MAX_JSON_BYTES = 256 * 1024;

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

async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('replay request exceeds maximum body size');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('replay request exceeds maximum body size');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('replay request must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('replay request must be a JSON object');
  return value;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/v1/replay/start' && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const payload = await readJson(request);
        return json({ replay: await createReplayRunV1(env, payload) }, 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/v1/replay/step' && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const payload = await readJson(request);
        return json({ replay_step: await stepReplayRunV1(env, payload.run_id) });
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    if (path === '/v1/replay/status' && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const runId = String(url.searchParams.get('run_id') || '').trim();
        if (!runId) throw new Error('run_id is required');
        return json({ replay: await getReplayRunV1(env, runId) });
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
