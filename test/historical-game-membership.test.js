import test from 'node:test';
import assert from 'node:assert/strict';

import { historicalGameTypesForRace } from '../src/import/official-historical-backfill.js';

test('historical calendar membership recognizes V75/V85/V86 only from explicit race ids', () => {
  const calendar = {
    games: {
      V75: [{ id: 'V75_2099-01-01_x', races: ['race-v75'] }],
      V85: [{ id: 'V85_2099-01-01_x', races: ['race-v85'] }],
      V86: [{ id: 'V86_2099-01-01_x', races: ['race-v86'] }],
      GS75: [{ id: 'GS75_2099-01-01_x', races: ['race-gs75'] }]
    }
  };

  assert.deepEqual(historicalGameTypesForRace(calendar, 'race-v75'), ['V75']);
  assert.deepEqual(historicalGameTypesForRace(calendar, 'race-v85'), ['V85']);
  assert.deepEqual(historicalGameTypesForRace(calendar, 'race-v86'), ['V86']);
  assert.deepEqual(historicalGameTypesForRace(calendar, 'race-gs75'), []);
  assert.deepEqual(historicalGameTypesForRace(calendar, 'race-other'), []);
});

test('historical calendar membership fails closed on missing or malformed game data', () => {
  assert.deepEqual(historicalGameTypesForRace({}, 'race-v75'), []);
  assert.deepEqual(historicalGameTypesForRace({ games: [] }, 'race-v75'), []);
  assert.deepEqual(historicalGameTypesForRace({ games: { V75: [{ races: null }] } }, 'race-v75'), []);
});
