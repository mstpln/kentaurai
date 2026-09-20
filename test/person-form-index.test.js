import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIVER_FORM_WEIGHTS,
  PERSON_FORM_MAX_STARTS,
  TRAINER_FORM_WEIGHTS,
  calculateDriverFormIndex,
  calculateTrainerFormIndex,
  marketExpectationPerformanceScore,
  trainerDevelopmentScore
} from '../src/statistics/person-form-index.js';

test('driver market performance rewards beating market rank and is neutral when result matches expectation', () => {
  assert.equal(marketExpectationPerformanceScore({ placing:1, fieldSize:12, marketRank:1 }), 50);
  assert.equal(marketExpectationPerformanceScore({ placing:12, fieldSize:12, marketRank:12 }), 50);
  assert.ok(marketExpectationPerformanceScore({ placing:2, fieldSize:12, marketRank:8 }) > 75);
  assert.ok(marketExpectationPerformanceScore({ placing:8, fieldSize:12, marketRank:1 }) < 20);
  assert.equal(marketExpectationPerformanceScore({ placing:2, fieldSize:12, marketRank:null }), null);
});

test('driver form is 60 percent result and 40 percent historical market performance when both are available', () => {
  const starts = Array.from({ length:5 }, (_, index) => ({
    raceEntryId:'e' + index,
    resultScore:80,
    marketPerformanceScore:60
  }));
  const form = calculateDriverFormIndex(starts);
  assert.equal(form.score, Math.round(80 * DRIVER_FORM_WEIGHTS.result + 60 * DRIVER_FORM_WEIGHTS.marketPerformance));
  assert.equal(form.marketBlindScore, 80);
  assert.equal(form.components.resultForm.marketBlind, true);
  assert.equal(form.components.marketPerformance.marketBlind, false);
});

test('driver form keeps market-blind result form separate and renormalizes missing historical market evidence', () => {
  const form = calculateDriverFormIndex([
    { resultScore:90, marketPerformanceScore:null },
    { resultScore:80, marketPerformanceScore:null },
    { resultScore:70, marketPerformanceScore:null }
  ]);
  assert.equal(form.score, form.marketBlindScore);
  assert.equal(form.components.marketPerformance.score, null);
});

test('trainer development compares each result only with the horse own prior results', () => {
  assert.equal(trainerDevelopmentScore({ resultScore:80, priorResultScores:[60,60,60] }), 60);
  assert.equal(trainerDevelopmentScore({ resultScore:40, priorResultScores:[60,60,60] }), 40);
  assert.equal(trainerDevelopmentScore({ resultScore:80, priorResultScores:[] }), null);
});

test('trainer form is 60 percent current results and 40 percent horse development without a market component', () => {
  const starts = Array.from({ length:5 }, (_, index) => ({
    raceEntryId:'t' + index,
    resultScore:70,
    developmentScore:80
  }));
  const form = calculateTrainerFormIndex(starts);
  assert.equal(form.score, Math.round(70 * TRAINER_FORM_WEIGHTS.result + 80 * TRAINER_FORM_WEIGHTS.development));
  assert.equal(form.marketBlindScore, form.score);
  assert.equal(form.components.resultForm.marketBlind, true);
  assert.equal(form.components.development.marketBlind, true);
  assert.equal(Object.hasOwn(form.components, 'marketPerformance'), false);
});

test('person form uses at most 30 recent starts and refuses a score with fewer than three verified results', () => {
  const many = Array.from({ length:40 }, () => ({ resultScore:75, marketPerformanceScore:50 }));
  assert.equal(calculateDriverFormIndex(many).requestedStarts, PERSON_FORM_MAX_STARTS);
  const tooFew = calculateTrainerFormIndex([{ resultScore:100 }, { resultScore:90 }]);
  assert.equal(tooFew.score, null);
  assert.equal(tooFew.usedStarts, 2);
});
