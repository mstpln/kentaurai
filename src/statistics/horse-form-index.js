export const HORSE_FORM_INDEX_VERSION = 'horse-form-index-v1';

export const HORSE_FORM_COMPONENT_WEIGHTS = Object.freeze({
  result: 0.30,
  difficulty: 0.30,
  work: 0.20,
  speed: 0.20
});

export const HORSE_FORM_RECENCY_WEIGHTS = Object.freeze([0.35, 0.25, 0.18, 0.13, 0.09]);

function finite(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function parsePaceSeconds(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s*min\/km$/i, '');
  const match = text.match(/^(\d+)[.:](\d{2})[,.](\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const tenths = Number(match[3]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || !Number.isInteger(tenths) || seconds > 59) return null;
  return (minutes * 60) + seconds + (tenths / 10);
}

export function fieldPercentileScore(value, values, { lowerIsBetter = false } = {}) {
  const target = finite(value);
  const measured = values.map(finite).filter((item) => item != null);
  if (target == null || measured.length < 2) return null;
  const equal = measured.filter((item) => item === target).length;
  const worse = lowerIsBetter
    ? measured.filter((item) => item > target).length
    : measured.filter((item) => item < target).length;
  const score = ((worse + Math.max(0, equal - 1) / 2) / (measured.length - 1)) * 100;
  return clamp(score);
}

export function resultPerformanceScore({ placing, disqualified, fieldSize }) {
  if (Number(disqualified) === 1) return 0;
  const place = finite(placing);
  const size = finite(fieldSize);
  if (place == null || size == null || place < 1 || size < 1) return null;
  if (size === 1) return place === 1 ? 100 : null;
  return clamp(((size - place) / (size - 1)) * 100);
}

export function relativeChallengeScore(opponentValue, targetValue) {
  const opponent = finite(opponentValue);
  const target = finite(targetValue);
  if (opponent == null || target == null || opponent < 0 || target < 0) return null;
  if (opponent === 0 && target === 0) return 50;
  return clamp((opponent / (opponent + target)) * 100);
}

export function weightedAvailable(parts) {
  const measured = parts.filter((part) => finite(part?.value) != null && finite(part?.weight) > 0);
  const totalWeight = measured.reduce((sum, part) => sum + Number(part.weight), 0);
  if (!(totalWeight > 0)) return null;
  return measured.reduce((sum, part) => sum + (Number(part.value) * Number(part.weight)), 0) / totalWeight;
}

export function calculateHorseFormIndex(starts) {
  const ordered = Array.isArray(starts) ? starts.slice(0, HORSE_FORM_RECENCY_WEIGHTS.length) : [];
  const scored = ordered.map((start, index) => {
    const components = {
      result: finite(start?.resultScore),
      difficulty: finite(start?.difficultyScore),
      work: finite(start?.workScore),
      speed: finite(start?.speedScore)
    };
    const performanceScore = weightedAvailable([
      { value: components.result, weight: HORSE_FORM_COMPONENT_WEIGHTS.result },
      { value: components.difficulty, weight: HORSE_FORM_COMPONENT_WEIGHTS.difficulty },
      { value: components.work, weight: HORSE_FORM_COMPONENT_WEIGHTS.work },
      { value: components.speed, weight: HORSE_FORM_COMPONENT_WEIGHTS.speed }
    ]);
    return {
      raceEntryId: start?.raceEntryId ?? null,
      raceId: start?.raceId ?? null,
      raceDate: start?.raceDate ?? null,
      components,
      performanceScore,
      recencyWeight: HORSE_FORM_RECENCY_WEIGHTS[index]
    };
  }).filter((start) => start.performanceScore != null);

  const recencyWeight = scored.reduce((sum, start) => sum + start.recencyWeight, 0);
  if (!(recencyWeight > 0)) {
    return {
      version: HORSE_FORM_INDEX_VERSION,
      score: null,
      usedStarts: 0,
      requestedStarts: ordered.length,
      starts: scored
    };
  }

  const raw = scored.reduce((sum, start) => sum + (start.performanceScore * start.recencyWeight), 0) / recencyWeight;
  return {
    version: HORSE_FORM_INDEX_VERSION,
    score: Math.round(clamp(raw, 1, 100)),
    usedStarts: scored.length,
    requestedStarts: ordered.length,
    starts: scored
  };
}
