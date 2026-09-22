import {
  getHorseDetailStatistics as getBaseHorseDetailStatistics,
  getHorseFilterOptions,
  getHorseRankings as getBaseHorseRankings,
  normalizeHorseStatsFilters
} from './horses.js';
import { getHorseStartPointHistory, getHorseStartPointRanking } from './horse-start-points.js';
import { getHorseRelevantPatterns } from './horse-patterns.js';
import { getHorseTopSpeedProfile } from './horse-top-speed.js';

export { getHorseFilterOptions, normalizeHorseStatsFilters };

export async function getHorseRankings(env, options = {}) {
  if (options.mode === 'core') return getBaseHorseRankings(env, options);
  const filters = normalizeHorseStatsFilters(options);
  if (options.mode === 'extended' && options.part === 'startpoints') {
    const highestStartPoints = await getHorseStartPointRanking(env, filters);
    return {filters,partial:true,rankings:{highestStartPoints},startPointsStatus:'verified_official_life_statistics'};
  }
  if (options.mode === 'extended' && options.part) return getBaseHorseRankings(env, options);
  const [data, highestStartPoints] = await Promise.all([
    getBaseHorseRankings(env, options),
    getHorseStartPointRanking(env, filters)
  ]);
  return {
    ...data,
    rankings: {
      ...data.rankings,
      highestStartPoints
    },
    startPointsStatus: 'verified_official_life_statistics'
  };
}

export async function getHorseDetailStatistics(env, horseId, options = {}) {
  const data = await getBaseHorseDetailStatistics(env, horseId, options);
  if (!data) return null;
  const [startPoints, patterns, topSpeed] = await Promise.all([
    getHorseStartPointHistory(env, data.horseId, data.filters.asOfDate),
    getHorseRelevantPatterns(env, data.horseId, data.filters.asOfDate),
    getHorseTopSpeedProfile(env, data.horseId, data.filters.asOfDate)
  ]);
  return {
    ...data,
    currentStartPoints: startPoints.current,
    startPointHistory: startPoints.history,
    startPointsStatus: 'verified_official_life_statistics',
    relevantPatterns: patterns,
    topSpeed
  };
}
