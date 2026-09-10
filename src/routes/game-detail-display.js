import { getGameHistoryDetail } from './games.js';

const ANALYSIS_EXCHANGE_VERSION = 'analysis-exchange-v1';
const REFERENCE_VERSION = 'reference-v1';

function analysisExchangeMeta(configJson) {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson);
    return parsed?.analysisExchange && typeof parsed.analysisExchange === 'object'
      ? parsed.analysisExchange
      : null;
  } catch {
    return null;
  }
}

function expectedModelVersion(system, roundId, exchangeModels) {
  if (!system.model_version_id) return null;
  if (system.feature_version !== ANALYSIS_EXCHANGE_VERSION) return system.model_version_id;

  const meta = analysisExchangeMeta(system.config_json);
  if (!meta || meta.roundId !== roundId) return null;
  if (meta.stage === 'pre_market') return system.model_version_id;
  if (meta.stage !== 'final' || !meta.parentSubmissionId) return null;

  const parent = exchangeModels.get(`${roundId}:${meta.parentSubmissionId}`);
  return parent?.meta?.stage === 'pre_market' ? parent.id : null;
}

function analysisIsEligibleAsExpected(system, analysis) {
  if (!analysis) return false;
  if (system.feature_version === REFERENCE_VERSION) return analysis.analysis_origin === 'reference_import';
  return Number(analysis.market_blind) === 1;
}

export async function getEnhancedGameHistoryDetail(env, roundId) {
  const detail = await getGameHistoryDetail(env, roundId);
  if (!detail) return null;

  const [{ results: systemRows }, { results: exchangeRows }, { results: analysisRows }] = await Promise.all([
    env.DB.prepare(`
      SELECT s.id AS system_id, s.model_version_id, mv.feature_version, mv.config_json
      FROM systems s
      LEFT JOIN model_versions mv ON mv.id = s.model_version_id
      WHERE s.game_round_id = ?
      ORDER BY s.id ASC
    `).bind(roundId).all(),
    env.DB.prepare(`
      SELECT id, config_json
      FROM model_versions
      WHERE feature_version = ?
      ORDER BY created_at ASC, id ASC
    `).bind(ANALYSIS_EXCHANGE_VERSION).all(),
    env.DB.prepare(`
      SELECT ara.model_version_id, gl.leg_number, ara.race_shape_summary,
             ara.market_blind, ara.analysis_origin, ara.data_snapshot_at, ara.created_at, ara.id
      FROM game_legs gl
      JOIN ai_race_analyses ara ON ara.race_id = gl.race_id
      WHERE gl.game_round_id = ?
      ORDER BY ara.model_version_id ASC, gl.leg_number ASC,
               datetime(ara.data_snapshot_at) DESC, datetime(ara.created_at) DESC, ara.id ASC
    `).bind(roundId).all()
  ]);

  const exchangeModels = new Map();
  for (const row of exchangeRows) {
    const meta = analysisExchangeMeta(row.config_json);
    if (meta?.roundId && meta?.submissionId) exchangeModels.set(`${meta.roundId}:${meta.submissionId}`, { id: row.id, meta });
  }

  const latestAnalysisByModelLeg = new Map();
  for (const row of analysisRows) {
    const key = `${row.model_version_id}:${Number(row.leg_number)}`;
    if (!latestAnalysisByModelLeg.has(key)) latestAnalysisByModelLeg.set(key, row);
  }

  const systemById = new Map(systemRows.map((row) => [row.system_id, row]));
  for (const leg of detail.legs || []) {
    for (const system of detail.systems || []) {
      const systemResult = leg.systems?.[system.id];
      if (!systemResult) continue;
      const systemRow = systemById.get(system.id);
      const modelVersionId = systemRow ? expectedModelVersion(systemRow, roundId, exchangeModels) : null;
      const analysis = modelVersionId
        ? latestAnalysisByModelLeg.get(`${modelVersionId}:${leg.legNumber}`) || null
        : null;
      systemResult.expectedRaceShape = systemRow && analysisIsEligibleAsExpected(systemRow, analysis)
        ? analysis.race_shape_summary || null
        : null;
    }
  }
  return detail;
}
