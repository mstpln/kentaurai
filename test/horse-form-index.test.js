import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HORSE_FORM_RECENCY_WEIGHTS,
  calculateHorseFormIndex,
  fieldPercentileScore,
  relativeChallengeScore,
  resultPerformanceScore,
  weightedAvailable
} from '../src/statistics/horse-form-index.js';

test('horse form result score is field-size aware', () => {
  assert.equal(resultPerformanceScore({ placing: 1, fieldSize: 12 }), 100);
  assert.equal(resultPerformanceScore({ placing: 3, fieldSize: 12 }), (9 / 11) * 100);
  assert.equal(resultPerformanceScore({ placing: 3, fieldSize: 6 }), 60);
  assert.equal(resultPerformanceScore({ placing: null, disqualified: 1, fieldSize: 10 }), 0);
  assert.equal(resultPerformanceScore({ placing: null, fieldSize: 10 }), null);
});

test('horse form field percentile rewards stronger measured work and faster pace', () => {
  assert.equal(fieldPercentileScore(30, [0, 10, 20, 30]), 100);
  assert.equal(fieldPercentileScore(60, [60, 65, 70, 75], { lowerIsBetter: true }), 100);
  assert.equal(fieldPercentileScore(75, [60, 65, 70, 75], { lowerIsBetter: true }), 0);
  assert.equal(fieldPercentileScore(60, [60]), null);
});

test('horse form challenge compares opposition level with the target without inventing missing data', () => {
  assert.equal(relativeChallengeScore(1000, 1000), 50);
  assert.ok(relativeChallengeScore(1500, 1000) > 50);
  assert.ok(relativeChallengeScore(500, 1000) < 50);
  assert.equal(relativeChallengeScore(null, 1000), null);
});

test('horse form renormalizes missing components instead of treating them as zero', () => {
  assert.equal(weightedAvailable([
    { value: 80, weight: 0.3 },
    { value: null, weight: 0.3 },
    { value: 60, weight: 0.2 },
    { value: null, weight: 0.2 }
  ]), 72);
});

test('horse form combines up to five performances with explicit recency weights', () => {
  const starts = [100, 80, 60, 40, 20].map((value, index) => ({
    raceEntryId: 'e' + index,
    resultScore: value,
    difficultyScore: value,
    workScore: value,
    speedScore: value
  }));
  const result = calculateHorseFormIndex(starts);
  const expected = Math.round(starts.reduce((sum, start, index) => sum + start.resultScore * HORSE_FORM_RECENCY_WEIGHTS[index], 0));
  assert.equal(result.score, expected);
  assert.equal(result.usedStarts, 5);
  assert.equal(result.starts[0].recencyWeight, 0.35);
  assert.equal(result.starts[4].recencyWeight, 0.09);
});

test('horse form exposes no score when no verified performance component exists', () => {
  const result = calculateHorseFormIndex([{ resultScore: null, difficultyScore: null, workScore: null, speedScore: null }]);
  assert.equal(result.score, null);
  assert.equal(result.usedStarts, 0);
});
