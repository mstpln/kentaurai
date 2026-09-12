import { importCombinedAnalysis, readCombinedAnalysisUpload } from './analysis-workflow-v2.js';

// Keep this boundary intentionally context-free. Game-type-specific spike-count
// validation belongs in analysis-workflow-v2.js where the authoritative round
// context is loaded from KentaurAI rather than trusted from client JSON.
export function validateCombinedSystemShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('analysis submission must be an object');
  }
  if (!Array.isArray(payload.systems) || payload.systems.length < 1) {
    throw new Error('combined submission must contain at least one system');
  }

  for (const [systemIndex, system] of payload.systems.entries()) {
    if (!system || typeof system !== 'object' || Array.isArray(system) || !Array.isArray(system.selections)) {
      throw new Error(`systems[${systemIndex}].selections must be an array`);
    }
  }
  return payload;
}

function bufferedWriteDb(realDb) {
  const pending = [];
  const prepare = (sql) => {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return realDb.prepare(sql).bind(...args).first(); },
      async all() { return realDb.prepare(sql).bind(...args).all(); },
      async run() {
        pending.push(realDb.prepare(sql).bind(...args));
        return { success: true, meta: { changes: 1 } };
      }
    };
  };
  return {
    db: { prepare },
    async flush() {
      if (pending.length) await realDb.batch(pending);
    }
  };
}

export async function importStrictCombinedAnalysis(env, payload) {
  validateCombinedSystemShape(payload);
  if (!env?.DB?.batch) throw new Error('DB batch support is required for atomic combined analysis import');
  const buffered = bufferedWriteDb(env.DB);
  const result = await importCombinedAnalysis({ ...env, DB: buffered.db }, payload);
  await buffered.flush();
  return result;
}

export async function importStrictCombinedAnalysisUpload(env, request) {
  const payload = await readCombinedAnalysisUpload(request);
  return importStrictCombinedAnalysis(env, payload);
}
