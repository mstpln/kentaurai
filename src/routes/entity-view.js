const SAFE_OBSERVATION_FIELDS = new Set([
  'location',
  'birthYear',
  'license',
  'homeTrackName',
  'ageYears',
  'sex',
  'nationality',
  'color',
  'careerEarningsSek',
  'owner',
  'breeder',
  'sireName',
  'damName',
  'damsireName'
]);

function safeObservation(observation) {
  if (!observation) return null;
  const fields = {};
  for (const [key, value] of Object.entries(observation.fields || {})) {
    if (SAFE_OBSERVATION_FIELDS.has(key)) fields[key] = value;
  }
  return {
    observedAt: observation.observedAt,
    qualityStatus: observation.qualityStatus,
    fields
  };
}

function safeFeature(feature) {
  if (!feature) return feature;
  const { provenance: _provenance, ...safe } = feature;
  return safe;
}

function safeAiAnalysis(analysis) {
  if (!analysis) return analysis;
  const {
    analysisId: _analysisId,
    modelVersionId: _modelVersionId,
    aiProvider: _aiProvider,
    ...safe
  } = analysis;
  return safe;
}

function safeStart(start) {
  const {
    entry_id: _entryId,
    race_id: _raceId,
    driver_id: _driverId,
    trainer_id: _trainerId,
    class_flags_json: _classFlagsJson,
    day_profile_json: _dayProfileJson,
    ...safe
  } = start;

  return {
    ...safe,
    features: (start.features || []).map(safeFeature),
    featureHistory: (start.featureHistory || []).map(safeFeature),
    aiAnalyses: (start.aiAnalyses || []).map(safeAiAnalysis)
  };
}

function appStats(stats) {
  const safe = { ...(stats || {}) };
  const resultStarts = Number(safe.resultStarts || 0);
  const gallops = Number(safe.gallops || 0);
  safe.gallopRate = resultStarts > 0 ? gallops / resultStarts : null;
  return safe;
}

export function toEntityAppView(detail) {
  if (!detail) return detail;
  return {
    ...detail,
    stats: appStats(detail.stats),
    latestObservation: safeObservation(detail.latestObservation),
    starts: (detail.starts || []).map(safeStart)
  };
}
