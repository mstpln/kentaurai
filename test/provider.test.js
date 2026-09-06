import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProviderShape, validateProviderEnvelope } from '../src/import/atg.js';

test('provider discovery reports shape without assuming provider schema', () => {
  const envelope = validateProviderEnvelope({ endpoint: 'https://example.invalid/api', payload: { races: [], games: {} } });
  const shape = discoverProviderShape(envelope.payload);
  assert.equal(shape.hasRacesArray, true);
  assert.equal(shape.hasGamesObject, true);
});
