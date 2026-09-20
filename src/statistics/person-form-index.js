import { resultPerformanceScore, weightedAvailable } from './horse-form-index.js';

export const PERSON_FORM_MAX_STARTS = 30;
export const PERSON_FORM_MIN_STARTS = 3;
export const PERSON_FORM_COMPONENT_MIN_STARTS = 3;
export const PERSON_FORM_RECENCY_DECAY = 0.94;
export const PERSON_FORM_PRIOR_STARTS = 3;

export const DRIVER_FORM_INDEX_VERSION = 'driver-form-index-v1';
export const DRIVER_MARKET_EXPECTATION_VERSION = 'market-rank-at-stop-v1';
export const TRAINER_FORM_INDEX_VERSION = 'trainer-form-index-v1';
export const TRAINER_DEVELOPMENT_VERSION = 'own-prior-results-v1';

export const DRIVER_FORM_WEIGHTS = Object.freeze({
  result: 0.60,
  marketPerformance: 0.40
});

export const TRAINER_FORM_WEIGHTS = Object.freeze({
  result: 0.60,
  development: 0.40
});

function finite(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function recencyWeight(index) {
  return PERSON_FORM_RECENCY_DECAY ** index;
}

function component(rows, key, minimum = PERSON_FORM_COMPONENT_MIN_STARTS) {
  const measured = rows
    .map((row, index) => ({ value:finite(row?.[key]), weight:recencyWeight(index) }))
    .filter((row) => row.value != null);
  if (measured.length < minimum) return { score:null, usedStarts:measured.length };
  const weight = measured.reduce((sum, row) => sum + row.weight, 0);
  const raw = measured.reduce((sum, row) => sum + (row.value * row.weight), 0) / weight;
  return { score:Math.round(clamp(raw, 1, 100)), usedStarts:measured.length };
}

function finalScore(resultScore, secondaryScore, weights) {
  if (resultScore == null) return null;
  const raw = weightedAvailable([
    { value:resultScore, weight:weights.result },
    { value:secondaryScore, weight:weights.secondary }
  ]);
  return raw == null ? null : Math.round(clamp(raw, 1, 100));
}

export function marketExpectationPerformanceScore({ placing, disqualified, fieldSize, marketRank } = {}) {
  const size = finite(fieldSize);
  const rank = finite(marketRank);
  if (size == null || rank == null || size < 1 || rank < 1 || rank > size) return null;
  const actual = resultPerformanceScore({ placing, disqualified, fieldSize:size });
  const expected = resultPerformanceScore({ placing:rank, disqualified:0, fieldSize:size });
  if (actual == null || expected == null) return null;
  return clamp(50 + ((actual - expected) / 2));
}

export function trainerDevelopmentScore({ resultScore, priorResultScores } = {}) {
  const current = finite(resultScore);
  const prior = (priorResultScores || []).map(finite).filter((value) => value != null).slice(0, PERSON_FORM_PRIOR_STARTS);
  if (current == null || !prior.length) return null;
  const baseline = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  return clamp(50 + ((current - baseline) / 2));
}

export function calculateDriverFormIndex(starts) {
  const rows = (Array.isArray(starts) ? starts : []).slice(0, PERSON_FORM_MAX_STARTS);
  const result = component(rows, 'resultScore', PERSON_FORM_MIN_STARTS);
  const marketPerformance = component(rows, 'marketPerformanceScore');
  const score = finalScore(result.score, marketPerformance.score, {
    result:DRIVER_FORM_WEIGHTS.result,
    secondary:DRIVER_FORM_WEIGHTS.marketPerformance
  });
  return {
    version:DRIVER_FORM_INDEX_VERSION,
    score,
    marketBlindScore:result.score,
    usedStarts:result.usedStarts,
    requestedStarts:rows.length,
    components:{
      resultForm:{ ...result, marketBlind:true },
      marketPerformance:{
        ...marketPerformance,
        marketBlind:false,
        definition:DRIVER_MARKET_EXPECTATION_VERSION
      }
    },
    weights:DRIVER_FORM_WEIGHTS,
    starts:rows.map((row, index) => ({ ...row, recencyWeight:recencyWeight(index) }))
  };
}

export function calculateTrainerFormIndex(starts) {
  const rows = (Array.isArray(starts) ? starts : []).slice(0, PERSON_FORM_MAX_STARTS);
  const result = component(rows, 'resultScore', PERSON_FORM_MIN_STARTS);
  const development = component(rows, 'developmentScore');
  const score = finalScore(result.score, development.score, {
    result:TRAINER_FORM_WEIGHTS.result,
    secondary:TRAINER_FORM_WEIGHTS.development
  });
  return {
    version:TRAINER_FORM_INDEX_VERSION,
    score,
    marketBlindScore:score,
    usedStarts:result.usedStarts,
    requestedStarts:rows.length,
    components:{
      resultForm:{ ...result, marketBlind:true },
      development:{
        ...development,
        marketBlind:true,
        definition:TRAINER_DEVELOPMENT_VERSION
      }
    },
    weights:TRAINER_FORM_WEIGHTS,
    starts:rows.map((row, index) => ({ ...row, recencyWeight:recencyWeight(index) }))
  };
}
