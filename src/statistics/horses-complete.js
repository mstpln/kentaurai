import {
  getHorseDetailStatistics as getBaseHorseDetailStatistics,
  getHorseFilterOptions,
  getHorseRankings as getBaseHorseRankings,
  normalizeHorseStatsFilters
} from './horses.js';
import { getHorseStartPointHistory, getHorseStartPointRanking } from './horse-start-points.js';

export { getHorseFilterOptions, normalizeHorseStatsFilters };

export async function getHorseRankings(env, options = {}) {
  const data = await getBaseHorseRankings(env, options);
  const highestStartPoints = await getHorseStartPointRanking(env, data.filters);
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
  const startPoints = await getHorseStartPointHistory(env, data.horseId, data.filters.asOfDate);
  return {
    ...data,
    currentStartPoints: startPoints.current,
    startPointHistory: startPoints.history,
    startPointsStatus: 'verified_official_life_statistics'
  };
}
