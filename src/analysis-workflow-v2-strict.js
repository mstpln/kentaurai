import { importCombinedAnalysis, readCombinedAnalysisUpload } from './analysis-workflow-v2.js';

const RISK_PROFILE_MAX_CHARS = 100;

function normalizeRiskProfile(value) {
  if (value == null || value === '') return value;
  const text = String(value);
  if (text.length <= RISK_PROFILE_MAX_CHARS) return text;
  return `${text.slice(0, RISK_PROFILE_MAX_CHARS - 1).trimEnd()}…`;
}

export function normalizeCombinedImportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.systems)) return payload;
  let changed = false;
  const systems = payload.systems.map((system) => {
    if (!system || typeof system !== 'object' || Array.isArray(system)) return system;
    const normalized = normalizeRiskProfile(system.risk_profile ?? system.riskProfile);
    const current = system.risk_profile ?? system.riskProfile;
    if (normalized === current) return system;
    changed = true;
    if ('risk_profile' in system || !('riskProfile' in system)) return { ...system, risk_profile: normalized };
    return { ...system, riskProfile: normalized };
  });
  return changed ? { ...payload, systems } : payload;
}

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
  const normalizedPayload = normalizeCombinedImportPayload(payload);
  if (!env?.DB?.batch) throw new Error('DB batch support is required for atomic combined analysis import');
  const buffered = bufferedWriteDb(env.DB);
  const result = await importCombinedAnalysis({ ...env, DB: buffered.db }, normalizedPayload);
  await buffered.flush();
  return result;
}

export async function importStrictCombinedAnalysisUpload(env, request) {
  const payload = await readCombinedAnalysisUpload(request);
  return importStrictCombinedAnalysis(env, payload);
}
