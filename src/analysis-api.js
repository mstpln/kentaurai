import { stableId } from './ids.js';
import {
  ANALYSIS_CONTEXT_VERSION,
  ANALYSIS_SUBMISSION_VERSION,
  getAnalysisContext,
  getAnalysisSubmission,
  importAnalysisSubmission,
  listAnalysisSubmissions
} from './analysis-exchange.js';
import { importVerifiedFinalAnalysis } from './analysis-final-import.js';
import { getVerifiedAnalysisMarket } from './analysis-market.js';
import { normalizeAnalysisModel, normalizeAnalysisProvider } from './analysis-provider.js';
import { getHorseRelevantPatternsBatch } from './statistics/horse-patterns.js';

const MAX_SUBMISSION_BYTES = 1024 * 1024;
const MARKET_BLIND_FEATURE_VERSIONS = new Set(['form-v2', 'class-exposure-v2', 'development-v2']);

function requiredText(value, field, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
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

async function stableContextFingerprint(context) {
  const { contextFingerprint: _old, generatedAt: _generatedAt, ...stable } = context;
  return sha256(stable);
}

function submissionId(value) {
  const text = requiredText(value, 'submission_id', 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) {
    throw new Error('submission_id must use lowercase letters, numbers and single hyphens only');
  }
  return text;
}

async function assertRoundOpenForAnalysis(env, roundId) {
  const row = await env.DB.prepare(`
    SELECT COALESCE(
      gr.bet_stop_at,
      gr.scheduled_start_at,
      (SELECT MIN(r.scheduled_start_at)
       FROM game_legs gl
       JOIN races r ON r.id = gl.race_id
       WHERE gl.game_round_id = gr.id)
    ) AS analysis_deadline
    FROM game_rounds gr
    WHERE gr.id = ? AND gr.game_type IN ('V85','V86')
    LIMIT 1
  `).bind(roundId).first();
  if (!row) throw new Error('V85/V86 round was not found');
  if (!row.analysis_deadline || !Number.isFinite(Date.parse(row.analysis_deadline))) {
    throw new Error('round has no verified pre-race analysis deadline');
  }
  if (Date.parse(row.analysis_deadline) <= Date.now()) {
    throw new Error('analysis exchange is pre-race only; this round has already reached its analysis deadline');
  }
  return row.analysis_deadline;
}

function systemSelections(system, index) {
  const selections = system?.selections;
  if (!Array.isArray(selections)) throw new Error(`systems[${index}].selections must be an array`);
  const grouped = new Map();
  for (const selection of selections) {
    const leg = Number(selection?.leg_number ?? selection?.legNumber);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8) throw new Error(`systems[${index}] contains an invalid leg number`);
    if (!grouped.has(leg)) grouped.set(leg, []);
    grouped.get(leg).push(selection);
  }
  return grouped;
}

function validateExactThreeSpikes(systems) {
  if (!Array.isArray(systems)) throw new Error('systems must be an array');
  for (let index = 0; index < systems.length; index += 1) {
    const grouped = systemSelections(systems[index], index);
    if (grouped.size !== 8) throw new Error(`systems[${index}] must contain selections for all eight legs`);
    let singletonLegs = 0;
    for (const selections of grouped.values()) {
      if (selections.length === 1) {
        singletonLegs += 1;
        const marked = selections[0].is_spike === true || selections[0].isSpike === true || Number(selections[0].is_spike ?? selections[0].isSpike ?? 0) === 1;
        if (!marked) throw new Error('every one-horse leg is a spike and must be marked is_spike=true');
      } else if (selections.some((selection) => selection.is_spike === true || selection.isSpike === true || Number(selection.is_spike ?? selection.isSpike ?? 0) === 1)) {
        throw new Error('a multi-horse leg cannot be marked as a spike');
      }
    }
    if (singletonLegs !== 3) throw new Error('every V85/V86 system must contain exactly three one-horse spike legs');
  }
}

