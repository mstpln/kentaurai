import {
  KENTAURAI_APP_VERSION,
  createFullDataExportResponse,
  getSettingsStatus as getBaseSettingsStatus,
  importAnalysisUpload
} from './settings-data.js';

export { KENTAURAI_APP_VERSION, createFullDataExportResponse, importAnalysisUpload };

export function friendlyRunName(sourceType, fallback = 'Körning') {
  const value = String(sourceType || '').toLowerCase();
  if (value.includes('xlab')) return 'X-Labs';
  if (value.includes('post') && value.includes('race')) return 'Resultatgenomgång';
  if (value.includes('reference')) return 'Referensomgång';
  if (value.includes('editorial')) return 'Redaktionell import';
  if (value.includes('historical') && (value.includes('official') || value.includes('provider') || value.includes('race'))) {
    return 'Historiska lopp & resultat';
  }
  if (value.includes('live') || value.includes('calendar') || value.includes('game')) return 'Kommande V85/V86';
  if (value.includes('official') || value.includes('provider') || value.includes('race_capture')) return 'Lopp- och resultatdata';
  return fallback || 'Körning';
}

export async function getSettingsStatus(env) {
  const status = await getBaseSettingsStatus(env);
  return {
    ...status,
    recentRuns: (status.recentRuns || []).map((run) => ({
      ...run,
      name: friendlyRunName(run.sourceType, run.name)
    })),
    sources: (status.sources || []).map((source) => source.id === 'official'
      ? {
          ...source,
          name: 'Lopp- och resultatdata',
          description: 'Tävlingsprogram, hästar, kuskar, tränare, starter och resultat från den officiella tävlingskällan.'
        }
      : source.id === 'xlabs'
        ? {
            ...source,
            name: 'X-Labs',
            description: 'Direkta loppmätningar som tempo, faktisk distans och andra verifierade mätvärden.'
          }
        : source)
  };
}
