import { stableFeatureJson } from './analysis-v3-foundations.js';
import {
  PERFORMANCE_FEATURE_CONTRACT_VERSION,
  PERFORMANCE_FEATURE_VERSIONS,
  buildPerformanceFeaturesV3ForEntries
} from './performance-features-v3.js';
import {
  EQUIPMENT_RESPONSE_FEATURE_VERSION,
  buildEquipmentResponseV1ForEntries
} from './equipment-response-v1.js';
import {
  PERSON_CONTEXT_FEATURE_VERSION,
  buildPersonContextV1ForEntries
} from './person-context-v1.js';
import {
  RACE_PRIOR_FEATURE_VERSION,
  buildRacePriorsV1ForEntries
} from './race-priors-v1.js';
import {
  XLABS_EVIDENCE_PROFILE_VERSION,
  buildXlabsEvidenceProfilesForRace
} from './xlabs-evidence-profiles-v1.js';

export const REPLAY_CONTRACT_VERSION = 'kentaurai-replay-v1';
export const REPLAY_VERSION = 'replay-calibration-v1-f1';
export const REPLAY_TRACKS = Object.freeze(['sports_feature', 'v85_v86_decision']);
export const REPLAY_SCORE_VERSION = 'multiclass-logloss-brier-v1';
export const REPLAY_CALIBRATION_VERSION = 'fixed-bins-v1';
export const REPLAY_WALK_FORWARD_VERSION = 'expanding-window-v1';

const PROBABILITY_TOLERANCE = 1e-6;
const LOG_EPSILON = 1e-15;
const DEFAULT_CALIBRATION_BINS = 10;
const DEFAULT_MAX_TARGETS = 200;

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function exactIso(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function positiveInteger(value, field, max = 100000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`${field} must be an integer between 1 and ${max}`);
  }
  return number;
}

function nullablePositiveInteger(value, field, fallback) {
  if (value == null || value === '') return fallback;
  return positiveInteger(value, field);
}

