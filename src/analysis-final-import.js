import { stableId } from './ids.js';
import { ANALYSIS_SUBMISSION_VERSION } from './analysis-exchange.js';

const FEATURE_VERSION = 'analysis-exchange-v1';

function requiredText(value, field, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function optionalText(value, field, max = 8000) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return text;
}

function finiteNumber(value, field, { min = -Infinity, max = Infinity, nullable = true } = {}) {
  if (value == null && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field} must be a number between ${min} and ${max}`);
  return number;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeSystems(systems, legs) {
  if (!Array.isArray(systems)) throw new Error('systems must be an array');
  const allowedByLeg = new Map(legs.map((leg) => [leg.legNumber, new Set(leg.predictions.map((prediction) => prediction.raceEntryId))]));
  const normalized = systems.map((system, systemIndex) => {
    if (!system || typeof system !== 'object' || Array.isArray(system)) throw new Error(`systems[${systemIndex}] must be an object`);
    const clientId = requiredText(system.system_id ?? system.systemId, `systems[${systemIndex}].system_id`, 120);
    const systemType = requiredText(system.system_type ?? system.systemType ?? 'main', `systems[${systemIndex}].system_type`, 30).toLowerCase();
    if (!['main', 'alternative'].includes(systemType)) throw new Error('system_type must be main or alternative');
    if (!Array.isArray(system.selections)) throw new Error(`systems[${systemIndex}].selections must be an array`);

    const byLeg = new Map();
    const selections = system.selections.map((selection, selectionIndex) => {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error(`systems[${systemIndex}].selections[${selectionIndex}] must be an object`);
      if ('own_probability' in selection || 'ownProbability' in selection || 'market_percent' in selection || 'marketPercent' in selection) {
        throw new Error('system own_probability and market_percent are populated by KentaurAI from the stored analysis and verified market snapshot');
      }
      const legNumber = Number(selection.leg_number ?? selection.legNumber);
      if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) throw new Error(`systems[${systemIndex}] contains an invalid leg number`);
      const raceEntryId = requiredText(selection.race_entry_id ?? selection.raceEntryId, `systems[${systemIndex}].selections[${selectionIndex}].race_entry_id`, 200);
      if (!allowedByLeg.get(legNumber)?.has(raceEntryId)) throw new Error(`system selection ${raceEntryId} does not belong to active leg ${legNumber}`);
      const item = {
        legNumber,
        raceEntryId,
        isSpike: selection.is_spike === true || selection.isSpike === true || Number(selection.is_spike ?? selection.isSpike ?? 0) === 1,
        selectionReason: optionalText(selection.selection_reason ?? selection.selectionReason, `systems[${systemIndex}].selections[${selectionIndex}].selection_reason`, 2000)
      };
      if (!byLeg.has(legNumber)) byLeg.set(legNumber, []);
      byLeg.get(legNumber).push(item);
      return item;
    });

    if (byLeg.size !== 8) throw new Error('every system must select at least one horse in all eight legs');
    for (const legSelections of byLeg.values()) {
      if (new Set(legSelections.map((selection) => selection.raceEntryId)).size !== legSelections.length) throw new Error('system cannot select the same race entry twice in a leg');
      if (legSelections.some((selection) => selection.isSpike) && !(legSelections.length === 1 && legSelections[0].isSpike)) throw new Error('a spike leg must contain exactly one selected horse');
    }
    const spikeCount = [...byLeg.values()].filter((legSelections) => legSelections.length === 1 && legSelections[0].isSpike).length;
    if (spikeCount !== 3) throw new Error('every V85/V86 system must contain exactly three spike legs');
    const rowCount = [...byLeg.values()].reduce((rows, legSelections) => rows * legSelections.length, 1);
    const budgetSek = finiteNumber(system.budget_sek ?? system.budgetSek, `systems[${systemIndex}].budget_sek`, { min: 0.01, max: 1_000_000, nullable: false });
    const linePriceSek = finiteNumber(system.line_price_sek ?? system.linePriceSek, `systems[${systemIndex}].line_price_sek`, { min: 0.0001, max: 1000 });
    if (linePriceSek != null && Math.abs(rowCount * linePriceSek - budgetSek) > 0.01) throw new Error('system budget_sek must equal row count multiplied by line_price_sek when line price is supplied');
    return {
      clientId,
      systemType,
      budgetSek,
      linePriceSek,
      rowCount,
      spikeCount,
      riskProfile: optionalText(system.risk_profile ?? system.riskProfile, `systems[${systemIndex}].risk_profile`, 100),
      notes: optionalText(system.notes, `systems[${systemIndex}].notes`, 8000),
      selections
    };
  });
  if (new Set(normalized.map((system) => system.clientId)).size !== normalized.length) throw new Error('system_id values must be unique within a submission');
  return normalized;
}

function predictedHitProbability(system, predictionMap) {
  const byLeg = new Map();
  for (const selection of system.selections) {
    if (!byLeg.has(selection.legNumber)) byLeg.set(selection.legNumber, 0);
    byLeg.set(selection.legNumber, byLeg.get(selection.legNumber) + Number(predictionMap.get(selection.raceEntryId)?.winProbability ?? 0));
  }
  return [...byLeg.values()].reduce((product, probability) => product * probability, 1);
}

export async function importVerifiedFinalAnalysis(env, input) {
  if (!env?.DB || typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required for verified final analysis persistence');
  const roundId = requiredText(input.roundId, 'round_id', 200);
  const submissionId = requiredText(input.submissionId, 'submission_id', 100);
  const parentSubmissionId = requiredText(input.parentSubmissionId, 'parent_submission_id', 100);
  const provider = requiredText(input.provider, 'producer.provider', 100);
  const model = requiredText(input.model, 'producer.model', 200);
  const contextFingerprint = requiredText(input.contextFingerprint, 'context_fingerprint', 80).toLowerCase();
  const dataSnapshotAt = requiredText(input.dataSnapshotAt, 'data_snapshot_at', 80);
  if (!Number.isFinite(Date.parse(dataSnapshotAt))) throw new Error('data_snapshot_at must be a valid ISO date/time');
  if (!Array.isArray(input.legs) || input.legs.length !== 8) throw new Error('final analysis must contain exactly eight stored parent legs');
  if (!input.market || input.market.definitionVersion !== 'verified-market-at-stop-v1' || input.market.roundId !== roundId) {
    throw new Error('verified-market-at-stop-v1 for the same round is required for final analysis persistence');
  }
  if (input.market.cutoff !== dataSnapshotAt) throw new Error('final data_snapshot_at must equal the verified market cutoff');

  const systems = normalizeSystems(input.systems ?? [], input.legs);
  const market = new Map((input.market.betting || []).map((row) => [row.raceEntryId, row]));
  const predictionMap = new Map(input.legs.flatMap((leg) => leg.predictions.map((prediction) => [prediction.raceEntryId, prediction])));
  const modelVersionId = stableId('analysis', roundId, submissionId);
  const createdAt = new Date().toISOString();
  const serverPayloadDigest = await sha256({
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId,
    roundId,
    stage: 'final',
    parentSubmissionId,
    provider,
    model,
    analysisVersion: input.analysisVersion ?? null,
    dataSnapshotAt,
    contextFingerprint,
    roundSummary: input.roundSummary ?? null,
    recommendations: input.recommendations ?? null,
    legs: input.legs,
    systems
  });
  const metadata = {
    analysisExchange: {
      contractVersion: ANALYSIS_SUBMISSION_VERSION,
      submissionId,
      roundId,
      stage: 'final',
      parentSubmissionId,
      contextFingerprint,
      payloadDigest: serverPayloadDigest,
      dataSnapshotAt,
      roundSummary: input.roundSummary ?? null,
      recommendations: input.recommendations ?? null
    }
  };

  const statements = [];
  const kinds = [];
  statements.push(env.DB.prepare(`
    INSERT OR IGNORE INTO model_versions
      (id, created_at, feature_version, prompt_version, ai_provider, ai_model, config_json, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    modelVersionId, createdAt, FEATURE_VERSION, input.analysisVersion ?? null, provider, model,
    JSON.stringify(metadata), 'Provider-neutral KentaurAI analysis exchange submission'
  ));
  kinds.push('model');

  for (const leg of input.legs) {
    const analysisId = stableId('race-analysis', modelVersionId, leg.raceId);
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO ai_race_analyses
        (id, race_id, model_version_id, data_snapshot_at, market_blind, scenarios_json,
         race_shape_summary, conclusion, data_quality, created_at, analysis_origin, method_note)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'analysis_exchange', 'final')
    `).bind(
      analysisId, leg.raceId, modelVersionId, dataSnapshotAt,
      leg.scenarios == null ? null : JSON.stringify(leg.scenarios), leg.raceShapeSummary ?? null,
      leg.conclusion ?? null, leg.dataQuality ?? 'unknown', createdAt
    ));
    kinds.push('analysis');

    for (const prediction of leg.predictions) {
      const marketRow = market.get(prediction.raceEntryId);
      const valueRatio = marketRow?.betPercent > 0 ? prediction.winProbability / (marketRow.betPercent / 100) : null;
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO ai_horse_predictions
          (id, ai_race_analysis_id, race_entry_id, win_probability, uncertainty_low, uncertainty_high,
           raw_rank, abcd_group, value_ratio, scenario_robustness, reasoning_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        stableId('prediction', analysisId, prediction.raceEntryId), analysisId, prediction.raceEntryId,
        prediction.winProbability, prediction.uncertaintyLow ?? null, prediction.uncertaintyHigh ?? null,
        prediction.rawRank, prediction.abcdGroup, valueRatio, prediction.scenarioRobustness ?? null,
        prediction.reasoning == null ? null : JSON.stringify(prediction.reasoning)
      ));
      kinds.push('prediction');
    }
  }

  for (const system of systems) {
    const systemId = stableId('system', modelVersionId, system.clientId);
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO systems
        (id, game_round_id, model_version_id, system_type, budget_sek, row_count, line_price_sek,
         spike_count, estimated_hit_probability, estimated_market_ownership, value_metric, risk_profile,
         created_at, metrics_json, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, NULL, NULL, ?, ?, ?, ?)
    `).bind(
      systemId, roundId, modelVersionId, system.systemType, system.budgetSek, system.rowCount, system.linePriceSek,
      predictedHitProbability(system, predictionMap), system.riskProfile, createdAt,
      JSON.stringify({
        calculation: 'analysis-exchange-v1',
        marketDefinitionVersion: input.market.definitionVersion,
        marketCutoff: input.market.cutoff,
        rowCountDerived: true,
        spikeCountDerived: true,
        estimatedHitProbabilityDerived: true
      }),
      system.notes
    ));
    kinds.push('system');

    for (const selection of system.selections) {
      const prediction = predictionMap.get(selection.raceEntryId);
      const marketRow = market.get(selection.raceEntryId);
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO system_selections
          (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent, selection_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        systemId, selection.legNumber, selection.raceEntryId, selection.isSpike ? 1 : 0,
        prediction?.winProbability ?? null, marketRow?.betPercent ?? null, selection.selectionReason
      ));
      kinds.push('selection');
    }
  }

  const results = await env.DB.batch(statements);
  const changes = (kind) => results.reduce((sum, result, index) => sum + (kinds[index] === kind ? Number(result.meta?.changes ?? 0) : 0), 0);
  const writes = {
    analyses: changes('analysis'),
    predictions: changes('prediction'),
    systems: changes('system'),
    selections: changes('selection')
  };
  return {
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId,
    roundId,
    stage: 'final',
    provider,
    model,
    modelVersionId,
    parentSubmissionId,
    payloadDigest: serverPayloadDigest,
    reused: writes.analyses + writes.predictions + writes.systems + writes.selections === 0,
    writes
  };
}
