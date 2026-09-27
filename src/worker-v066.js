import worker from './worker-v065.js';
import { syncOnePendingOfficialSnapshotSource } from './import/official-snapshots.js';
import { getAutomationControl } from './settings-drift.js';

export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const result = await worker.scheduled(controller, env, ctx);
    let control;
    try { control = await getAutomationControl(env); }
    catch (error) { console.error('automatic workflow control unavailable', error); return result; }
    if (!control.enabled) return result;
    const snapshotSync = syncOnePendingOfficialSnapshotSource(env);
    if (ctx?.waitUntil) ctx.waitUntil(snapshotSync); else await snapshotSync;
    return result;
  }
};