function finiteProbability(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a probability between 0 and 1`);
  }
  return value;
}

function parseJson(value, field) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new Error(`${field} is invalid JSON`); }
}

function round(value, digits = 12) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function replayIdFromFingerprint(fingerprint) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(String(fingerprint || ''));
  if (!match) throw new Error('result_fingerprint must be sha256');
  return `replay_${match[1].slice(0, 32)}`;
}

function compareId(a, b) {
  return String(a).localeCompare(String(b));
}

function normalizeForecastEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('forecast must contain at least two entries');
  const seen = new Set();
  let sum = 0;
  const normalized = entries.map((entry, index) => {
    const raceEntryId = requiredText(entry?.race_entry_id ?? entry?.raceEntryId, `entries[${index}].race_entry_id`, 200);
    if (seen.has(raceEntryId)) throw new Error(`duplicate race_entry_id ${raceEntryId}`);
    seen.add(raceEntryId);
    const probability = finiteProbability(entry?.probability, `entries[${index}].probability`);
    sum += probability;
    return { race_entry_id: raceEntryId, probability };
  });
  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) throw new Error('forecast probabilities must sum to 1');
  normalized.sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return compareId(a.race_entry_id, b.race_entry_id);
  });
  return normalized;
}

export function scoreMulticlassForecastV1({ entries, winnerEntryId } = {}) {
  const normalized = normalizeForecastEntries(entries);
  const winner = requiredText(winnerEntryId, 'winnerEntryId', 200);
  const winnerIndex = normalized.findIndex((entry) => entry.race_entry_id === winner);
  if (winnerIndex < 0) throw new Error('winnerEntryId must be present in forecast');
  const winnerProbability = normalized[winnerIndex].probability;
  const logLoss = -Math.log(Math.max(LOG_EPSILON, winnerProbability));
  let brier = 0;
  for (const entry of normalized) {
    const observed = entry.race_entry_id === winner ? 1 : 0;
    brier += (entry.probability - observed) ** 2;
  }
  return {
    score_version: REPLAY_SCORE_VERSION,
    entry_count: normalized.length,
    winner_entry_id: winner,
    winner_probability: winnerProbability,
    winner_rank: winnerIndex + 1,
    top1_hit: winnerIndex === 0,
    log_loss: round(logLoss),
    brier_score: round(brier),
    forecast: normalized
  };
}

export function buildCalibrationSummaryV1(scoredTargets, bins = DEFAULT_CALIBRATION_BINS) {
  const binCount = positiveInteger(bins, 'bins', 100);
  if (!Array.isArray(scoredTargets)) throw new Error('scoredTargets must be an array');
  const buckets = Array.from({ length: binCount }, (_, index) => ({
    bin_index: index,
    probability_low: index / binCount,
    probability_high: (index + 1) / binCount,
    count: 0,
    probability_sum: 0,
    observed_sum: 0
  }));
  for (const target of scoredTargets) {
    const winner = requiredText(target?.winner_entry_id, 'scored target winner_entry_id', 200);
    const forecast = normalizeForecastEntries(target?.forecast);
    for (const entry of forecast) {
      const rawIndex = Math.floor(entry.probability * binCount);
      const index = Math.min(binCount - 1, Math.max(0, rawIndex));
      const bucket = buckets[index];
      bucket.count += 1;
      bucket.probability_sum += entry.probability;
      bucket.observed_sum += entry.race_entry_id === winner ? 1 : 0;
    }
  }
  let total = 0;
  let weightedGap = 0;
  const normalized = buckets.map((bucket) => {
    const meanProbability = bucket.count ? bucket.probability_sum / bucket.count : null;
    const observedFrequency = bucket.count ? bucket.observed_sum / bucket.count : null;
    const absoluteGap = bucket.count ? Math.abs(meanProbability - observedFrequency) : null;
    total += bucket.count;
    if (bucket.count) weightedGap += absoluteGap * bucket.count;
    return {
      bin_index: bucket.bin_index,
      probability_low: round(bucket.probability_low),
      probability_high: round(bucket.probability_high),
      count: bucket.count,
      mean_probability: round(meanProbability),
      observed_frequency: round(observedFrequency),
      absolute_gap: round(absoluteGap)
    };
  });
  return {
    calibration_version: REPLAY_CALIBRATION_VERSION,
    bin_count: binCount,
    prediction_count: total,
    expected_calibration_error: total ? round(weightedGap / total) : null,
    bins: normalized
  };
}

function summarizeScores(scoredTargets) {
  if (!Array.isArray(scoredTargets)) throw new Error('scoredTargets must be an array');
  const count = scoredTargets.length;
  if (!count) return {
    target_count: 0,
    mean_log_loss: null,
    mean_brier_score: null,
    top1_accuracy: null,
    mean_winner_rank: null,
    calibration: buildCalibrationSummaryV1([])
  };
  return {
    target_count: count,
    mean_log_loss: round(scoredTargets.reduce((sum, item) => sum + item.log_loss, 0) / count),
    mean_brier_score: round(scoredTargets.reduce((sum, item) => sum + item.brier_score, 0) / count),
    top1_accuracy: round(scoredTargets.reduce((sum, item) => sum + (item.top1_hit ? 1 : 0), 0) / count),
    mean_winner_rank: round(scoredTargets.reduce((sum, item) => sum + item.winner_rank, 0) / count),
    calibration: buildCalibrationSummaryV1(scoredTargets)
  };
}

function normalizeWalkForwardPolicy(policy = {}) {
  const minTrainGroups = nullablePositiveInteger(policy.min_train_groups ?? policy.minTrainGroups, 'min_train_groups', 10);
  const calibrationGroups = nullablePositiveInteger(policy.calibration_groups ?? policy.calibrationGroups, 'calibration_groups', 5);
  const testGroups = nullablePositiveInteger(policy.test_groups ?? policy.testGroups, 'test_groups', 5);
  const stepGroups = nullablePositiveInteger(policy.step_groups ?? policy.stepGroups, 'step_groups', testGroups);
  return {
    version: REPLAY_WALK_FORWARD_VERSION,
    min_train_groups: minTrainGroups,
    calibration_groups: calibrationGroups,
    test_groups: testGroups,
    step_groups: stepGroups
  };
}

export function buildWalkForwardFoldsV1(targets, policy = {}) {
  if (!Array.isArray(targets)) throw new Error('targets must be an array');
  const normalizedPolicy = normalizeWalkForwardPolicy(policy);
  const grouped = new Map();
  for (const target of targets) {
    const groupId = requiredText(target?.target_group_id ?? target?.targetGroupId, 'target_group_id', 200);
    const targetAt = exactIso(target?.target_group_at ?? target?.targetGroupAt ?? target?.target_at ?? target?.targetAt, 'target_group_at');
    const current = grouped.get(groupId);
    if (current && current.target_at !== targetAt) throw new Error('target_group_id cannot contain mixed group times');
    if (!current) grouped.set(groupId, { group_id: groupId, target_at: targetAt });
  }
  const groups = [...grouped.values()].sort((a, b) => {
    const time = Date.parse(a.target_at) - Date.parse(b.target_at);
    return time || compareId(a.group_id, b.group_id);
  });
  const folds = [];
  let trainEnd = normalizedPolicy.min_train_groups;
  let foldIndex = 0;
  while (trainEnd + normalizedPolicy.calibration_groups + normalizedPolicy.test_groups <= groups.length) {
    const calibrationEnd = trainEnd + normalizedPolicy.calibration_groups;
    const testEnd = calibrationEnd + normalizedPolicy.test_groups;
    folds.push({
      fold_index: foldIndex,
      train_group_ids: groups.slice(0, trainEnd).map((group) => group.group_id),
      calibration_group_ids: groups.slice(trainEnd, calibrationEnd).map((group) => group.group_id),
      test_group_ids: groups.slice(calibrationEnd, testEnd).map((group) => group.group_id),
      train_through: groups[trainEnd - 1]?.target_at ?? null,
      calibration_through: groups[calibrationEnd - 1]?.target_at ?? null,
      test_through: groups[testEnd - 1]?.target_at ?? null
    });
    foldIndex += 1;
    trainEnd += normalizedPolicy.step_groups;
  }
  return {
    policy: normalizedPolicy,
    group_count: groups.length,
    folds
  };
}

function testGroupSet(folds) {
  const out = new Set();
  for (const fold of folds) for (const groupId of fold.test_group_ids) out.add(groupId);
  return out;
}

function normalizeAblations(ablations = []) {
  if (!Array.isArray(ablations)) throw new Error('ablations must be an array');
  const ids = new Set();
  return ablations.map((ablation, index) => {
    const id = requiredText(ablation?.id, `ablations[${index}].id`, 120);
    if (ids.has(id)) throw new Error(`duplicate ablation id ${id}`);
    ids.add(id);
    const featureFamily = requiredText(ablation?.feature_family ?? ablation?.featureFamily, `ablations[${index}].feature_family`, 160);
    const mode = requiredText(ablation?.mode, `ablations[${index}].mode`, 20);
    if (!['add', 'remove'].includes(mode)) throw new Error('ablation mode must be add or remove');
    return { id, feature_family: featureFamily, mode };
  });
}

export function buildAblationFeatureSetsV1(allFamilies, baselineFamilies, ablations = []) {
  if (!Array.isArray(allFamilies) || !Array.isArray(baselineFamilies)) throw new Error('feature family lists must be arrays');
  const available = [...new Set(allFamilies.map((value) => requiredText(value, 'feature family', 160)))].sort();
  const availableSet = new Set(available);
  const baseline = [...new Set(baselineFamilies.map((value) => requiredText(value, 'baseline feature family', 160)))].sort();
  for (const family of baseline) if (!availableSet.has(family)) throw new Error(`baseline feature family ${family} is unavailable`);
  const normalizedAblations = normalizeAblations(ablations);
  const variants = [{ id: 'baseline', feature_families: baseline }];
  for (const ablation of normalizedAblations) {
    if (!availableSet.has(ablation.feature_family)) throw new Error(`ablation feature family ${ablation.feature_family} is unavailable`);
    const next = new Set(baseline);
    if (ablation.mode === 'remove') {
      if (!next.has(ablation.feature_family)) throw new Error(`remove ablation ${ablation.id} must target a baseline family`);
      next.delete(ablation.feature_family);
    } else {
      if (next.has(ablation.feature_family)) throw new Error(`add ablation ${ablation.id} must target a non-baseline family`);
      next.add(ablation.feature_family);
    }
    const changed = [...new Set([...baseline.filter((family) => !next.has(family)), ...[...next].filter((family) => !baseline.includes(family))])];
    if (changed.length !== 1 || changed[0] !== ablation.feature_family) {
      throw new Error(`ablation ${ablation.id} must change only its declared feature family`);
    }
    variants.push({ id: ablation.id, feature_families: [...next].sort(), ablation });
  }
  return { available_families: available, baseline_families: baseline, variants };
}

export function selectFeatureViewV1(featureBundle, activeFamilies) {
  if (!featureBundle || typeof featureBundle !== 'object' || Array.isArray(featureBundle)) throw new Error('featureBundle must be an object');
  const families = Array.isArray(activeFamilies) ? activeFamilies : [];
  const selected = {};
  for (const family of families) {
    if (!(family in featureBundle)) throw new Error(`requested feature family ${family} is unavailable in bundle`);
    selected[family] = featureBundle[family];
  }
  return selected;
}

function resultSourceVersionMetadata() {
  return {
    score_version: REPLAY_SCORE_VERSION,
    calibration_version: REPLAY_CALIBRATION_VERSION,
    walk_forward_version: REPLAY_WALK_FORWARD_VERSION,
    performance_contract_version: PERFORMANCE_FEATURE_CONTRACT_VERSION,
    performance_feature_versions: PERFORMANCE_FEATURE_VERSIONS,
    equipment_feature_version: EQUIPMENT_RESPONSE_FEATURE_VERSION,
    person_context_feature_version: PERSON_CONTEXT_FEATURE_VERSION,
    race_prior_feature_version: RACE_PRIOR_FEATURE_VERSION,
    xlabs_evidence_profile_version: XLABS_EVIDENCE_PROFILE_VERSION
  };
}

async function buildSportsFeatureBundleForRace(env, target, requiredFamilies) {
  const entryIds = target.entry_ids;
  const asOf = target.target_at;
  const needed = new Set(requiredFamilies);
  const performanceNames = new Set(['capacity','form','class_context','development','method_distance','rest_readiness','gallop_risk']);
  const needsPerformance = [...needed].some((family) => performanceNames.has(family));

  const [performance, equipment, person, priors, xlabs] = await Promise.all([
    needsPerformance ? buildPerformanceFeaturesV3ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('equipment_response') ? buildEquipmentResponseV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('person_context') ? buildPersonContextV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('race_priors') ? buildRacePriorsV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('xlabs_evidence') ? buildXlabsEvidenceProfilesForRace(env, { raceId: target.race_id, asOf }) : Promise.resolve({ profiles: [] })
  ]);
  const xlabsByEntry = new Map((xlabs.profiles || []).map((profile) => [profile.race_entry_id, profile]));
  const out = new Map();
  for (const entryId of entryIds) {
    const perf = performance.get(entryId) || null;
    const bundle = {};
    if (needed.has('capacity')) bundle.capacity = perf?.families?.capacity ?? null;
    if (needed.has('form')) bundle.form = perf?.families?.form ?? null;
    if (needed.has('class_context')) bundle.class_context = perf?.families?.classContext ?? null;
    if (needed.has('development')) bundle.development = perf?.families?.development ?? null;
    if (needed.has('method_distance')) bundle.method_distance = perf?.families?.methodDistance ?? null;
    if (needed.has('rest_readiness')) bundle.rest_readiness = perf?.families?.restReadiness ?? null;
    if (needed.has('gallop_risk')) bundle.gallop_risk = perf?.families?.gallopRisk ?? null;
    if (needed.has('equipment_response')) bundle.equipment_response = equipment.get(entryId) ?? null;
    if (needed.has('person_context')) bundle.person_context = person.get(entryId) ?? null;
    if (needed.has('race_priors')) bundle.race_priors = priors.get(entryId) ?? null;
    if (needed.has('xlabs_evidence')) bundle.xlabs_evidence = xlabsByEntry.get(entryId) ?? null;
    out.set(entryId, bundle);
  }
  return out;
}

const SPORTS_FAMILIES = Object.freeze([
  'capacity',
  'form',
  'class_context',
  'development',
  'method_distance',
  'rest_readiness',
  'gallop_risk',
  'equipment_response',
  'person_context',
  'race_priors',
  'xlabs_evidence'
]);

async function loadSportsTargets(env, config) {
  const from = exactIso(config.from, 'from');
  const to = exactIso(config.to, 'to');
  if (Date.parse(from) > Date.parse(to)) throw new Error('from must not be after to');
  const maxTargets = nullablePositiveInteger(config.max_targets ?? config.maxTargets, 'max_targets', DEFAULT_MAX_TARGETS);
  const { results } = await env.DB.prepare(`
    SELECT r.id AS race_id,r.scheduled_start_at,r.race_date
    FROM races r
    WHERE r.scheduled_start_at IS NOT NULL
      AND datetime(r.scheduled_start_at)>=datetime(?)
      AND datetime(r.scheduled_start_at)<=datetime(?)
      AND NOT EXISTS (SELECT 1 FROM game_legs gl WHERE gl.race_id=r.id)
      AND (SELECT COUNT(*) FROM race_entries re WHERE re.race_id=r.id AND COALESCE(re.scratched,0)=0)>=2
      AND (SELECT COUNT(*) FROM race_entries re JOIN race_results rr ON rr.race_entry_id=re.id WHERE re.race_id=r.id AND rr.placing=1)=1
    ORDER BY datetime(r.scheduled_start_at),r.id
    LIMIT ?
  `).bind(from, to, maxTargets).all();

  const targets = [];
  for (const row of results || []) {
    const { results: entries } = await env.DB.prepare(`
      SELECT re.id AS race_entry_id,rr.placing
      FROM race_entries re
      LEFT JOIN race_results rr ON rr.race_entry_id=re.id
      WHERE re.race_id=? AND COALESCE(re.scratched,0)=0
      ORDER BY re.start_number,re.id
    `).bind(row.race_id).all();
    const winnerRows = entries.filter((entry) => Number(entry.placing) === 1);
    if (winnerRows.length !== 1) continue;
    targets.push({
      target_id: row.race_id,
      target_group_id: row.race_id,
      target_at: exactIso(row.scheduled_start_at, 'race scheduled_start_at'),
      race_id: row.race_id,
      winner_entry_id: winnerRows[0].race_entry_id,
      entry_ids: entries.map((entry) => entry.race_entry_id)
    });
  }
  return targets;
}

async function forecastForVariant(producer, target, bundles, variant) {
  const inputs = target.entry_ids.map((entryId) => ({
    race_entry_id: entryId,
    features: selectFeatureViewV1(bundles.get(entryId), variant.feature_families)
  }));
  const output = await producer.predict({
    target: {
      target_id: target.target_id,
      race_id: target.race_id,
      target_at: target.target_at,
      entry_ids: [...target.entry_ids]
    },
    feature_families: [...variant.feature_families],
    entries: inputs
  });
  const entries = Array.isArray(output) ? output : output?.entries;
  return scoreMulticlassForecastV1({ entries, winnerEntryId: target.winner_entry_id });
}

async function evaluationFingerprintV1(evaluations) {
  const normalized = [...(evaluations || [])]
    .map((evaluation) => ({
      target_id: evaluation.target_id,
      target_group_id: evaluation.target_group_id,
      target_at: evaluation.target_at,
      forecast_variant: evaluation.forecast_variant,
      winner_entry_id: evaluation.winner_entry_id,
      entry_count: evaluation.entry_count,
      log_loss: evaluation.log_loss,
      brier_score: evaluation.brier_score,
      top1_hit: Boolean(evaluation.top1_hit),
      winner_rank: evaluation.winner_rank,
      forecast: evaluation.forecast
    }))
    .sort((a, b) =>
      compareId(a.target_group_id, b.target_group_id)
      || Date.parse(a.target_at) - Date.parse(b.target_at)
      || compareId(a.target_id, b.target_id)
      || compareId(a.forecast_variant, b.forecast_variant)
    );
  return sha256Text(stableFeatureJson(normalized));
}

function uniqueDecisionLineages(targets) {
  const map = new Map();
  for (const target of targets) {
    const key = stableFeatureJson({
      target_group_id: target.target_group_id,
      decision_run_id: target.decision_run_id,
      version_metadata: target.version_metadata
    });
    map.set(key, {
      target_group_id: target.target_group_id,
      decision_run_id: target.decision_run_id,
      version_metadata: target.version_metadata
    });
  }
  return [...map.values()].sort((a, b) =>
    compareId(a.target_group_id, b.target_group_id) || compareId(a.decision_run_id, b.decision_run_id)
  );
}

function foldFilteredScores(scored, walkForward) {
  const groups = testGroupSet(walkForward.folds);
  return scored.filter((item) => groups.has(item.target_group_id));
}

function ablationResultsFromVariantScores(featureSets, scoresByVariant, walkForward) {
  const baselineScores = foldFilteredScores(scoresByVariant.get('baseline') || [], walkForward);
  const baselineSummary = summarizeScores(baselineScores);
  const results = [];
  for (const variant of featureSets.variants) {
    if (variant.id === 'baseline') continue;
    const candidateScores = foldFilteredScores(scoresByVariant.get(variant.id) || [], walkForward);
    const candidateSummary = summarizeScores(candidateScores);
    results.push({
      ablation_id: variant.id,
      feature_family: variant.ablation.feature_family,
      mode: variant.ablation.mode,
      baseline_variant: 'baseline',
      candidate_variant: variant.id,
      target_count: Math.min(baselineSummary.target_count, candidateSummary.target_count),
      baseline_log_loss: baselineSummary.mean_log_loss,
      candidate_log_loss: candidateSummary.mean_log_loss,
      delta_log_loss: baselineSummary.mean_log_loss == null || candidateSummary.mean_log_loss == null
        ? null : round(candidateSummary.mean_log_loss - baselineSummary.mean_log_loss),
      baseline_brier: baselineSummary.mean_brier_score,
      candidate_brier: candidateSummary.mean_brier_score,
      delta_brier: baselineSummary.mean_brier_score == null || candidateSummary.mean_brier_score == null
        ? null : round(candidateSummary.mean_brier_score - baselineSummary.mean_brier_score),
      baseline_summary: baselineSummary,
      candidate_summary: candidateSummary
    });
  }
  return { baseline_summary: baselineSummary, ablations: results };
}

export async function runSportsFeatureReplayV1(env, config = {}, forecastProducer) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!forecastProducer || typeof forecastProducer.predict !== 'function') throw new Error('forecastProducer.predict is required');
  const producerVersion = requiredText(forecastProducer.version, 'forecastProducer.version', 160);
  const targets = await loadSportsTargets(env, config);
  const featureSets = buildAblationFeatureSetsV1(
    SPORTS_FAMILIES,
    config.baseline_families ?? config.baselineFamilies ?? SPORTS_FAMILIES,
    config.ablations ?? []
  );
  const walkForward = buildWalkForwardFoldsV1(targets, config.walk_forward ?? config.walkForward ?? {});
  const scoresByVariant = new Map(featureSets.variants.map((variant) => [variant.id, []]));
  const requiredFamilies = [...new Set(featureSets.variants.flatMap((variant) => variant.feature_families))];

  for (const target of targets) {
    const bundles = await buildSportsFeatureBundleForRace(env, target, requiredFamilies);
    for (const variant of featureSets.variants) {
      const score = await forecastForVariant(forecastProducer, target, bundles, variant);
      scoresByVariant.get(variant.id).push({
        ...score,
        target_id: target.target_id,
        target_group_id: target.target_group_id,
        target_at: target.target_at,
        forecast_variant: variant.id
      });
    }
  }

  const comparisons = ablationResultsFromVariantScores(featureSets, scoresByVariant, walkForward);
  const allScores = [...scoresByVariant.entries()].flatMap(([variant, items]) => items.map((item) => ({ ...item, forecast_variant: variant })));
  const evaluationFingerprint = await evaluationFingerprintV1(allScores);
  const cohortFingerprint = await sha256Text(stableFeatureJson(targets.map((target) => ({
    target_id: target.target_id,
    target_at: target.target_at,
    target_group_at: target.target_group_at,
    winner_entry_id: target.winner_entry_id,
    entry_ids: target.entry_ids
  }))));
  const resultBase = {
    contract_version: REPLAY_CONTRACT_VERSION,
    replay_version: REPLAY_VERSION,
    track: 'sports_feature',
    status: walkForward.folds.length ? 'completed' : 'insufficient_evidence',
    config: {
      from: exactIso(config.from, 'from'),
      to: exactIso(config.to, 'to'),
      max_targets: nullablePositiveInteger(config.max_targets ?? config.maxTargets, 'max_targets', DEFAULT_MAX_TARGETS),
      baseline_families: featureSets.baseline_families,
      ablations: normalizeAblations(config.ablations ?? []),
      walk_forward: walkForward.policy
    },
    version_metadata: {
      ...resultSourceVersionMetadata(),
      forecast_producer_version: producerVersion
    },
    cohort_fingerprint: cohortFingerprint,
    evaluation_fingerprint: evaluationFingerprint,
    target_count: targets.length,
    fold_count: walkForward.folds.length,
    walk_forward: walkForward,
    baseline_summary: comparisons.baseline_summary,
    ablations: comparisons.ablations
  };
  const resultFingerprint = await sha256Text(stableFeatureJson(resultBase));
  return { ...resultBase, result_fingerprint: resultFingerprint, evaluations: allScores };
}

async function loadWinnerForRace(env, raceId) {
  const { results } = await env.DB.prepare(`
    SELECT re.id AS race_entry_id
    FROM race_entries re
    JOIN race_results rr ON rr.race_entry_id=re.id
    WHERE re.race_id=? AND rr.placing=1
    ORDER BY re.id
  `).bind(raceId).all();
  if ((results || []).length !== 1) return null;
  return results[0].race_entry_id;
}

function predictionEntriesFromDecisionLeg(leg, field) {
  if (!Array.isArray(leg?.entries) || leg.entries.length < 2) throw new Error('decision leg must contain at least two entries');
  return leg.entries.map((entry) => ({
    race_entry_id: entry.race_entry_id,
    probability: finiteProbability(entry[field], `${field} ${entry.race_entry_id}`)
  }));
}

async function loadDecisionTargets(env, config) {
  const from = exactIso(config.from, 'from');
  const to = exactIso(config.to, 'to');
  const maxTargets = nullablePositiveInteger(config.max_targets ?? config.maxTargets, 'max_targets', DEFAULT_MAX_TARGETS);
  const decisionVersion = config.decision_probability_version == null
    ? null : requiredText(config.decision_probability_version, 'decision_probability_version', 160);
  const versionClause = decisionVersion ? 'AND adr.decision_probability_version=?' : '';
  const bindings = decisionVersion ? [from, to, decisionVersion, maxTargets] : [from, to, maxTargets];
  const { results } = await env.DB.prepare(`
    SELECT adr.*,asl.pack_id,asl.pack_as_of,asl.prompt_version AS step1_prompt_version,
      asl.lock_hash AS stored_lock_hash,gr.game_type
    FROM analysis_decision_runs adr
    JOIN analysis_step1_locks asl ON asl.id=adr.lock_id
    JOIN game_rounds gr ON gr.id=adr.game_round_id
    WHERE gr.game_type IN ('V85','V86')
      AND datetime(adr.market_cutoff)>=datetime(?)
      AND datetime(adr.market_cutoff)<=datetime(?)
      ${versionClause}
    ORDER BY datetime(adr.market_cutoff),adr.game_round_id,adr.id
    LIMIT ?
  `).bind(...bindings).all();

  const targets = [];
  for (const row of results || []) {
    if (row.lock_hash !== row.stored_lock_hash) throw new Error(`decision ${row.id} lock hash mismatch`);
    if (Date.parse(row.pack_as_of) > Date.parse(row.market_cutoff)) throw new Error(`decision ${row.id} market cutoff is before sealed Step 1 as-of`);
    const decision = parseJson(row.decision_json, 'decision_json');
    if (decision.decision_fingerprint !== row.decision_fingerprint) throw new Error(`decision ${row.id} fingerprint metadata mismatch`);
    const { results: legs } = await env.DB.prepare(`
      SELECT gl.leg_number,gl.race_id,r.scheduled_start_at
      FROM game_legs gl
      JOIN races r ON r.id=gl.race_id
      WHERE gl.game_round_id=?
      ORDER BY gl.leg_number
    `).bind(row.game_round_id).all();
    if ((legs || []).length !== 8) continue;
    const earliestStart = Math.min(...legs.map((leg) => Date.parse(String(leg.scheduled_start_at || ''))).filter(Number.isFinite));
    if (!Number.isFinite(earliestStart)) continue;
    if (Date.parse(row.market_cutoff) > earliestStart) throw new Error(`decision ${row.id} market cutoff is after race start`);
    const { results: optimizerRows } = await env.DB.prepare(`
      SELECT id,optimizer_version,policy_version,optimizer_fingerprint
      FROM analysis_optimizer_runs
      WHERE decision_run_id=?
      ORDER BY optimizer_version,policy_version,optimizer_fingerprint,id
    `).bind(row.id).all();
    const optimizerLineage = (optimizerRows || []).map((optimizer) => ({
      optimizer_run_id: optimizer.id,
      optimizer_version: optimizer.optimizer_version,
      optimizer_policy_version: optimizer.policy_version,
      optimizer_fingerprint: optimizer.optimizer_fingerprint
    }));
    const groupAt = new Date(earliestStart).toISOString();
    for (const legRow of legs) {
      const leg = decision.legs?.find((item) => Number(item.leg_number) === Number(legRow.leg_number));
      if (!leg) throw new Error(`decision ${row.id} missing leg ${legRow.leg_number}`);
      const winner = await loadWinnerForRace(env, legRow.race_id);
      if (!winner) continue;
      const blindScore = scoreMulticlassForecastV1({
        entries: predictionEntriesFromDecisionLeg(leg, 'blind_probability'),
        winnerEntryId: winner
      });
      const decisionScore = scoreMulticlassForecastV1({
        entries: predictionEntriesFromDecisionLeg(leg, 'decision_probability'),
        winnerEntryId: winner
      });
      targets.push({
        target_id: `${row.game_round_id}:leg:${legRow.leg_number}`,
        target_group_id: row.game_round_id,
        target_group_at: groupAt,
        target_at: exactIso(legRow.scheduled_start_at, 'leg scheduled_start_at'),
        round_id: row.game_round_id,
        decision_run_id: row.id,
        leg_number: Number(legRow.leg_number),
        winner_entry_id: winner,
        variants: { blind: blindScore, decision: decisionScore },
        version_metadata: {
          step1_lock_id: row.lock_id,
          step1_lock_hash: row.lock_hash,
          step1_pack_id: row.pack_id,
          step1_pack_as_of: exactIso(row.pack_as_of, 'pack_as_of'),
          step1_prompt_version: row.step1_prompt_version,
          market_cutoff: exactIso(row.market_cutoff, 'market_cutoff'),
          decision_probability_version: row.decision_probability_version,
          decision_policy_version: row.policy_version,
          optimizer_lineage: optimizerLineage
        }
      });
    }
  }
  return targets;
}

export async function runDecisionReplayV1(env, config = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const targets = await loadDecisionTargets(env, config);
  const walkForward = buildWalkForwardFoldsV1(targets, config.walk_forward ?? config.walkForward ?? {});
  const testGroups = testGroupSet(walkForward.folds);
  const blindScores = [];
  const decisionScores = [];
  const evaluations = [];
  for (const target of targets) {
    for (const variant of ['blind', 'decision']) {
      const score = target.variants[variant];
      const evaluation = {
        ...score,
        target_id: target.target_id,
        target_group_id: target.target_group_id,
        target_at: target.target_at,
        forecast_variant: variant
      };
      evaluations.push(evaluation);
      if (testGroups.has(target.target_group_id)) {
        if (variant === 'blind') blindScores.push(evaluation);
        else decisionScores.push(evaluation);
      }
    }
  }
  const blindSummary = summarizeScores(blindScores);
  const decisionSummary = summarizeScores(decisionScores);
  const evaluationFingerprint = await evaluationFingerprintV1(evaluations);
  const decisionLineages = uniqueDecisionLineages(targets);
  const cohortFingerprint = await sha256Text(stableFeatureJson(targets.map((target) => ({
    target_id: target.target_id,
    target_group_id: target.target_group_id,
    target_at: target.target_at,
    winner_entry_id: target.winner_entry_id,
    decision_run_id: target.decision_run_id,
    version_metadata: target.version_metadata
  }))));
  const resultBase = {
    contract_version: REPLAY_CONTRACT_VERSION,
    replay_version: REPLAY_VERSION,
    track: 'v85_v86_decision',
    status: walkForward.folds.length ? 'completed' : 'insufficient_evidence',
    config: {
      from: exactIso(config.from, 'from'),
      to: exactIso(config.to, 'to'),
      max_targets: nullablePositiveInteger(config.max_targets ?? config.maxTargets, 'max_targets', DEFAULT_MAX_TARGETS),
      decision_probability_version: config.decision_probability_version ?? null,
      walk_forward: walkForward.policy
    },
    version_metadata: {
      ...resultSourceVersionMetadata(),
      decision_lineages: decisionLineages
    },
    cohort_fingerprint: cohortFingerprint,
    evaluation_fingerprint: evaluationFingerprint,
    target_count: targets.length,
    fold_count: walkForward.folds.length,
    walk_forward: walkForward,
    blind_summary: blindSummary,
    decision_summary: decisionSummary,
    decision_minus_blind: {
      delta_log_loss: blindSummary.mean_log_loss == null || decisionSummary.mean_log_loss == null
        ? null : round(decisionSummary.mean_log_loss - blindSummary.mean_log_loss),
      delta_brier: blindSummary.mean_brier_score == null || decisionSummary.mean_brier_score == null
        ? null : round(decisionSummary.mean_brier_score - blindSummary.mean_brier_score)
    }
  };
  const resultFingerprint = await sha256Text(stableFeatureJson(resultBase));
  return { ...resultBase, result_fingerprint: resultFingerprint, evaluations };
}

function storedReplayMetadata(row, result, reused) {
  return {
    id: row.id,
    track: row.track,
    replay_version: row.replay_version,
    status: row.status,
    cohort_fingerprint: row.cohort_fingerprint,
    result_fingerprint: row.result_fingerprint,
    target_count: Number(row.target_count),
    fold_count: Number(row.fold_count),
    created_at: row.created_at,
    reused,
    result
  };
}

export async function persistReplayResultV1(env, result, options = {}) {
  if (!env?.DB?.batch) throw new Error('DB batch support is required');
  if (!result || result.contract_version !== REPLAY_CONTRACT_VERSION || result.replay_version !== REPLAY_VERSION) {
    throw new Error('canonical F1 replay result is required');
  }
  if (!REPLAY_TRACKS.includes(result.track)) throw new Error('unsupported replay track');
  const evaluations = Array.isArray(result.evaluations) ? result.evaluations : [];
  const actualEvaluationFingerprint = await evaluationFingerprintV1(evaluations);
  if (actualEvaluationFingerprint !== result.evaluation_fingerprint) {
    throw new Error('evaluation_fingerprint does not match replay evaluations');
  }
  const canonicalBase = { ...result };
  delete canonicalBase.evaluations;
  delete canonicalBase.result_fingerprint;
  const recalculated = await sha256Text(stableFeatureJson(canonicalBase));
  if (recalculated !== result.result_fingerprint) {
    throw new Error('result_fingerprint does not match canonical replay content');
  }
  const id = replayIdFromFingerprint(result.result_fingerprint);
  const existing = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
  if (existing) {
    if (existing.result_fingerprint !== result.result_fingerprint) throw new Error('replay id collision');
    return storedReplayMetadata(existing, parseJson(existing.result_json, 'result_json'), true);
  }
  const createdAt = exactIso(options.createdAt ?? new Date().toISOString(), 'created_at');
  const resultForStorage = { ...result };
  delete resultForStorage.evaluations;
  const statements = [
    env.DB.prepare(`
      INSERT INTO replay_runs (
        id,contract_version,replay_version,track,status,config_json,version_metadata_json,
        cohort_fingerprint,evaluation_fingerprint,result_json,result_fingerprint,target_count,fold_count,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,result.contract_version,result.replay_version,result.track,result.status,
      stableFeatureJson(result.config),stableFeatureJson(result.version_metadata),result.cohort_fingerprint,
      result.evaluation_fingerprint,stableFeatureJson(resultForStorage),result.result_fingerprint,
      result.target_count,result.fold_count,createdAt
    )
  ];
  for (const evaluation of evaluations) {
    statements.push(env.DB.prepare(`
      INSERT INTO forecast_evaluations (
        replay_run_id,target_id,target_group_id,target_at,forecast_variant,winner_entry_id,entry_count,
        log_loss,brier_score,top1_hit,winner_rank,forecast_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,evaluation.target_id,evaluation.target_group_id,evaluation.target_at,evaluation.forecast_variant,
      evaluation.winner_entry_id,evaluation.entry_count,evaluation.log_loss,evaluation.brier_score,
      evaluation.top1_hit ? 1 : 0,evaluation.winner_rank,stableFeatureJson(evaluation.forecast)
    ));
  }
  for (const ablation of result.ablations || []) {
    statements.push(env.DB.prepare(`
      INSERT INTO replay_ablation_results (
        replay_run_id,ablation_id,feature_family,mode,baseline_variant,candidate_variant,target_count,
        baseline_log_loss,candidate_log_loss,delta_log_loss,baseline_brier,candidate_brier,delta_brier,result_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,ablation.ablation_id,ablation.feature_family,ablation.mode,ablation.baseline_variant,
      ablation.candidate_variant,ablation.target_count,ablation.baseline_log_loss,ablation.candidate_log_loss,
      ablation.delta_log_loss,ablation.baseline_brier,ablation.candidate_brier,ablation.delta_brier,
      stableFeatureJson(ablation)
    ));
  }
  await env.DB.batch(statements);
  const row = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
  if (!row) throw new Error('replay run could not be read after persistence');
  return storedReplayMetadata(row, resultForStorage, false);
}

export async function getReplayRunV1(env, id) {
  if (!env?.DB) throw new Error('DB is not configured');
  const replayId = requiredText(id, 'replay id', 160);
  const row = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(replayId).first();
  if (!row) return null;
  return storedReplayMetadata(row, parseJson(row.result_json, 'result_json'), true);
}
