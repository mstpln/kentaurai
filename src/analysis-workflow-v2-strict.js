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

export async function importStrictCombinedAnalysis(env, payload) {
  validateCombinedSystemShape(payload);
  return importCombinedAnalysis(env, payload);
}

export async function importStrictCombinedAnalysisUpload(env, request) {
  const payload = await readCombinedAnalysisUpload(request);
  return importStrictCombinedAnalysis(env, payload);
}
