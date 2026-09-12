import { importCombinedAnalysis, readCombinedAnalysisUpload } from './analysis-workflow-v2.js';

export function validateCombinedSystemSpikeContract(payload) {
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
    const counts = new Map();
    for (const selection of system.selections) {
      const legNumber = Number(selection?.leg_number ?? selection?.legNumber);
      if (Number.isInteger(legNumber) && legNumber >= 1 && legNumber <= 8) {
        counts.set(legNumber, (counts.get(legNumber) || 0) + 1);
      }
    }
    const singletonSpikes = [...counts.values()].filter((count) => count === 1).length;
    if (singletonSpikes !== 3) {
      throw new Error('every V85/V86 system must contain exactly three spike legs');
    }
  }
  return payload;
}

export async function importStrictCombinedAnalysis(env, payload) {
  validateCombinedSystemSpikeContract(payload);
  return importCombinedAnalysis(env, payload);
}

export async function importStrictCombinedAnalysisUpload(env, request) {
  const payload = await readCombinedAnalysisUpload(request);
  return importStrictCombinedAnalysis(env, payload);
}