function parentLegsForFinal(parent) {
  return parent.legs.map((leg) => ({
    legNumber: leg.legNumber,
    raceId: leg.raceId,
    scenarios: leg.scenarios,
    raceShapeSummary: leg.raceShapeSummary,
    conclusion: leg.conclusion,
    dataQuality: leg.dataQuality,
    predictions: leg.predictions.map((prediction) => ({
      raceEntryId: prediction.raceEntryId,
      winProbability: prediction.winProbability,
      uncertaintyLow: prediction.uncertaintyLow,
      uncertaintyHigh: prediction.uncertaintyHigh,
      rawRank: prediction.rawRank,
      abcdGroup: prediction.abcdGroup,
      scenarioRobustness: prediction.scenarioRobustness,
      reasoning: prediction.reasoning
    }))
  }));
}

function isolateMarketBlindContext(context) {
  const round = context.round ? { ...context.round } : null;
  if (round) {
    delete round.jackpotSek;
    delete round.turnoverSek;
  }
  const legs = (context.legs || []).map((leg) => ({
    ...leg,
    entries: (leg.entries || []).map((entry) => ({
      ...entry,
      features: (entry.features || []).filter((feature) => MARKET_BLIND_FEATURE_VERSIONS.has(feature.version))
    }))
  }));
  return { ...context, round, legs };
}

function withLegStartPointRanks(leg, patterns) {
  const entries = leg.entries || [];
  const ranked = entries
    .map((entry) => ({ entry, pattern: patterns.get(entry.horseId) }))
    .filter(({ pattern }) => pattern?.startPoints?.current)
    .sort((a, b) => b.pattern.startPoints.current.points - a.pattern.startPoints.current.points || a.entry.raceEntryId.localeCompare(b.entry.raceEntryId));
  const ranks = new Map();
  let priorPoints = null;
  let priorRank = 0;
  ranked.forEach(({ entry, pattern }, index) => {
    const points = pattern.startPoints.current.points;
    const rank = points === priorPoints ? priorRank : index + 1;
    ranks.set(entry.raceEntryId, { rank, observed: ranked.length });
    priorPoints = points;
    priorRank = rank;
  });
  return {
    ...leg,
    entries: entries.map((entry) => {
      const base = patterns.get(entry.horseId);
      if (!base) return { ...entry, relevantPatterns: null };
      const rank = ranks.get(entry.raceEntryId);
      return {
        ...entry,
        relevantPatterns: {
          ...base,
          startPoints: rank ? { ...base.startPoints, fieldRank: rank.rank, fieldObserved: rank.observed } : base.startPoints
        }
      };
    })
  };
}

async function addRelevantHorsePatterns(env, context) {
  const horseIds = [...new Set((context.legs || []).flatMap((leg) => (leg.entries || []).map((entry) => entry.horseId).filter(Boolean)))];
  if (!horseIds.length) return context;
  const asOfDate = context.round?.roundDate;
  if (!asOfDate) return context;
  const patterns = await getHorseRelevantPatternsBatch(env, horseIds, asOfDate, { historicalOnly: true });
  return {
    ...context,
    legs: (context.legs || []).map((leg) => withLegStartPointRanks(leg, patterns))
  };
}

export async function prepareAnalysisContext(env, roundId, stage = 'pre_market', options = {}) {
  const normalizedRoundId = requiredText(roundId, 'round_id', 200);
  await assertRoundOpenForAnalysis(env, normalizedRoundId);
  const normalizedStage = String(stage || 'pre_market').toLowerCase();
  const rawContext = await getAnalysisContext(env, normalizedRoundId, normalizedStage, options);
  let context;
  if (normalizedStage === 'pre_market') {
    context = await addRelevantHorsePatterns(env, isolateMarketBlindContext(rawContext));
  } else {
    const verifiedMarket = await getVerifiedAnalysisMarket(env, normalizedRoundId, rawContext.generatedAt);
    context = { ...rawContext, market: verifiedMarket };
  }
  const contextFingerprint = await stableContextFingerprint(context);
  const common = {
    ...context,
    contextFingerprint,
    submissionContractVersion: ANALYSIS_SUBMISSION_VERSION
  };
  if (normalizedStage === 'pre_market') {
    return {
      ...common,
      submissionRules: {
        submitStage: 'pre_market',
        systemsAllowed: false,
        probabilitiesPerLegMustSumTo: 1,
        rankingsMustCoverAllActiveEntries: true,
        abcdMeaning: 'relative winning strength, not value',
        acceptedFeatureVersions: [...MARKET_BLIND_FEATURE_VERSIONS],
        relevantPatternRule: 'Start Points development and verified X-Labs pace/distance summaries are factual context; fieldRank is within the current race leg. AI interprets them without changing raw facts.'
      }
    };
  }
  return {
    ...common,
    submissionRules: {
      submitStage: 'final',
      parentSubmissionRequired: true,
      strengthAssessmentIsCopiedFromParent: true,
      systemsMayBeSubmitted: true,
      exactlyThreeSpikeLegs: true,
      marketDefinitionVersion: context.market.definitionVersion,
      note: 'Final submission supplies recommendations and systems only; KentaurAI copies the stored market-blind race analysis unchanged.'
    }
  };
}

