import { stableId } from './ids.js';
import { getVerifiedAnalysisMarket } from './analysis-market.js';
import { ANALYSIS_STEP_1_PROMPT } from './analysis-step-1-prompt.js';
import { ANALYSIS_STEP_2_PROMPT } from './analysis-step-2-prompt.js';

export const ANALYSIS_INPUT_VERSION = 'kentaurai-analysis-input-v2';
export const ANALYSIS_COMBINED_VERSION = 'kentaurai-analysis-v2';
const FEATURE_VERSION = 'analysis-exchange-v2';
const EXPORT_BATCH_SIZE = 500;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const PROBABILITY_TOLERANCE = 0.0001;
const MARKET_BLIND_FEATURE_VERSIONS = new Set(['form-v2', 'class-exposure-v2', 'development-v2']);
const EXCLUDED_TABLES = new Set(['d1_migrations']);
const ABCD_ORDER = new Map([['A', 0], ['B', 1], ['C', 2], ['D', 3]]);

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

function integer(value, field, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return number;
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'chatgpt' || provider === 'openai') return 'openai';
  if (provider === 'claude' || provider === 'anthropic') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}

function providerLabel(provider) {
  return provider === 'anthropic' ? 'Claude' : 'ChatGPT';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function stableWorkflowFingerprintInput(context) {
  if (!context?.market) return context;
  const { asOf: _asOf, cutoff: _cutoff, ...stableMarket } = context.market;
  return { ...context, market: stableMarket };
}

async function nextAnalyzableRound(env) {
  const row = await env.DB.prepare(`
    SELECT gr.id, gr.game_type, gr.round_date, gr.scheduled_start_at, gr.bet_stop_at, gr.status
    FROM game_rounds gr
    JOIN game_legs gl ON gl.game_round_id = gr.id
    WHERE gr.game_type IN ('V85','V86')
      AND datetime(COALESCE(
        gr.bet_stop_at,
        gr.scheduled_start_at,
        (SELECT MIN(r2.scheduled_start_at)
         FROM game_legs gl2
         JOIN races r2 ON r2.id = gl2.race_id
         WHERE gl2.game_round_id = gr.id)
      )) > CURRENT_TIMESTAMP
    GROUP BY gr.id
    HAVING COUNT(DISTINCT gl.leg_number) = 8
    ORDER BY gr.round_date ASC, gr.scheduled_start_at ASC, gr.id ASC
    LIMIT 1
  `).first();
  return row || null;
}

async function loadRoundIdentity(env, roundId) {
  const round = await env.DB.prepare(`
    SELECT id, game_type, round_date, scheduled_start_at, bet_stop_at, status
    FROM game_rounds
    WHERE id = ? AND game_type IN ('V85','V86')
    LIMIT 1
  `).bind(roundId).first();
  if (!round) throw new Error('V85/V86 round was not found');
  const { results } = await env.DB.prepare(`
    SELECT gl.leg_number, r.id AS race_id, r.race_number, r.scheduled_start_at,
           r.distance_m, r.start_method, t.canonical_name AS track_name,
           re.id AS race_entry_id, re.start_number, re.scratched, re.scratch_reason,
           h.id AS horse_id, h.canonical_name AS horse_name,
           d.canonical_name AS driver_name, tr.canonical_name AS trainer_name
    FROM game_legs gl
    JOIN races r ON r.id = gl.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    JOIN race_entries re ON re.race_id = r.id
    JOIN horses h ON h.id = re.horse_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN trainers tr ON tr.id = re.trainer_id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number, re.start_number, re.id
  `).bind(roundId).all();
  const legs = new Map();
  for (const row of results || []) {
    const legNumber = Number(row.leg_number);
    if (!legs.has(legNumber)) legs.set(legNumber, {
      legNumber,
      raceId: row.race_id,
      raceNumber: row.race_number == null ? null : Number(row.race_number),
      scheduledStartAt: row.scheduled_start_at || null,
      distanceM: row.distance_m == null ? null : Number(row.distance_m),
      startMethod: row.start_method || null,
      trackName: row.track_name || null,
      entries: []
    });
    legs.get(legNumber).entries.push({
      raceEntryId: row.race_entry_id,
      horseId: row.horse_id,
      horseName: row.horse_name,
      startNumber: row.start_number == null ? null : Number(row.start_number),
      scratched: Number(row.scratched) === 1,
      scratchReason: row.scratch_reason || null,
      driverName: row.driver_name || null,
      trainerName: row.trainer_name || null
    });
  }
  const orderedLegs = [...legs.values()];
  if (orderedLegs.length !== 8 || orderedLegs.some((leg, index) => leg.legNumber !== index + 1)) throw new Error('round must contain exactly eight ordered legs');
  return {
    round: {
      id: round.id,
      gameType: round.game_type,
      roundDate: round.round_date,
      scheduledStartAt: round.scheduled_start_at || null,
      betStopAt: round.bet_stop_at || null,
      status: round.status || null
    },
    legs: orderedLegs
  };
}

async function workflowContext(env, roundId = null, includeMarket = true) {
  const round = roundId ? { id: roundId } : await nextAnalyzableRound(env);
  if (!round) return null;
  const identity = await loadRoundIdentity(env, round.id);
  const generatedAt = new Date().toISOString();
  const market = includeMarket ? await getVerifiedAnalysisMarket(env, round.id, generatedAt) : null;
  const stable = {
    contractVersion: ANALYSIS_INPUT_VERSION,
    round: identity.round,
    legs: identity.legs,
    market
  };
  return {
    ...stable,
    generatedAt,
    contextFingerprint: await sha256(stableWorkflowFingerprintInput(stable))
  };
}

async function buildGuardPolicy(env, exportedAt) {
  const { results: rows } = await env.DB.prepare(`
    SELECT gr.id AS game_round_id, gl.race_id, re.id AS race_entry_id
    FROM game_rounds gr
    JOIN game_legs gl ON gl.game_round_id = gr.id
    JOIN race_entries re ON re.race_id = gl.race_id
    WHERE gr.game_type IN ('V85','V86')
      AND datetime(COALESCE(
        gr.bet_stop_at,
        gr.scheduled_start_at,
        (SELECT MIN(r2.scheduled_start_at)
         FROM game_legs gl2 JOIN races r2 ON r2.id = gl2.race_id
         WHERE gl2.game_round_id = gr.id)
      )) > datetime(?)
  `).bind(exportedAt).all();
  const guardedRoundIds = new Set();
  const guardedRaceIds = new Set();
  const guardedEntryIds = new Set();
  for (const row of rows || []) {
    guardedRoundIds.add(row.game_round_id);
    guardedRaceIds.add(row.race_id);
    guardedEntryIds.add(row.race_entry_id);
  }
  const guardedAnalysisIds = new Set();
  const guardedSystemIds = new Set();
  if (guardedRoundIds.size) {
    const { results: analyses } = await env.DB.prepare(`
      SELECT ara.id
      FROM ai_race_analyses ara
      JOIN game_legs gl ON gl.race_id = ara.race_id
      JOIN game_rounds gr ON gr.id = gl.game_round_id
      WHERE gr.game_type IN ('V85','V86')
        AND datetime(COALESCE(gr.bet_stop_at, gr.scheduled_start_at)) > datetime(?)
    `).bind(exportedAt).all();
    for (const row of analyses || []) guardedAnalysisIds.add(row.id);
    const { results: systems } = await env.DB.prepare(`
      SELECT s.id
      FROM systems s
      JOIN game_rounds gr ON gr.id = s.game_round_id
      WHERE gr.game_type IN ('V85','V86')
        AND datetime(COALESCE(gr.bet_stop_at, gr.scheduled_start_at)) > datetime(?)
    `).bind(exportedAt).all();
    for (const row of systems || []) guardedSystemIds.add(row.id);
  }
  return { guardedRoundIds, guardedRaceIds, guardedEntryIds, guardedAnalysisIds, guardedSystemIds };
}

function sanitizeExportRow(table, row, policy) {
  if (!policy) return row;
  if (table === 'game_rounds' && policy.guardedRoundIds.has(row.id)) return { ...row, jackpot_sek: null, turnover_sek: null };
  if (table === 'betting_snapshots' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'odds_snapshots' && policy.guardedEntryIds.has(row.race_entry_id)) return null;
  if (table === 'analysis_features' && policy.guardedEntryIds.has(row.race_entry_id) && !MARKET_BLIND_FEATURE_VERSIONS.has(row.feature_version)) return null;
  if (table === 'ai_race_analyses' && policy.guardedRaceIds.has(row.race_id)) return null;
  if (table === 'ai_horse_predictions' && policy.guardedAnalysisIds.has(row.ai_race_analysis_id)) return null;
  if (table === 'systems' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'system_selections' && policy.guardedSystemIds.has(row.system_id)) return null;
  if (table === 'post_race_reviews' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'model_versions') {
    try {
      const meta = JSON.parse(row.config_json || '{}')?.analysisExchange;
      if (meta?.roundId && policy.guardedRoundIds.has(meta.roundId)) return null;
    } catch {}
  }
  return row;
}

async function exportTableNames(env) {
  const { results } = await env.DB.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    ORDER BY name
  `).all();
  return (results || []).map((row) => row.name).filter((name) => !EXCLUDED_TABLES.has(name));
}

function exportFilename(provider, stage, exportedAt) {
  const stamp = exportedAt.replace(/[-:]/g, '').replace('.000', '').replace('T', '_');
  return `kentaurai-analysis-input_${provider}_${stage}_${stamp}.json`;
}

export async function createWorkflowDataExportResponse(env, providerValue, stageValue) {
  if (!env.DB) throw new Error('DB is not configured');
  const provider = normalizeProvider(providerValue);
  const stage = String(stageValue || 'pre_market').trim().toLowerCase();
  if (!['pre_market', 'market'].includes(stage)) throw new Error('stage must be pre_market or market');
  const exportedAt = new Date().toISOString();
  const [context, tableNames, policy] = await Promise.all([
    workflowContext(env, null, stage === 'market'),
    exportTableNames(env),
    stage === 'pre_market' ? buildGuardPolicy(env, exportedAt) : Promise.resolve(null)
  ]);
  if (!context) throw new Error('Ingen kommande V85/V86-omgång med åtta avdelningar hittades.');
  const metadata = {
    contract_version: ANALYSIS_INPUT_VERSION,
    exported_at: exportedAt,
    workflow_stage: stage,
    target_ai: providerLabel(provider),
    target_provider: provider,
    round_id: context.round.id,
    context_fingerprint: context.contextFingerprint,
    rule: stage === 'pre_market'
      ? 'Current market percentages, odds and market-derived current judgments are removed from open V85/V86 rounds.'
      : 'Market data is included. Reuse the already completed step-1 strength analysis unchanged.',
    analysis_context: context
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (value) => controller.enqueue(encoder.encode(value));
      try {
        write('{"metadata":');
        write(JSON.stringify(metadata));
        write(',"tables":{');
        let firstTable = true;
        for (const table of tableNames) {
          if (!firstTable) write(',');
          firstTable = false;
          write(`${JSON.stringify(table)}:[`);
          let firstRow = true;
          let lastRowId = 0;
          for (;;) {
            const query = `SELECT rowid AS __kentaurai_export_rowid, * FROM ${quoteIdentifier(table)} WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`;
            const { results } = await env.DB.prepare(query).bind(lastRowId, EXPORT_BATCH_SIZE).all();
            if (!results.length) break;
            for (const sourceRow of results) {
              lastRowId = Number(sourceRow.__kentaurai_export_rowid);
              const row = { ...sourceRow };
              delete row.__kentaurai_export_rowid;
              const safe = sanitizeExportRow(table, row, policy);
              if (!safe) continue;
              if (!firstRow) write(',');
              firstRow = false;
              write(JSON.stringify(safe));
            }
            if (results.length < EXPORT_BATCH_SIZE) break;
          }
          write(']');
        }
        write('}}');
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(provider, stage, exportedAt)}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

export function getAnalysisMethodPrompt(step) {
  if (String(step) === '1') return ANALYSIS_STEP_1_PROMPT;
  if (String(step) === '2') return ANALYSIS_STEP_2_PROMPT;
  throw new Error('step must be 1 or 2');
}

export async function getCombinedPromptContext(env, providerValue) {
  const provider = normalizeProvider(providerValue);
  const context = await workflowContext(env, null, true);
  if (!context) return null;
  return {
    export_stage: 'combined',
    provider,
    round_id: context.round.id,
    context_fingerprint: context.contextFingerprint,
    context
  };
}

function activeEntryIndex(context) {
  const byId = new Map();
  const byLeg = new Map();
  for (const leg of context.legs) {
    const active = leg.entries.filter((entry) => !entry.scratched);
    byLeg.set(leg.legNumber, { leg, active });
    for (const entry of active) byId.set(entry.raceEntryId, { legNumber: leg.legNumber, entry });
  }
  return { byId, byLeg };
}

function marketBlindText(value, field) {
  if (value == null) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/streck|odds|spelvär|värdekvot|break[- ]?even|marknad|överstreck|understreck|överspel|underspel/i.test(text)) {
    throw new Error(`${field} contains market language; combined legs must reproduce step 1 without market contamination`);
  }
}

function normalizePrediction(value, field, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  if ('market_percent' in value || 'marketPercent' in value || 'value_ratio' in value || 'valueRatio' in value) throw new Error(`${field} cannot contain market fields`);
  const raceEntryId = requiredText(value.race_entry_id ?? value.raceEntryId, `${field}.race_entry_id`, 200);
  if (!allowed.has(raceEntryId)) throw new Error(`${field}.race_entry_id does not belong to the active leg`);
  const probability = finiteNumber(value.win_probability ?? value.winProbability, `${field}.win_probability`, { min: 0, max: 1, nullable: false });
  const low = finiteNumber(value.uncertainty_low ?? value.uncertaintyLow, `${field}.uncertainty_low`, { min: 0, max: 1 });
  const high = finiteNumber(value.uncertainty_high ?? value.uncertaintyHigh, `${field}.uncertainty_high`, { min: 0, max: 1 });
  if (low != null && low > probability) throw new Error(`${field}.uncertainty_low cannot exceed win_probability`);
  if (high != null && high < probability) throw new Error(`${field}.uncertainty_high cannot be below win_probability`);
  const rawRank = integer(value.raw_rank ?? value.rawRank, `${field}.raw_rank`, { min: 1, max: allowed.size });
  const abcdGroup = requiredText(value.abcd_group ?? value.abcdGroup, `${field}.abcd_group`, 1).toUpperCase();
  if (!ABCD_ORDER.has(abcdGroup)) throw new Error(`${field}.abcd_group must be A, B, C or D`);
  marketBlindText(value.reasoning, `${field}.reasoning`);
  return {
    raceEntryId,
    winProbability: probability,
    uncertaintyLow: low,
    uncertaintyHigh: high,
    rawRank,
    abcdGroup,
    scenarioRobustness: finiteNumber(value.scenario_robustness ?? value.scenarioRobustness, `${field}.scenario_robustness`, { min: 0, max: 1 }),
    reasoning: value.reasoning ?? null
  };
}

function normalizeLegs(payload, context) {
  if (!Array.isArray(payload.legs) || payload.legs.length !== 8) throw new Error('combined submission must contain exactly eight legs from step 1');
  const { byLeg } = activeEntryIndex(context);
  const sorted = [...payload.legs].sort((a, b) => Number(a.leg_number ?? a.legNumber) - Number(b.leg_number ?? b.legNumber));
  return sorted.map((value, index) => {
    const legNumber = integer(value.leg_number ?? value.legNumber, `legs[${index}].leg_number`, { min: 1, max: 8 });
    if (legNumber !== index + 1) throw new Error('legs must map exactly to KentaurAI leg_number 1-8');
    const actual = byLeg.get(legNumber);
    const raceId = requiredText(value.race_id ?? value.raceId, `legs[${index}].race_id`, 200);
    if (raceId !== actual.leg.raceId) throw new Error(`leg ${legNumber} race_id does not match KentaurAI context`);
    const allowed = new Set(actual.active.map((entry) => entry.raceEntryId));
    if (!Array.isArray(value.predictions) || value.predictions.length !== allowed.size) throw new Error(`leg ${legNumber} predictions must cover every active entry exactly once`);
    const predictions = value.predictions.map((prediction, pIndex) => normalizePrediction(prediction, `legs[${index}].predictions[${pIndex}]`, allowed));
    if (new Set(predictions.map((p) => p.raceEntryId)).size !== predictions.length) throw new Error(`leg ${legNumber} contains duplicate predictions`);
    const byRank = [...predictions].sort((a, b) => a.rawRank - b.rawRank);
    byRank.forEach((prediction, rankIndex) => {
      if (prediction.rawRank !== rankIndex + 1) throw new Error(`leg ${legNumber} raw_rank must be unique and contiguous`);
      if (rankIndex && prediction.winProbability > byRank[rankIndex - 1].winProbability + PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} ranking conflicts with win_probability`);
      if (rankIndex && ABCD_ORDER.get(prediction.abcdGroup) < ABCD_ORDER.get(byRank[rankIndex - 1].abcdGroup)) throw new Error(`leg ${legNumber} ABCD groups must form contiguous strength bands along ranking`);
    });
    const total = predictions.reduce((sum, prediction) => sum + prediction.winProbability, 0);
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} win probabilities must sum to 1`);
    const scenarios = value.scenarios ?? null;
    const raceShapeSummary = optionalText(value.race_shape_summary ?? value.raceShapeSummary, `legs[${index}].race_shape_summary`);
    const conclusion = optionalText(value.conclusion, `legs[${index}].conclusion`);
    const dataQuality = optionalText(value.data_quality ?? value.dataQuality, `legs[${index}].data_quality`, 80) || 'unknown';
    marketBlindText(scenarios, `legs[${index}].scenarios`);
    marketBlindText(raceShapeSummary, `legs[${index}].race_shape_summary`);
    marketBlindText(conclusion, `legs[${index}].conclusion`);
    marketBlindText(dataQuality, `legs[${index}].data_quality`);
    return { legNumber, raceId, scenarios, raceShapeSummary, conclusion, dataQuality, predictions };
  });
}

function normalizeSystems(payload, context) {
  if (!Array.isArray(payload.systems) || payload.systems.length < 1) throw new Error('combined submission must contain at least one system');
  const gameType = context.round.gameType;
  const { byId } = activeEntryIndex(context);
  const systems = payload.systems.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`systems[${index}] must be an object`);
    const clientId = requiredText(value.system_id ?? value.systemId, `systems[${index}].system_id`, 120);
    const systemType = requiredText(value.system_type ?? value.systemType ?? 'main', `systems[${index}].system_type`, 30).toLowerCase();
    if (!['main', 'alternative'].includes(systemType)) throw new Error('system_type must be main or alternative');
    if (!Array.isArray(value.selections)) throw new Error(`systems[${index}].selections must be an array`);
    const byLeg = new Map();
    const selections = value.selections.map((selection, sIndex) => {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error(`systems[${index}].selections[${sIndex}] must be an object`);
      const legNumber = integer(selection.leg_number ?? selection.legNumber, `systems[${index}].selections[${sIndex}].leg_number`, { min: 1, max: 8 });
      const raceEntryId = requiredText(selection.race_entry_id ?? selection.raceEntryId, `systems[${index}].selections[${sIndex}].race_entry_id`, 200);
      const indexed = byId.get(raceEntryId);
      if (!indexed || indexed.legNumber !== legNumber) throw new Error(`system selection ${raceEntryId} does not belong to active leg ${legNumber}`);
      const normalized = {
        legNumber,
        raceEntryId,
        isSpike: selection.is_spike === true || selection.isSpike === true || Number(selection.is_spike ?? selection.isSpike ?? 0) === 1,
        selectionReason: optionalText(selection.selection_reason ?? selection.selectionReason, `systems[${index}].selections[${sIndex}].selection_reason`, 2000)
      };
      if (!byLeg.has(legNumber)) byLeg.set(legNumber, []);
      byLeg.get(legNumber).push(normalized);
      return normalized;
    });
    if (byLeg.size !== 8) throw new Error(`systems[${index}] must contain selections for all eight legs`);
    let spikeCount = 0;
    for (const legSelections of byLeg.values()) {
      if (new Set(legSelections.map((selection) => selection.raceEntryId)).size !== legSelections.length) throw new Error('system cannot select the same horse twice in a leg');
      if (legSelections.length === 1) {
        spikeCount += 1;
        if (!legSelections[0].isSpike) throw new Error('every one-horse leg must have is_spike=true');
      } else if (legSelections.some((selection) => selection.isSpike)) {
        throw new Error('multi-horse legs must have is_spike=false');
      }
    }
    const notes = optionalText(value.notes, `systems[${index}].notes`, 8000);
    const v85Main = gameType === 'V85' && systemType === 'main';
    if (v85Main) {
      if (![2, 3].includes(spikeCount)) throw new Error('V85 main system must contain two or three spike legs');
      if (spikeCount === 2 && !notes) throw new Error('V85 main system with two spikes requires a clear reason in notes');
    } else if (spikeCount !== 3) {
      throw new Error('all systems except V85 main must contain exactly three spike legs');
    }
    const rowCount = [...byLeg.values()].reduce((product, legSelections) => product * legSelections.length, 1);
    const expectedLinePrice = gameType === 'V85' ? 0.5 : 0.25;
    const linePriceSek = finiteNumber(value.line_price_sek ?? value.linePriceSek, `systems[${index}].line_price_sek`, { min: 0.0001, max: 1000, nullable: false });
    if (Math.abs(linePriceSek - expectedLinePrice) > 0.0001) throw new Error(`${gameType} line_price_sek must be ${expectedLinePrice}`);
    const budgetSek = finiteNumber(value.budget_sek ?? value.budgetSek, `systems[${index}].budget_sek`, { min: 0.01, max: 1_000_000, nullable: false });
    if (Math.abs(rowCount * linePriceSek - budgetSek) > 0.01) throw new Error('budget_sek must equal row count multiplied by line_price_sek');
    if ((gameType === 'V86' || systemType === 'alternative') && budgetSek > 144.01) throw new Error('personal system budget must not exceed 144 SEK');
    return {
      clientId,
      systemType,
      budgetSek,
      linePriceSek,
      rowCount,
      spikeCount,
      riskProfile: optionalText(value.risk_profile ?? value.riskProfile, `systems[${index}].risk_profile`, 100),
      notes,
      selections
    };
  });
  if (new Set(systems.map((system) => system.clientId)).size !== systems.length) throw new Error('system_id values must be unique');
  if (gameType === 'V85') {
    if (systems.length !== 2 || systems.filter((system) => system.systemType === 'main').length !== 1 || systems.filter((system) => system.systemType === 'alternative').length !== 1) {
      throw new Error('V85 combined submission must contain one main system and one alternative personal system');
    }
  } else if (systems.length !== 1) {
    throw new Error('V86 combined submission must contain exactly one system');
  }
  return systems;
}

function predictionMap(legs) {
  const map = new Map();
  for (const leg of legs) for (const prediction of leg.predictions) map.set(prediction.raceEntryId, prediction);
  return map;
}

function predictedHitProbability(system, predictions) {
  const byLeg = new Map();
  for (const selection of system.selections) {
    const probability = predictions.get(selection.raceEntryId)?.winProbability ?? 0;
    byLeg.set(selection.legNumber, (byLeg.get(selection.legNumber) || 0) + probability);
  }
  return [...byLeg.values()].reduce((product, value) => product * value, 1);
}

async function currentStoredSubmission(env, modelVersionId) {
  const row = await env.DB.prepare(`SELECT id, feature_version, ai_provider, ai_model, config_json FROM model_versions WHERE id = ? LIMIT 1`).bind(modelVersionId).first();
  if (!row) return null;
  let config = null;
  try { config = JSON.parse(row.config_json || '{}'); } catch {}
  return { row, meta: config?.analysisExchange || null };
}

export async function importCombinedAnalysis(env, payload) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('analysis submission must be an object');
  if ('analysis_blindness' in payload || 'analysisBlindness' in payload) throw new Error('analysis_blindness is assigned by KentaurAI and must not be supplied by the AI');
  if ('data_snapshot_at' in payload || 'dataSnapshotAt' in payload) throw new Error('data_snapshot_at is assigned by KentaurAI and must not be supplied by the AI');
  if ((payload.contract_version ?? payload.contractVersion) !== ANALYSIS_COMBINED_VERSION) throw new Error(`contract_version must be ${ANALYSIS_COMBINED_VERSION}`);
  if (String(payload.stage || '').toLowerCase() !== 'combined') throw new Error('stage must be combined');
  if (payload.parent_submission_id ?? payload.parentSubmissionId) throw new Error('combined submission must not have parent_submission_id');
  const submissionId = requiredText(payload.submission_id ?? payload.submissionId, 'submission_id', 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submissionId)) throw new Error('submission_id must use lowercase letters, numbers and single hyphens only');
  const roundId = requiredText(payload.round_id ?? payload.roundId, 'round_id', 200);
  const provider = normalizeProvider(payload.producer?.provider);
  const model = requiredText(payload.producer?.model, 'producer.model', 200);
  const context = await workflowContext(env, roundId, true);
  if (!context) throw new Error('round was not found');
  if (Date.parse(context.round.betStopAt || context.round.scheduledStartAt || 0) <= Date.now()) throw new Error('analysis import is pre-race only');
  const providedFingerprint = requiredText(payload.context_fingerprint ?? payload.contextFingerprint, 'context_fingerprint', 80).toLowerCase();
  if (providedFingerprint !== context.contextFingerprint) throw new Error('context_fingerprint is stale; copy a fresh import prompt before creating the file');
  const legs = normalizeLegs(payload, context);
  const systems = normalizeSystems(payload, context);
  const roundSummary = optionalText(payload.round_summary ?? payload.roundSummary, 'round_summary', 12000);
  const recommendations = payload.recommendations ?? null;
  const analysisVersion = optionalText(payload.analysis_version ?? payload.analysisVersion, 'analysis_version', 200);
  const normalized = {
    contractVersion: ANALYSIS_COMBINED_VERSION,
    submissionId,
    roundId,
    provider,
    model,
    analysisVersion,
    contextFingerprint: context.contextFingerprint,
    roundSummary,
    recommendations,
    legs,
    systems
  };
  const payloadDigest = await sha256(normalized);
  const modelVersionId = stableId('analysis', roundId, submissionId);
  const existing = await currentStoredSubmission(env, modelVersionId);
  if (existing) {
    if (existing.row.feature_version !== FEATURE_VERSION || existing.meta?.payloadDigest !== payloadDigest) throw new Error('submission_id already exists with different content; use a new submission_id');
    return {
      ok: true,
      contractVersion: ANALYSIS_COMBINED_VERSION,
      submissionId,
      roundId,
      stage: 'combined',
      provider,
      model,
      analysisBlindness: existing.meta.analysisBlindness,
      reused: true,
      writes: { analyses: 0, predictions: 0, systems: 0, selections: 0 }
    };
  }

  const market = context.market;
  const marketByEntry = new Map((market?.betting || []).map((row) => [row.raceEntryId, row]));
  const createdAt = new Date().toISOString();
  const dataSnapshotAt = market?.cutoff || createdAt;
  const analysisBlindness = 'declared_unsealed';
  const metadata = {
    analysisExchange: {
      contractVersion: ANALYSIS_COMBINED_VERSION,
      submissionId,
      roundId,
      stage: 'combined',
      parentSubmissionId: null,
      contextFingerprint: context.contextFingerprint,
      payloadDigest,
      dataSnapshotAt,
      roundSummary,
      recommendations,
      analysisBlindness
    }
  };
  await env.DB.prepare(`
    INSERT INTO model_versions
      (id, created_at, feature_version, prompt_version, ai_provider, ai_model, config_json, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(modelVersionId, createdAt, FEATURE_VERSION, analysisVersion, provider, model, JSON.stringify(metadata), 'Combined KentaurAI analysis submission; step-1 blindness declared but not separately sealed').run();

  let analysesWritten = 0;
  let predictionsWritten = 0;
  let systemsWritten = 0;
  let selectionsWritten = 0;
  const predictions = predictionMap(legs);
  for (const leg of legs) {
    const analysisId = stableId('race-analysis', modelVersionId, leg.raceId);
    const write = await env.DB.prepare(`
      INSERT INTO ai_race_analyses
        (id, race_id, model_version_id, data_snapshot_at, market_blind, scenarios_json,
         race_shape_summary, conclusion, data_quality, created_at, analysis_origin, method_note)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'analysis_exchange', 'combined:declared_unsealed')
    `).bind(
      analysisId, leg.raceId, modelVersionId, dataSnapshotAt,
      leg.scenarios == null ? null : JSON.stringify(leg.scenarios), leg.raceShapeSummary,
      leg.conclusion, leg.dataQuality, createdAt
    ).run();
    analysesWritten += Number(write.meta?.changes ?? 0);
    for (const prediction of leg.predictions) {
      const marketRow = marketByEntry.get(prediction.raceEntryId);
      const valueRatio = marketRow?.betPercent > 0 ? prediction.winProbability / (marketRow.betPercent / 100) : null;
      const predictionId = stableId('prediction', analysisId, prediction.raceEntryId);
      const pWrite = await env.DB.prepare(`
        INSERT INTO ai_horse_predictions
          (id, ai_race_analysis_id, race_entry_id, win_probability, uncertainty_low, uncertainty_high,
           raw_rank, abcd_group, value_ratio, scenario_robustness, reasoning_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        predictionId, analysisId, prediction.raceEntryId, prediction.winProbability,
        prediction.uncertaintyLow, prediction.uncertaintyHigh, prediction.rawRank, prediction.abcdGroup,
        valueRatio, prediction.scenarioRobustness,
        prediction.reasoning == null ? null : JSON.stringify(prediction.reasoning)
      ).run();
      predictionsWritten += Number(pWrite.meta?.changes ?? 0);
    }
  }

  for (const system of systems) {
    const systemId = stableId('system', modelVersionId, system.clientId);
    const hitProbability = predictedHitProbability(system, predictions);
    const sWrite = await env.DB.prepare(`
      INSERT INTO systems
        (id, game_round_id, model_version_id, system_type, budget_sek, row_count, line_price_sek,
         spike_count, estimated_hit_probability, estimated_market_ownership, value_metric, risk_profile,
         created_at, metrics_json, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `).bind(
      systemId, roundId, modelVersionId, system.systemType, system.budgetSek, system.rowCount,
      system.linePriceSek, system.spikeCount, hitProbability, system.riskProfile, createdAt,
      JSON.stringify({ calculation: FEATURE_VERSION, rowCountDerived: true, spikeCountDerived: true, analysisBlindness }),
      system.notes
    ).run();
    systemsWritten += Number(sWrite.meta?.changes ?? 0);
    for (const selection of system.selections) {
      const marketRow = marketByEntry.get(selection.raceEntryId);
      const prediction = predictions.get(selection.raceEntryId);
      const ssWrite = await env.DB.prepare(`
        INSERT INTO system_selections
          (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent, selection_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        systemId, selection.legNumber, selection.raceEntryId, selection.isSpike ? 1 : 0,
        prediction?.winProbability ?? null, marketRow?.betPercent ?? null, selection.selectionReason
      ).run();
      selectionsWritten += Number(ssWrite.meta?.changes ?? 0);
    }
  }

  return {
    ok: true,
    contractVersion: ANALYSIS_COMBINED_VERSION,
    submissionId,
    roundId,
    stage: 'combined',
    provider,
    model,
    analysisBlindness,
    reused: false,
    writes: { analyses: analysesWritten, predictions: predictionsWritten, systems: systemsWritten, selections: selectionsWritten }
  };
}

export async function readCombinedAnalysisUpload(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) throw new Error('analysfilen måste laddas upp som multipart/form-data');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) throw new Error('analysfilen är större än 1 MB');
  const form = await request.formData();
  const files = form.getAll('analysis_file');
  if (files.length !== 1 || typeof files[0]?.text !== 'function') throw new Error('välj exakt en JSON-fil med AI-analysen');
  const file = files[0];
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('analysfilen är större än 1 MB');
  if (file.name && !file.name.toLowerCase().endsWith('.json')) throw new Error('analysfilen måste vara en .json-fil');
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES) throw new Error('analysfilen är större än 1 MB');
  try { return JSON.parse(text); } catch { throw new Error('analysfilen innehåller inte giltig JSON'); }
}

export async function importCombinedAnalysisUpload(env, request) {
  return importCombinedAnalysis(env, await readCombinedAnalysisUpload(request));
}
