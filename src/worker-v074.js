import worker from './worker-v073.js';
import { requireAdmin } from './auth.js';
import {
  REPLAY_VERSION,
  getReplayRunV1,
  persistReplayResultV1,
  runDecisionReplayV1
} from './replay-calibration-v1.js';

const MAX_REPLAY_CONFIG_BYTES = 256 * 1024;

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
  if (Number.isFinite(declared) && declared > MAX_REPLAY_CONFIG_BYTES) throw new Error('replay config is too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_CONFIG_BYTES) throw new Error('replay config is too large');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('request body must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be a JSON object');
  return value;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/v1/replay/decision' && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const config = await readJson(request);
        const result = await runDecisionReplayV1(env, config);
        const persisted = await persistReplayResultV1(env, result);
        return json({
          replay_version: REPLAY_VERSION,
          replay_run: persisted
        }, persisted.reused ? 200 : 201);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const replayMatch = path.match(/^\/v1\/replay\/([^/]+)$/);
    if (replayMatch && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const replay = await getReplayRunV1(env, decodeURIComponent(replayMatch[1]));
        return replay ? json(replay) : json({ error: 'not_found' }, 404);
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
