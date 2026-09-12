import test from 'node:test';
import assert from 'node:assert/strict';
import { getHorseRelevantPatternsBatch } from '../src/statistics/horse-patterns.js';

function fakeEnv() {
  const bindCounts = [];
  return {
    bindCounts,
    DB: {
      prepare() {
        return {
          bind(...values) {
            bindCounts.push(values.length);
            return {
              async all() {
                return { results: [] };
              }
            };
          }
        };
      }
    }
  };
}

test('relevant horse patterns chunk large horse lists below D1 SQL variable limits', async () => {
  const env = fakeEnv();
  const horseIds = Array.from({ length: 121 }, (_, index) => `horse-${index + 1}`);
  const result = await getHorseRelevantPatternsBatch(env, horseIds, '2026-09-12', { historicalOnly: true });

  assert.equal(result.size, 121);
  assert.ok(env.bindCounts.length > 2, 'large batches should be split into multiple SQL queries');
  assert.ok(env.bindCounts.every((count) => count <= 41), `unexpected bind count: ${Math.max(...env.bindCounts)}`);
  assert.equal(result.get('horse-121').startPoints.status, 'unavailable');
  assert.equal(result.get('horse-121').xlabs.status, 'unavailable');
});