async function verifyContext(env, roundId, stage, fingerprint, parentSubmissionId = null) {
  const context = await prepareAnalysisContext(env, roundId, stage, {
    preMarketSubmissionId: parentSubmissionId
  });
  if (requiredText(fingerprint, 'context_fingerprint', 80).toLowerCase() !== context.contextFingerprint) {
    throw new Error('context_fingerprint is stale or does not match the current KentaurAI analysis context; fetch a fresh context before submitting');
  }
  return context;
}

function reusedSubmission(existing) {
  return {
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId: existing.submissionId,
    roundId: existing.roundId,
    stage: existing.stage,
    provider: existing.producer.provider,
    model: existing.producer.model,
    modelVersionId: stableId('analysis', existing.roundId, existing.submissionId),
    parentSubmissionId: existing.parentSubmissionId || null,
    reused: true,
    writes: { analyses: 0, predictions: 0, systems: 0, selections: 0 }
  };
}

async function storedClientPayloadDigest(env, modelVersionId) {
  const row = await env.DB.prepare('SELECT notes FROM model_versions WHERE id = ? LIMIT 1').bind(modelVersionId).first();
  if (!row?.notes) return null;
  try {
    const parsed = JSON.parse(row.notes);
    return parsed?.analysisExchangeClientPayloadDigest || null;
  } catch {
    return null;
  }
}

async function persistClientPayloadDigest(env, modelVersionId, digest) {
  const result = await env.DB.prepare(`
    UPDATE model_versions
    SET notes = ?
    WHERE id = ?
  `).bind(JSON.stringify({ analysisExchangeClientPayloadDigest: digest }), modelVersionId).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('analysis submission metadata could not be finalized');
}

