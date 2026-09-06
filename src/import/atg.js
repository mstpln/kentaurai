// Phase 1A provider boundary.
// We intentionally do not hard-code an unverified live JSON shape yet.
// The first live-provider task is to capture a real provider payload and lock fixtures/tests before mapping fields.

import { assertObject, requireString } from '../validation.js';

export function validateProviderEnvelope(envelope) {
  assertObject(envelope, 'provider envelope');
  requireString(envelope.endpoint, 'endpoint');
  if (!('payload' in envelope)) throw new Error('payload is required');
  return envelope;
}

export function discoverProviderShape(payload) {
  assertObject(payload, 'provider payload');
  return {
    topLevelKeys: Object.keys(payload).sort(),
    hasRacesArray: Array.isArray(payload.races),
    hasStartsArray: Array.isArray(payload.starts),
    hasTracksArray: Array.isArray(payload.tracks),
    hasGamesObject: Boolean(payload.games && typeof payload.games === 'object' && !Array.isArray(payload.games))
  };
}

// Backwards-compatible aliases while Phase 1A fixtures/tests are migrated.
export const validateAtgEnvelope = validateProviderEnvelope;
export const discoverAtgShape = discoverProviderShape;
