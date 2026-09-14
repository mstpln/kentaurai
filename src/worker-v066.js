import worker from './worker-v065.js';
import { syncOnePendingOfficialSnapshotSource } from './import/official-snapshots.js';

export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const result = await worker.scheduled(controller, env, ctx);
    const snapshotSync = syncOnePendingOfficialSnapshotSource(env);
    if (ctx?.waitUntil) ctx.waitUntil(snapshotSync); else await snapshotSync;
    return result;
  }
};