export async function submitAnalysis(env, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('analysis submission must be an object');
  if ('data_snapshot_at' in payload || 'dataSnapshotAt' in payload) throw new Error('data_snapshot_at is assigned by KentaurAI and must not be supplied by the client');
  const roundId = requiredText(payload.round_id ?? payload.roundId, 'round_id', 200);
  const stage = requiredText(payload.stage, 'stage', 20).toLowerCase();
  const id = submissionId(payload.submission_id ?? payload.submissionId);
  const provider = normalizeAnalysisProvider(payload.producer?.provider);
  const model = normalizeAnalysisModel(payload.producer?.model);
  const contextFingerprint = payload.context_fingerprint ?? payload.contextFingerprint;
  const clientPayloadDigest = await sha256(payload);
  const modelVersionId = stableId('analysis', roundId, id);
  const existing = await getAnalysisSubmission(env, roundId, id);
  if (existing) {
    const requestedParent = payload.parent_submission_id ?? payload.parentSubmissionId ?? null;
    if (existing.stage !== stage || existing.producer.provider !== provider || existing.producer.model !== model || (existing.parentSubmissionId || null) !== requestedParent) {
      throw new Error('submission_id already exists for this round with different immutable identity metadata; use a new submission_id');
    }
    const storedDigest = await storedClientPayloadDigest(env, modelVersionId);
    if (!storedDigest || storedDigest !== clientPayloadDigest) {
      throw new Error('submission_id already exists with different content; use a new submission_id for a revised analysis');
    }
    return reusedSubmission(existing);
  }

  let result;
  if (stage === 'pre_market') {
    if (payload.parent_submission_id ?? payload.parentSubmissionId) throw new Error('pre-market submission cannot have a parent submission');
    if (Array.isArray(payload.systems) && payload.systems.length) throw new Error('pre-market submission cannot contain systems');
    await verifyContext(env, roundId, 'pre_market', contextFingerprint);
    result = await importAnalysisSubmission(env, {
      ...payload,
      contract_version: ANALYSIS_SUBMISSION_VERSION,
      submission_id: id,
      round_id: roundId,
      stage: 'pre_market',
      producer: { provider, model },
      data_snapshot_at: new Date().toISOString(),
      systems: []
    });
  } else {
    if (stage !== 'final') throw new Error('stage must be pre_market or final');
    const parentSubmissionId = submissionId(payload.parent_submission_id ?? payload.parentSubmissionId);
    if ('legs' in payload) throw new Error('final submission must not resend race rankings/strength analysis; KentaurAI copies the stored pre-market parent');
    const parent = await getAnalysisSubmission(env, roundId, parentSubmissionId);
    if (!parent || parent.stage !== 'pre_market') throw new Error('parent_submission_id must identify a stored pre-market submission for this round');
    if (parent.producer.provider !== provider) throw new Error('final submission producer.provider must match its pre-market parent');
    const verifiedContext = await verifyContext(env, roundId, 'market', contextFingerprint, parentSubmissionId);
    const systems = payload.systems ?? [];
    validateExactThreeSpikes(systems);
    result = await importVerifiedFinalAnalysis(env, {
      roundId,
      submissionId: id,
      parentSubmissionId,
      provider,
      model,
      analysisVersion: payload.analysis_version ?? payload.analysisVersion ?? null,
      contextFingerprint: verifiedContext.contextFingerprint,
      dataSnapshotAt: verifiedContext.market.cutoff,
      roundSummary: payload.round_summary ?? payload.roundSummary ?? null,
      recommendations: payload.recommendations ?? null,
      legs: parentLegsForFinal(parent),
      systems,
      market: verifiedContext.market
    });
  }

  await persistClientPayloadDigest(env, result.modelVersionId, clientPayloadDigest);
  return result;
}

export async function listAnalyzableRounds(env, options = {}) {
  const limitRaw = Number(options.limit ?? 20);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 100) : 20;
  const { results } = await env.DB.prepare(`
    SELECT gr.id, gr.game_type, gr.round_date, gr.scheduled_start_at, gr.bet_stop_at, gr.status,
           COUNT(gl.leg_number) AS leg_count
    FROM game_rounds gr
    LEFT JOIN game_legs gl ON gl.game_round_id = gr.id
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
    HAVING COUNT(gl.leg_number) = 8
    ORDER BY gr.round_date ASC, gr.scheduled_start_at ASC, gr.id ASC
    LIMIT ?
  `).bind(limit).all();
  return {
    contractVersion: ANALYSIS_CONTEXT_VERSION,
    rounds: results.map((row) => ({
      id: row.id,
      gameType: row.game_type,
      roundDate: row.round_date,
      scheduledStartAt: row.scheduled_start_at || null,
      betStopAt: row.bet_stop_at || null,
      status: row.status || null,
      legCount: Number(row.leg_count)
    }))
  };
}

export async function listRoundAnalysisSubmissions(env, roundId) {
  return listAnalysisSubmissions(env, roundId);
}

export async function getRoundAnalysisSubmission(env, roundId, submissionIdValue) {
  return getAnalysisSubmission(env, roundId, submissionIdValue);
}

export async function readAnalysisSubmissionJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('content-type must be application/json');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SUBMISSION_BYTES) throw new Error('analysis submission exceeds 1 MB limit');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SUBMISSION_BYTES) throw new Error('analysis submission exceeds 1 MB limit');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('analysis submission must contain valid JSON'); }
  return payload;
}
