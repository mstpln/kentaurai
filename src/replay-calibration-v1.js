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
import {
  REPLAY_POSITION_EVIDENCE_VERSION,
  REPLAY_RACE_TERMS_VERSION,
  REPLAY_START_POINTS_DYNAMICS_VERSION,
  buildReplayPositionEvidenceV1ForEntries,
  buildReplayRaceTermsV1ForEntries,
  buildReplayStartPointsDynamicsV1ForEntries
} from './replay-feature-candidates-v1.js';
import {
  ANALYSIS_DECISION_PROBABILITY_VERSION,
  ANALYSIS_DECISION_POLICY_VERSION,
  assertCanonicalDecisionProbabilityV1
} from './analysis-decision-probability-v1.js';
import {
  ANALYSIS_OPTIMIZER_POLICY_VERSION,
  ANALYSIS_OPTIMIZER_VERSION,
  buildCanonicalOptimizerV1
} from './analysis-optimizer-v1.js';
import { loadExternalDecisionReplayEvidenceV1 } from './external-analysis-evidence-v1.js';

export const REPLAY_CONTRACT_VERSION = 'kentaurai-replay-v1';
export const REPLAY_VERSION = 'replay-calibration-v1-f1';
export const REPLAY_TRACKS = Object.freeze(['sports_feature', 'v85_v86_decision']);
export const REPLAY_SCORE_VERSION = 'multiclass-logloss-brier-v1';
export const REPLAY_CALIBRATION_VERSION = 'fixed-bins-v1';
export const REPLAY_WALK_FORWARD_VERSION = 'expanding-window-v1';

const PROBABILITY_TOLERANCE = 1e-6;
const LOG_EPSILON = 1e-15;
const DEFAULT_CALIBRATION_BINS = 10;
const DEFAULT_MAX_TARGETS = 50;
const MAX_REPLAY_TARGETS = 200;

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function requiredSha256(value, field) {
  const text = requiredText(value, field, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error(`${field} must be a sha256 fingerprint`);
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

function replayTargetLimit(value) {
  if (value == null || value === '') return DEFAULT_MAX_TARGETS;
  return positiveInteger(value, 'max_targets', MAX_REPLAY_TARGETS);
}

function normalizeIdList(value, field, maxItems = 200) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} must be an array with at most ${maxItems} items`);
  return [...new Set(value.map((item, index) => requiredText(item, `${field}[${index}]`, 200)))].sort(compareId);
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
    top1_hit: winnerIndex < 1,
    top2_hit: winnerIndex < 2,
    top3_hit: winnerIndex < 3,
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
    top2_coverage: null,
    top3_coverage: null,
    mean_winner_rank: null,
    calibration: buildCalibrationSummaryV1([])
  };
  return {
    target_count: count,
    mean_log_loss: round(scoredTargets.reduce((sum, item) => sum + item.log_loss, 0) / count),
    mean_brier_score: round(scoredTargets.reduce((sum, item) => sum + item.brier_score, 0) / count),
    top1_accuracy: round(scoredTargets.reduce((sum, item) => sum + (item.top1_hit ? 1 : 0), 0) / count),
    top2_coverage: round(scoredTargets.reduce((sum, item) => sum + (item.top2_hit ? 1 : 0), 0) / count),
    top3_coverage: round(scoredTargets.reduce((sum, item) => sum + (item.top3_hit ? 1 : 0), 0) / count),
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
  const timeBlocks = [];
  for (const group of groups) {
    const last = timeBlocks[timeBlocks.length - 1];
    if (last?.target_at === group.target_at) last.groups.push(group);
    else timeBlocks.push({ target_at: group.target_at, groups: [group] });
  }
  const flatten = (blocks) => blocks.flatMap((block) => block.groups.map((group) => group.group_id));
  const folds = [];
  let trainEnd = normalizedPolicy.min_train_groups;
  let foldIndex = 0;
  while (trainEnd + normalizedPolicy.calibration_groups + normalizedPolicy.test_groups <= timeBlocks.length) {
    const calibrationEnd = trainEnd + normalizedPolicy.calibration_groups;
    const testEnd = calibrationEnd + normalizedPolicy.test_groups;
    const trainBlocks = timeBlocks.slice(0, trainEnd);
    const calibrationBlocks = timeBlocks.slice(trainEnd, calibrationEnd);
    const testBlocks = timeBlocks.slice(calibrationEnd, testEnd);
    folds.push({
      fold_index: foldIndex,
      train_group_ids: flatten(trainBlocks),
      calibration_group_ids: flatten(calibrationBlocks),
      test_group_ids: flatten(testBlocks),
      train_through: trainBlocks.at(-1)?.target_at ?? null,
      calibration_through: calibrationBlocks.at(-1)?.target_at ?? null,
      test_through: testBlocks.at(-1)?.target_at ?? null
    });
    foldIndex += 1;
    trainEnd += normalizedPolicy.step_groups;
  }
  return {
    policy: normalizedPolicy,
    group_count: groups.length,
    time_block_count: timeBlocks.length,
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
    xlabs_evidence_profile_version: XLABS_EVIDENCE_PROFILE_VERSION,
    replay_race_terms_version: REPLAY_RACE_TERMS_VERSION,
    replay_start_points_dynamics_version: REPLAY_START_POINTS_DYNAMICS_VERSION,
    replay_position_evidence_version: REPLAY_POSITION_EVIDENCE_VERSION
  };
}

async function buildSportsFeatureBundleForRace(env, target, requiredFamilies) {
  const entryIds = target.entry_ids;
  const asOf = target.target_at;
  const needed = new Set(requiredFamilies);
  const performanceNames = new Set(['capacity','form','class_context','development','method_distance','rest_readiness','gallop_risk']);
  const needsPerformance = [...needed].some((family) => performanceNames.has(family));

  const [performance, equipment, person, priors, xlabs, terms, startPointsDynamics, position] = await Promise.all([
    needsPerformance ? buildPerformanceFeaturesV3ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('equipment_response') ? buildEquipmentResponseV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('person_context') ? buildPersonContextV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('race_priors') ? buildRacePriorsV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('xlabs_evidence') ? buildXlabsEvidenceProfilesForRace(env, { raceId: target.race_id, asOf }) : Promise.resolve({ profiles: [] }),
    needed.has('terms') ? buildReplayRaceTermsV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('start_points_dynamics') ? buildReplayStartPointsDynamicsV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map()),
    needed.has('position') ? buildReplayPositionEvidenceV1ForEntries(env, entryIds, asOf) : Promise.resolve(new Map())
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
    if (needed.has('terms')) bundle.terms = terms.get(entryId) ?? null;
    if (needed.has('start_points_dynamics')) bundle.start_points_dynamics = startPointsDynamics.get(entryId) ?? null;
    if (needed.has('position')) bundle.position = position.get(entryId) ?? null;
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
  'xlabs_evidence',
  'terms',
  'start_points_dynamics',
  'position'
]);

async function loadSportsTargets(env, config) {
  const from = exactIso(config.from, 'from');
  const to = exactIso(config.to, 'to');
  if (Date.parse(from) > Date.parse(to)) throw new Error('from must not be after to');
  const maxTargets = replayTargetLimit(config.max_targets ?? config.maxTargets);
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
      target_group_at: exactIso(row.scheduled_start_at, 'race scheduled_start_at'),
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

function canonicalReplayEvaluationsV1(evaluations) {
  if (!Array.isArray(evaluations)) throw new Error('replay evaluations must be an array');
  const seen = new Set();
  return evaluations.map((evaluation, index) => {
    const targetId = requiredText(evaluation?.target_id, `evaluations[${index}].target_id`, 240);
    const targetGroupId = requiredText(evaluation?.target_group_id, `evaluations[${index}].target_group_id`, 240);
    const targetAt = exactIso(evaluation?.target_at, `evaluations[${index}].target_at`);
    const forecastVariant = requiredText(evaluation?.forecast_variant, `evaluations[${index}].forecast_variant`, 160);
    const winnerEntryId = requiredText(evaluation?.winner_entry_id, `evaluations[${index}].winner_entry_id`, 200);
    const key = `${targetId}|${forecastVariant}`;
    if (seen.has(key)) throw new Error(`duplicate replay evaluation ${key}`);
    seen.add(key);

    const score = scoreMulticlassForecastV1({
      entries: evaluation?.forecast,
      winnerEntryId
    });
    for (const [field, expected] of [
      ['entry_count', score.entry_count],
      ['winner_rank', score.winner_rank],
      ['log_loss', score.log_loss],
      ['brier_score', score.brier_score]
    ]) {
      if (Number(evaluation?.[field]) !== expected) throw new Error(`evaluations[${index}].${field} does not match forecast score`);
    }
    for (const field of ['top1_hit','top2_hit','top3_hit']) {
      if (Boolean(evaluation?.[field]) !== score[field]) {
        throw new Error(`evaluations[${index}].${field} does not match forecast score`);
      }
    }
    return {
      target_id: targetId,
      target_group_id: targetGroupId,
      target_at: targetAt,
      forecast_variant: forecastVariant,
      winner_entry_id: winnerEntryId,
      entry_count: score.entry_count,
      log_loss: score.log_loss,
      brier_score: score.brier_score,
      top1_hit: score.top1_hit,
      top2_hit: score.top2_hit,
      top3_hit: score.top3_hit,
      winner_rank: score.winner_rank,
      forecast: score.forecast
    };
  }).sort((a, b) =>
    compareId(a.target_group_id, b.target_group_id)
    || Date.parse(a.target_at) - Date.parse(b.target_at)
    || compareId(a.target_id, b.target_id)
    || compareId(a.forecast_variant, b.forecast_variant)
  );
}

async function evaluationFingerprintV1(evaluations) {
  return sha256Text(stableFeatureJson(canonicalReplayEvaluationsV1(evaluations)));
}

function canonicalEvaluationTargets(evaluations) {
  const targets = new Map();
  for (const evaluation of evaluations) {
    const entryIds = evaluation.forecast.map((entry) => entry.race_entry_id).sort(compareId);
    const existing = targets.get(evaluation.target_id);
    const identity = {
      target_id: evaluation.target_id,
      target_group_id: evaluation.target_group_id,
      target_at: evaluation.target_at,
      winner_entry_id: evaluation.winner_entry_id,
      entry_ids: entryIds
    };
    if (existing && stableFeatureJson(existing) !== stableFeatureJson(identity)) {
      throw new Error(`replay target ${evaluation.target_id} has inconsistent identity or forecast field across variants`);
    }
    if (!existing) targets.set(evaluation.target_id, identity);
  }
  return [...targets.values()].sort((a, b) =>
    Date.parse(a.target_at) - Date.parse(b.target_at)
    || compareId(a.target_group_id, b.target_group_id)
    || compareId(a.target_id, b.target_id)
  );
}

function canonicalCohortFingerprintInput(result, evaluations) {
  const targets = canonicalEvaluationTargets(evaluations);
  if (result.track === 'sports_feature') {
    return {
      targets: targets.map((target) => ({
        target_id: target.target_id,
        target_at: target.target_at,
        target_group_at: target.target_at,
        winner_entry_id: target.winner_entry_id,
        entry_ids: target.entry_ids
      })),
      version_metadata: result.version_metadata
    };
  }
  const lineages = new Map((result.version_metadata?.decision_lineages || []).map((lineage) => [lineage.target_group_id, lineage]));
  return {
    targets: targets.map((target) => {
      const lineage = lineages.get(target.target_group_id);
      if (!lineage) throw new Error(`decision replay target ${target.target_id} is missing exact lineage metadata`);
      return {
        target_id: target.target_id,
        target_group_id: target.target_group_id,
        target_at: target.target_at,
        winner_entry_id: target.winner_entry_id,
        decision_run_id: lineage.decision_run_id,
        version_metadata: lineage.version_metadata
      };
    }),
    version_metadata: result.version_metadata
  };
}

function canonicalWalkForwardTargets(targets, excludedGroupIds = new Set()) {
  const groups = new Map();
  for (const target of targets) {
    if (excludedGroupIds.has(target.target_group_id)) continue;
    const previous = groups.get(target.target_group_id);
    if (!previous || Date.parse(target.target_at) < Date.parse(previous.target_group_at)) {
      groups.set(target.target_group_id, {
        target_group_id: target.target_group_id,
        target_group_at: target.target_at
      });
    }
  }
  return [...groups.values()];
}

function assertReplayAggregateConsistency(result, evaluations) {
  const targets = canonicalEvaluationTargets(evaluations);
  const foldCount = Number(result?.fold_count);
  if (!Number.isInteger(foldCount) || foldCount < 0 || foldCount !== (result?.walk_forward?.folds || []).length) {
    throw new Error('fold_count does not match walk_forward folds');
  }
  const expectedStatus = foldCount > 0 ? 'completed' : 'insufficient_evidence';
  if (result.status !== expectedStatus) throw new Error('replay status does not match fold evidence');
  if (Number(result.target_count) !== targets.length) throw new Error('target_count does not match replay evaluations');

  const regressionGroups = result.track === 'v85_v86_decision'
    ? new Set(normalizeIdList(result.config?.regression_only_round_ids, 'config.regression_only_round_ids'))
    : new Set();
  const expectedWalkForward = buildWalkForwardFoldsV1(
    canonicalWalkForwardTargets(targets, regressionGroups),
    result.config?.walk_forward || {}
  );
  if (stableFeatureJson(expectedWalkForward) !== stableFeatureJson(result.walk_forward)) {
    throw new Error('walk_forward does not match chronological replay targets and policy');
  }

  const testGroups = testGroupSet(result.walk_forward.folds || []);
  if (result.track === 'v85_v86_decision') {
    const byTarget = new Map();
    for (const evaluation of evaluations) {
      if (!byTarget.has(evaluation.target_id)) byTarget.set(evaluation.target_id, new Set());
      byTarget.get(evaluation.target_id).add(evaluation.forecast_variant);
    }
    for (const variants of byTarget.values()) {
      if (variants.size !== 2 || !variants.has('blind') || !variants.has('decision')) {
        throw new Error('decision replay targets must contain blind and decision variants exactly once');
      }
    }
    const blind = evaluations.filter((item) => item.forecast_variant === 'blind' && testGroups.has(item.target_group_id));
    const decision = evaluations.filter((item) => item.forecast_variant === 'decision' && testGroups.has(item.target_group_id));
    if (stableFeatureJson(summarizeScores(blind)) !== stableFeatureJson(result.blind_summary)
      || stableFeatureJson(summarizeScores(decision)) !== stableFeatureJson(result.decision_summary)) {
      throw new Error('decision replay summaries do not match held-out evaluations');
    }
    const expectedDelta = {
      delta_log_loss: result.blind_summary.mean_log_loss == null || result.decision_summary.mean_log_loss == null
        ? null : round(result.decision_summary.mean_log_loss - result.blind_summary.mean_log_loss),
      delta_brier: result.blind_summary.mean_brier_score == null || result.decision_summary.mean_brier_score == null
        ? null : round(result.decision_summary.mean_brier_score - result.blind_summary.mean_brier_score)
    };
    if (stableFeatureJson(expectedDelta) !== stableFeatureJson(result.decision_minus_blind)) {
      throw new Error('decision-minus-blind summary is inconsistent');
    }
    const evidenceTargetCount = targets.filter((target) => !regressionGroups.has(target.target_group_id)).length;
    const regressionTargetCount = targets.length - evidenceTargetCount;
    if (Number(result.evidence_target_count) !== evidenceTargetCount
      || Number(result.regression_only_target_count) !== regressionTargetCount) {
      throw new Error('decision replay evidence/regression target counts are inconsistent');
    }
    const regressionBlind = evaluations.filter((item) => item.forecast_variant === 'blind' && regressionGroups.has(item.target_group_id));
    const regressionDecision = evaluations.filter((item) => item.forecast_variant === 'decision' && regressionGroups.has(item.target_group_id));
    if (stableFeatureJson(summarizeScores(regressionBlind)) !== stableFeatureJson(result.regression_only_summary?.blind)
      || stableFeatureJson(summarizeScores(regressionDecision)) !== stableFeatureJson(result.regression_only_summary?.decision)) {
      throw new Error('decision replay regression-only summaries are inconsistent');
    }
    const testSystems = (result.system_diagnostics || []).filter((item) => testGroups.has(item.target_group_id));
    const regressionSystems = result.regression_only_summary?.system_diagnostics || [];
    if (testSystems.length !== (result.system_diagnostics || []).length
      || regressionSystems.some((item) => !regressionGroups.has(item.target_group_id))) {
      throw new Error('decision replay system diagnostics are assigned outside their evidence cohorts');
    }
    if (stableFeatureJson(summarizeSystems(testSystems)) !== stableFeatureJson(result.system_summary)
      || stableFeatureJson(summarizeSystems(regressionSystems)) !== stableFeatureJson(result.regression_only_summary?.systems)) {
      throw new Error('decision replay system summaries are inconsistent');
    }
  } else if (result.track === 'sports_feature') {
    const expectedVariants = ['baseline', ...(result.config?.ablations || []).map((ablation) => ablation.id)].sort(compareId);
    const byTarget = new Map();
    for (const evaluation of evaluations) {
      if (!byTarget.has(evaluation.target_id)) byTarget.set(evaluation.target_id, new Set());
      byTarget.get(evaluation.target_id).add(evaluation.forecast_variant);
    }
    for (const variants of byTarget.values()) {
      const actual = [...variants].sort(compareId);
      if (stableFeatureJson(actual) !== stableFeatureJson(expectedVariants)) {
        throw new Error('sports replay target variant set does not match ablation config');
      }
    }
    const baseline = evaluations.filter((item) => item.forecast_variant === 'baseline' && testGroups.has(item.target_group_id));
    if (stableFeatureJson(summarizeScores(baseline)) !== stableFeatureJson(result.baseline_summary)) {
      throw new Error('sports replay baseline summary does not match held-out evaluations');
    }
    const configAblations = new Map((result.config?.ablations || []).map((item) => [item.id, item]));
    if ((result.ablations || []).length !== configAblations.size) {
      throw new Error('sports replay ablation result count does not match config');
    }
    const baselineSummary = summarizeScores(baseline);
    for (const ablation of result.ablations || []) {
      const definition = configAblations.get(ablation.ablation_id);
      if (!definition
        || definition.feature_family !== ablation.feature_family
        || definition.mode !== ablation.mode
        || ablation.baseline_variant !== 'baseline'
        || ablation.candidate_variant !== ablation.ablation_id) {
        throw new Error(`ablation ${ablation.ablation_id} metadata is inconsistent`);
      }
      const candidate = evaluations.filter((item) => item.forecast_variant === ablation.candidate_variant && testGroups.has(item.target_group_id));
      const candidateSummary = summarizeScores(candidate);
      const expected = {
        ablation_id: ablation.ablation_id,
        feature_family: definition.feature_family,
        mode: definition.mode,
        baseline_variant: 'baseline',
        candidate_variant: ablation.ablation_id,
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
      };
      if (stableFeatureJson(expected) !== stableFeatureJson(ablation)) {
        throw new Error(`ablation ${ablation.ablation_id} result is inconsistent with held-out evaluations`);
      }
    }
  }
  if (stableFeatureJson(result.scenario_summary) !== stableFeatureJson({
    status: 'unavailable_no_canonical_scenario_contract',
    scored_target_count: 0
  })) {
    throw new Error('scenario_summary must remain unavailable until a canonical scenario contract exists');
  }
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
  const producerFingerprint = requiredSha256(forecastProducer.fingerprint, 'forecastProducer.fingerprint');
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
  const versionMetadata = {
    ...resultSourceVersionMetadata(),
    forecast_producer_version: producerVersion,
    forecast_producer_fingerprint: producerFingerprint
  };
  const resultBase = {
    contract_version: REPLAY_CONTRACT_VERSION,
    replay_version: REPLAY_VERSION,
    track: 'sports_feature',
    status: walkForward.folds.length ? 'completed' : 'insufficient_evidence',
    config: {
      from: exactIso(config.from, 'from'),
      to: exactIso(config.to, 'to'),
      max_targets: replayTargetLimit(config.max_targets ?? config.maxTargets),
      baseline_families: featureSets.baseline_families,
      ablations: normalizeAblations(config.ablations ?? []),
      walk_forward: walkForward.policy
    },
    version_metadata: versionMetadata,
    cohort_fingerprint: null,
    evaluation_fingerprint: evaluationFingerprint,
    target_count: targets.length,
    fold_count: walkForward.folds.length,
    walk_forward: walkForward,
    baseline_summary: comparisons.baseline_summary,
    ablations: comparisons.ablations,
    scenario_summary: {
      status: 'unavailable_no_canonical_scenario_contract',
      scored_target_count: 0
    }
  };
  resultBase.cohort_fingerprint = await sha256Text(stableFeatureJson(canonicalCohortFingerprintInput(resultBase, allScores)));
  const resultFingerprint = await sha256Text(stableFeatureJson(resultBase));
  return { ...resultBase, result_fingerprint: resultFingerprint, evaluations: allScores };
}

function predictionEntriesFromDecisionLeg(leg, field) {
  if (!Array.isArray(leg?.entries) || leg.entries.length < 2) throw new Error('decision leg must contain at least two entries');
  return leg.entries.map((entry) => ({
    race_entry_id: entry.race_entry_id,
    probability: finiteProbability(entry[field], `${field} ${entry.race_entry_id}`)
  }));
}

async function validateDecisionDocumentForReplay(row, decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error(`decision ${row.id} JSON must be an object`);
  if (decision.contract_version !== 'kentaurai-decision-probability-v1') throw new Error(`decision ${row.id} has unsupported contract`);
  for (const [field, expected] of [
    ['round_id', row.game_round_id],
    ['lock_id', row.lock_id],
    ['lock_hash', row.lock_hash],
    ['market_fingerprint', row.market_fingerprint],
    ['decision_probability_version', row.decision_probability_version],
    ['policy_version', row.policy_version]
  ]) {
    if (decision[field] !== expected) throw new Error(`decision ${row.id} ${field} metadata mismatch`);
  }
  if (exactIso(decision.market_cutoff, 'decision market_cutoff') !== exactIso(row.market_cutoff, 'stored market_cutoff')) {
    throw new Error(`decision ${row.id} market_cutoff metadata mismatch`);
  }
  if (decision.decision_fingerprint !== row.decision_fingerprint) throw new Error(`decision ${row.id} fingerprint metadata mismatch`);
  if (row.decision_probability_version !== ANALYSIS_DECISION_PROBABILITY_VERSION
    || row.policy_version !== ANALYSIS_DECISION_POLICY_VERSION) {
    throw new Error(`decision ${row.id} uses unsupported probability/policy version for F1 replay`);
  }
  await assertCanonicalDecisionProbabilityV1(decision);
  if (!Array.isArray(decision.legs) || decision.legs.length !== 8) throw new Error(`decision ${row.id} must contain exactly eight legs`);
  const legNumbers = decision.legs.map((leg) => Number(leg?.leg_number));
  if (legNumbers.some((number, index) => number !== index + 1)) throw new Error(`decision ${row.id} legs must be ordered 1 through 8`);
  for (const leg of decision.legs) {
    const blind = normalizeForecastEntries(predictionEntriesFromDecisionLeg(leg, 'blind_probability'));
    const canonical = normalizeForecastEntries(predictionEntriesFromDecisionLeg(leg, 'decision_probability'));
    const blindIds = [...blind.map((entry) => entry.race_entry_id)].sort(compareId);
    const canonicalIds = [...canonical.map((entry) => entry.race_entry_id)].sort(compareId);
    if (blindIds.length !== canonicalIds.length || blindIds.some((id, index) => id !== canonicalIds[index])) {
      throw new Error(`decision ${row.id} blind and canonical entry identities differ`);
    }
    if (row.policy_version === 'decision-blind-v1') {
      const blindById = new Map(blind.map((entry) => [entry.race_entry_id, entry.probability]));
      for (const entry of canonical) {
        if (entry.probability !== blindById.get(entry.race_entry_id)) {
          throw new Error(`decision ${row.id} violates decision-blind-v1 policy`);
        }
      }
    }
  }
}

async function optimizerSystemDiagnostic(env, optimizerRow, winnersByLeg, roundId, decisionRunId, decision) {
  const optimizer = parseJson(optimizerRow.optimizer_json, 'optimizer_json');
  for (const [field, expected] of [
    ['contract_version', 'kentaurai-optimizer-v1'],
    ['optimizer_version', optimizerRow.optimizer_version],
    ['policy_version', optimizerRow.policy_version],
    ['round_id', roundId],
    ['decision_run_id', decisionRunId],
    ['decision_fingerprint', optimizerRow.decision_fingerprint],
    ['optimizer_fingerprint', optimizerRow.optimizer_fingerprint]
  ]) {
    if (optimizer[field] !== expected) throw new Error(`optimizer ${optimizerRow.id} ${field} metadata mismatch`);
  }
  if (optimizerRow.decision_fingerprint !== decision.decision_fingerprint
    || optimizerRow.optimizer_version !== ANALYSIS_OPTIMIZER_VERSION
    || optimizerRow.policy_version !== ANALYSIS_OPTIMIZER_POLICY_VERSION) {
    throw new Error(`optimizer ${optimizerRow.id} does not match its canonical E1/E2 lineage`);
  }
  const system = optimizer.system;
  if (!system || Number(system.spike_count) !== 3 || Number(optimizerRow.spike_count) !== 3
    || !Array.isArray(system.legs) || system.legs.length !== 8) {
    throw new Error(`optimizer ${optimizerRow.id} does not contain an exact-three-spike eight-leg system`);
  }
  const legNumbers = system.legs.map((leg) => Number(leg?.leg_number));
  if (legNumbers.some((number, index) => number !== index + 1)) {
    throw new Error(`optimizer ${optimizerRow.id} system legs must be ordered 1 through 8`);
  }

  let coveredLegs = 0;
  let spikeMisses = 0;
  let spikeCount = 0;
  let rowProduct = 1;
  let recomputedP8 = 1;
  for (const leg of system.legs) {
    const legNumber = Number(leg.leg_number);
    const winner = winnersByLeg.get(legNumber);
    if (!winner) throw new Error(`optimizer ${optimizerRow.id} cannot be evaluated without all factual winners`);
    const selectedIds = (leg.selected_entries || []).map((entry) => requiredText(entry?.race_entry_id, `optimizer ${optimizerRow.id} selected race_entry_id`, 200));
    if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length) {
      throw new Error(`optimizer ${optimizerRow.id} has empty or duplicate selections in leg ${legNumber}`);
    }
    const decisionLeg = decision.legs.find((item) => Number(item.leg_number) === legNumber);
    const decisionEntries = decisionLeg?.entries || [];
    const allowedIds = new Set(decisionEntries.map((entry) => String(entry.race_entry_id)));
    if (selectedIds.some((id) => !allowedIds.has(id))) {
      throw new Error(`optimizer ${optimizerRow.id} selects an entry outside its decision parent`);
    }
    const probabilities = new Map(decisionEntries.map((entry) => [
      String(entry.race_entry_id),
      finiteProbability(entry.decision_probability, `optimizer ${optimizerRow.id} decision probability`)
    ]));
    const legCoverage = selectedIds.reduce((sum, id) => sum + probabilities.get(id), 0);
    if (!(legCoverage > 0) || legCoverage > 1 + PROBABILITY_TOLERANCE) {
      throw new Error(`optimizer ${optimizerRow.id} has invalid recomputed leg coverage`);
    }
    recomputedP8 *= Math.min(1, legCoverage);
    const isSpike = selectedIds.length === 1;
    if (Boolean(leg.is_spike) !== isSpike) throw new Error(`optimizer ${optimizerRow.id} spike flag does not match selection count`);
    if (isSpike) spikeCount += 1;
    rowProduct *= selectedIds.length;
    if (!Number.isSafeInteger(rowProduct)) throw new Error(`optimizer ${optimizerRow.id} row product is not safe`);
    const covered = selectedIds.includes(winner);
    if (covered) coveredLegs += 1;
    if (isSpike && !covered) spikeMisses += 1;
  }
  if (spikeCount !== 3 || rowProduct !== Number(system.row_count) || rowProduct !== Number(optimizerRow.row_count)) {
    throw new Error(`optimizer ${optimizerRow.id} row/spike invariants do not match persisted metadata`);
  }
  const linePrice = Number(optimizerRow.line_price_sek);
  const cost = Number(system.cost_sek);
  if (!Number.isFinite(linePrice) || linePrice <= 0 || !Number.isFinite(cost) || cost <= 0
    || Math.abs(cost - Number(optimizerRow.cost_sek)) > 1e-6
    || Math.abs(cost - rowProduct * linePrice) > 1e-6) {
    throw new Error(`optimizer ${optimizerRow.id} cost metadata is inconsistent`);
  }
  const estimatedP8 = Number(system.estimated_p8);
  if (!Number.isFinite(estimatedP8) || estimatedP8 < 0 || estimatedP8 > 1
    || Math.abs(estimatedP8 - Number(optimizerRow.estimated_p8)) > 1e-12
    || Math.abs(estimatedP8 - recomputedP8) > 1e-10) {
    throw new Error(`optimizer ${optimizerRow.id} estimated_p8 is invalid or inconsistent with its decision parent`);
  }
  const rebuilt = await buildCanonicalOptimizerV1({
    decision,
    decisionRunId,
    gameType: optimizer.game_type,
    policy: optimizer.policy,
    generatedAt: optimizer.generated_at
  });
  if (stableFeatureJson(rebuilt) !== stableFeatureJson(optimizer)
    || stableFeatureJson(parseJson(optimizerRow.policy_json, 'optimizer policy_json')) !== stableFeatureJson(rebuilt.policy)
    || stableFeatureJson(parseJson(optimizerRow.metrics_json, 'optimizer metrics_json')) !== stableFeatureJson(rebuilt.metrics)
    || Number(optimizerRow.target_budget_min_sek) !== rebuilt.system.target_budget_min_sek
    || Number(optimizerRow.max_budget_sek) !== rebuilt.system.max_budget_sek) {
    throw new Error(`optimizer ${optimizerRow.id} does not match deterministic canonical E2 output`);
  }
  const { results: storedSelections } = await env.DB.prepare(`
    SELECT leg_number,race_entry_id,is_spike,decision_probability
    FROM analysis_optimizer_selections
    WHERE optimizer_run_id=?
    ORDER BY leg_number,race_entry_id
  `).bind(optimizerRow.id).all();
  const expectedSelections = rebuilt.system.legs.flatMap((leg) => leg.selected_entries.map((entry) => ({
    leg_number: leg.leg_number,
    race_entry_id: entry.race_entry_id,
    is_spike: leg.is_spike ? 1 : 0,
    decision_probability: entry.decision_probability
  }))).sort((a, b) => a.leg_number - b.leg_number || compareId(a.race_entry_id, b.race_entry_id));
  const normalizedSelections = (storedSelections || []).map((entry) => ({
    leg_number: Number(entry.leg_number),
    race_entry_id: String(entry.race_entry_id),
    is_spike: Number(entry.is_spike),
    decision_probability: Number(entry.decision_probability)
  }));
  if (stableFeatureJson(normalizedSelections) !== stableFeatureJson(expectedSelections)) {
    throw new Error(`optimizer ${optimizerRow.id} normalized selections do not match canonical E2 output`);
  }
  return {
    target_group_id: roundId,
    optimizer_run_id: optimizerRow.id,
    optimizer_version: optimizerRow.optimizer_version,
    optimizer_policy_version: optimizerRow.policy_version,
    optimizer_fingerprint: optimizerRow.optimizer_fingerprint,
    row_count: rowProduct,
    cost_sek: cost,
    spike_count: 3,
    estimated_p8: estimatedP8,
    covered_legs: coveredLegs,
    observed_p8: coveredLegs === 8 ? 1 : 0,
    spike_misses: spikeMisses
  };
}

function summarizeSystems(systemDiagnostics) {
  const items = Array.isArray(systemDiagnostics) ? systemDiagnostics : [];
  if (!items.length) return {
    system_count: 0,
    mean_estimated_p8: null,
    observed_p8_rate: null,
    mean_covered_legs: null,
    spike_miss_rate: null,
    mean_row_count: null
  };
  return {
    system_count: items.length,
    mean_estimated_p8: round(items.reduce((sum, item) => sum + item.estimated_p8, 0) / items.length),
    observed_p8_rate: round(items.reduce((sum, item) => sum + item.observed_p8, 0) / items.length),
    mean_covered_legs: round(items.reduce((sum, item) => sum + item.covered_legs, 0) / items.length),
    spike_miss_rate: round(items.reduce((sum, item) => sum + item.spike_misses, 0) / (items.length * 3)),
    mean_row_count: round(items.reduce((sum, item) => sum + item.row_count, 0) / items.length)
  };
}

async function loadDecisionTargets(env, config) {
  const from = exactIso(config.from, 'from');
  const to = exactIso(config.to, 'to');
  const maxTargets = replayTargetLimit(config.max_targets ?? config.maxTargets);
  const decisionVersion = config.decision_probability_version == null
    ? ANALYSIS_DECISION_PROBABILITY_VERSION
    : requiredText(config.decision_probability_version, 'decision_probability_version', 160);
  if (decisionVersion !== ANALYSIS_DECISION_PROBABILITY_VERSION) {
    throw new Error(`F1 currently supports only canonical ${ANALYSIS_DECISION_PROBABILITY_VERSION} decision replay`);
  }
  const versionClause = 'AND adr.decision_probability_version=? AND adr.policy_version=?';
  const bindings = [from, to, decisionVersion, ANALYSIS_DECISION_POLICY_VERSION, maxTargets];
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT adr.*,asl.pack_id,asl.pack_as_of,asl.prompt_version AS step1_prompt_version,asl.lock_json,
        asl.created_at AS step1_lock_created_at,asl.lock_hash AS stored_lock_hash,gr.game_type,
        ROW_NUMBER() OVER (
          PARTITION BY adr.game_round_id
          ORDER BY datetime(adr.market_cutoff) DESC,datetime(adr.created_at) DESC,adr.id DESC
        ) AS round_rank
      FROM analysis_decision_runs adr
      JOIN analysis_step1_locks asl ON asl.id=adr.lock_id
      JOIN game_rounds gr ON gr.id=adr.game_round_id
      WHERE gr.game_type IN ('V85','V86')
        AND NOT EXISTS (SELECT 1 FROM analysis_external_runs aer WHERE aer.game_round_id=adr.game_round_id)
        AND datetime((
          SELECT MIN(r0.scheduled_start_at)
          FROM game_legs gl0 JOIN races r0 ON r0.id=gl0.race_id
          WHERE gl0.game_round_id=adr.game_round_id
        )) >= datetime(?)
        AND datetime((
          SELECT MIN(r1.scheduled_start_at)
          FROM game_legs gl1 JOIN races r1 ON r1.id=gl1.race_id
          WHERE gl1.game_round_id=adr.game_round_id
        )) <= datetime(?)
        ${versionClause}
        AND datetime(adr.market_cutoff) <= datetime((
          SELECT MIN(r2.scheduled_start_at)
          FROM game_legs gl2 JOIN races r2 ON r2.id=gl2.race_id
          WHERE gl2.game_round_id=adr.game_round_id
        ))
        AND datetime(adr.created_at) < datetime((
          SELECT MIN(r3.scheduled_start_at)
          FROM game_legs gl3 JOIN races r3 ON r3.id=gl3.race_id
          WHERE gl3.game_round_id=adr.game_round_id
        ))
        AND datetime(asl.created_at) < datetime(adr.market_cutoff)
        AND NOT EXISTS (
          SELECT 1
          FROM analysis_step1_lock_revisions rev
          JOIN analysis_step1_locks child ON child.id=rev.child_lock_id
          WHERE rev.parent_lock_id=adr.lock_id
            AND datetime(child.created_at) <= datetime(adr.market_cutoff)
        )
    )
    SELECT * FROM ranked
    WHERE round_rank=1
    ORDER BY datetime(market_cutoff),game_round_id,id
    LIMIT ?
  `).bind(...bindings).all();

  const targets = [];
  const systemDiagnostics = [];
  const exclusions = {
    incomplete_round_structure: 0,
    ambiguous_or_incomplete_result: 0,
    missing_start_time: 0,
    post_cutoff_step1_lock: 0,
    post_start_decision: 0,
    post_start_optimizer: 0,
    post_start_integration: 0
  };
  for (const row of results || []) {
    if (row.lock_hash !== row.stored_lock_hash) throw new Error(`decision ${row.id} lock hash mismatch`);
    if (await sha256Text(requiredText(row.lock_json, `decision ${row.id} lock_json`, 2_000_000)) !== row.lock_hash) {
      throw new Error(`decision ${row.id} Step 1 lock content does not match lock hash`);
    }
    if (Date.parse(row.pack_as_of) > Date.parse(row.market_cutoff)) throw new Error(`decision ${row.id} market cutoff is before sealed Step 1 as-of`);
    if (Date.parse(row.step1_lock_created_at) >= Date.parse(row.market_cutoff)) {
      exclusions.post_cutoff_step1_lock += 1;
      continue;
    }
    const decision = parseJson(row.decision_json, 'decision_json');
    await validateDecisionDocumentForReplay(row, decision);

    const { results: roundRows } = await env.DB.prepare(`
      SELECT gl.leg_number,gl.race_id,r.scheduled_start_at,
             re.id AS race_entry_id,re.scratched,rr.placing
      FROM game_legs gl
      JOIN races r ON r.id=gl.race_id
      JOIN race_entries re ON re.race_id=r.id
      LEFT JOIN race_results rr ON rr.race_entry_id=re.id
      WHERE gl.game_round_id=?
      ORDER BY gl.leg_number,re.id
    `).bind(row.game_round_id).all();
    const legMap = new Map();
    for (const item of roundRows || []) {
      const legNumber = Number(item.leg_number);
      if (!legMap.has(legNumber)) legMap.set(legNumber, {
        leg_number: legNumber,
        race_id: item.race_id,
        scheduled_start_at: item.scheduled_start_at,
        entries: []
      });
      const grouped = legMap.get(legNumber);
      if (grouped.race_id !== item.race_id || grouped.scheduled_start_at !== item.scheduled_start_at) {
        throw new Error(`round ${row.game_round_id} contains inconsistent leg identity`);
      }
      grouped.entries.push({ race_entry_id: item.race_entry_id, scratched: Number(item.scratched || 0) === 1, placing: item.placing });
    }
    const legs = [...legMap.values()].sort((a, b) => a.leg_number - b.leg_number);
    if (legs.length !== 8 || legs.some((leg, index) => leg.leg_number !== index + 1)) {
      exclusions.incomplete_round_structure += 1;
      continue;
    }

    for (const legRow of legs) {
      const leg = decision.legs.find((item) => Number(item.leg_number) === legRow.leg_number);
      if (!leg || leg.race_id !== legRow.race_id) throw new Error(`decision ${row.id} race identity mismatch in leg ${legRow.leg_number}`);
      const activeIds = legRow.entries.filter((entry) => !entry.scratched).map((entry) => String(entry.race_entry_id)).sort(compareId);
      const predictionIds = (leg.entries || []).map((entry) => String(entry.race_entry_id || '')).sort(compareId);
      if (new Set(predictionIds).size !== predictionIds.length
        || stableFeatureJson(predictionIds) !== stableFeatureJson(activeIds)) {
        throw new Error(`decision ${row.id} must cover the exact active field in leg ${legRow.leg_number}`);
      }
    }

    const starts = legs.map((leg) => Date.parse(String(leg.scheduled_start_at || '')));
    if (starts.some((value) => !Number.isFinite(value))) {
      exclusions.missing_start_time += 1;
      continue;
    }
    const earliestStart = Math.min(...starts);
    if (Date.parse(row.market_cutoff) > earliestStart) throw new Error(`decision ${row.id} market cutoff is after race start`);
    if (Date.parse(row.created_at) >= earliestStart) {
      exclusions.post_start_decision += 1;
      continue;
    }

    const winnersByLeg = new Map();
    for (const legRow of legs) {
      const winners = legRow.entries.filter((entry) => !entry.scratched && Number(entry.placing) === 1);
      if (winners.length !== 1) break;
      winnersByLeg.set(legRow.leg_number, winners[0].race_entry_id);
    }
    if (winnersByLeg.size !== 8) {
      exclusions.ambiguous_or_incomplete_result += 1;
      continue;
    }

    const { results: optimizerRows } = await env.DB.prepare(`
      SELECT id,game_round_id,decision_fingerprint,optimizer_version,policy_version,optimizer_fingerprint,
             line_price_sek,target_budget_min_sek,max_budget_sek,spike_count,row_count,cost_sek,estimated_p8,
             policy_json,metrics_json,optimizer_json,created_at
      FROM analysis_optimizer_runs
      WHERE decision_run_id=?
      ORDER BY optimizer_version,policy_version,optimizer_fingerprint,id
    `).bind(row.id).all();
    const preStartOptimizerRows = (optimizerRows || []).filter((optimizer) => Date.parse(optimizer.created_at) < earliestStart);
    exclusions.post_start_optimizer += (optimizerRows || []).length - preStartOptimizerRows.length;
    const optimizerLineage = preStartOptimizerRows.map((optimizer) => ({
      optimizer_run_id: optimizer.id,
      optimizer_version: optimizer.optimizer_version,
      optimizer_policy_version: optimizer.policy_version,
      optimizer_fingerprint: optimizer.optimizer_fingerprint,
      optimizer_created_at: exactIso(optimizer.created_at, 'optimizer created_at')
    }));
    for (const optimizer of preStartOptimizerRows) {
      if (optimizer.game_round_id !== row.game_round_id) {
        throw new Error(`optimizer ${optimizer.id} round metadata does not match its decision parent`);
      }
      systemDiagnostics.push(await optimizerSystemDiagnostic(env, optimizer, winnersByLeg, row.game_round_id, row.id, decision));
    }

    const { results: integratedRows } = await env.DB.prepare(`
      SELECT av3.id AS analysis_v3_id,av3.analysis_version,av3.step2_version,av3.step2_result_id,
             av3.contract_version AS analysis_contract_version,av3.decision_probability_version,
             av3.step2_fingerprint,av3.decision_fingerprint,av3.optimizer_run_id,av3.optimizer_version,
             av3.optimizer_fingerprint,av3.lock_id,av3.lock_hash,av3.market_fingerprint,av3.market_cutoff,
             av3.created_at AS analysis_v3_created_at,
             s2.game_round_id AS step2_round_id,s2.lock_id AS step2_lock_id,s2.lock_hash AS step2_lock_hash,
             s2.market_fingerprint AS step2_market_fingerprint,s2.market_cutoff AS step2_market_cutoff,
             s2.step2_version AS stored_step2_version,s2.result_fingerprint AS stored_step2_fingerprint,
             s2.prompt_version AS step2_prompt_version,s2.provider AS step2_provider,s2.model AS step2_model,
             s2.created_at AS step2_created_at
      FROM analysis_v3_runs av3
      JOIN analysis_step2_results s2 ON s2.id=av3.step2_result_id
      WHERE av3.decision_run_id=?
      ORDER BY av3.analysis_version,av3.optimizer_run_id,av3.id
    `).bind(row.id).all();
    const preStartIntegratedRows = (integratedRows || []).filter((integrated) =>
      Date.parse(integrated.analysis_v3_created_at) < earliestStart
      && Date.parse(integrated.step2_created_at) < earliestStart
    );
    exclusions.post_start_integration += (integratedRows || []).length - preStartIntegratedRows.length;
    const integratedLineage = preStartIntegratedRows.map((integrated) => {
      if (integrated.lock_id !== row.lock_id || integrated.lock_hash !== row.lock_hash
        || integrated.market_fingerprint !== row.market_fingerprint
        || exactIso(integrated.market_cutoff, 'integrated market_cutoff') !== exactIso(row.market_cutoff, 'decision market_cutoff')
        || integrated.decision_fingerprint !== row.decision_fingerprint
        || integrated.analysis_contract_version !== 'kentaurai-analysis-v3'
        || integrated.decision_probability_version !== row.decision_probability_version
        || integrated.step2_round_id !== row.game_round_id
        || integrated.step2_lock_id !== row.lock_id
        || integrated.step2_lock_hash !== row.lock_hash
        || integrated.step2_market_fingerprint !== row.market_fingerprint
        || exactIso(integrated.step2_market_cutoff, 'Step 2 market_cutoff') !== exactIso(row.market_cutoff, 'decision market_cutoff')
        || integrated.step2_version !== integrated.stored_step2_version
        || integrated.step2_fingerprint !== integrated.stored_step2_fingerprint) {
        throw new Error(`integrated analysis ${integrated.analysis_v3_id} does not match decision lineage`);
      }
      const optimizer = optimizerLineage.find((item) => item.optimizer_run_id === integrated.optimizer_run_id);
      if (!optimizer || optimizer.optimizer_version !== integrated.optimizer_version
        || optimizer.optimizer_fingerprint !== integrated.optimizer_fingerprint) {
        throw new Error(`integrated analysis ${integrated.analysis_v3_id} does not match optimizer lineage`);
      }
      return {
        analysis_v3_id: integrated.analysis_v3_id,
        analysis_version: integrated.analysis_version,
        step2_result_id: integrated.step2_result_id,
        step2_version: integrated.step2_version,
        step2_prompt_version: integrated.step2_prompt_version,
        step2_provider: integrated.step2_provider,
        step2_model: integrated.step2_model,
        step2_created_at: exactIso(integrated.step2_created_at, 'step2 created_at'),
        step2_fingerprint: integrated.step2_fingerprint,
        optimizer_run_id: integrated.optimizer_run_id,
        optimizer_version: integrated.optimizer_version,
        optimizer_fingerprint: integrated.optimizer_fingerprint,
        analysis_v3_created_at: exactIso(integrated.analysis_v3_created_at, 'analysis_v3 created_at')
      };
    });

    const groupAt = new Date(earliestStart).toISOString();
    for (const legRow of legs) {
      const leg = decision.legs.find((item) => Number(item.leg_number) === Number(legRow.leg_number));
      const winner = winnersByLeg.get(Number(legRow.leg_number));
      const blindScore = scoreMulticlassForecastV1({
        entries: predictionEntriesFromDecisionLeg(leg, 'blind_probability'),
        winnerEntryId: winner
      });
      const decisionScore = scoreMulticlassForecastV1({
        entries: predictionEntriesFromDecisionLeg(leg, 'decision_probability'),
        winnerEntryId: winner
      });
      targets.push({
        target_id: `${row.game_round_id}:${row.id}:leg:${legRow.leg_number}`,
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
          step1_lock_created_at: exactIso(row.step1_lock_created_at, 'step1 lock created_at'),
          market_cutoff: exactIso(row.market_cutoff, 'market_cutoff'),
          decision_probability_version: row.decision_probability_version,
          decision_policy_version: row.policy_version,
          decision_created_at: exactIso(row.created_at, 'decision created_at'),
          optimizer_lineage: optimizerLineage,
          integrated_lineage: integratedLineage
        }
      });
    }
  }
  const external = await loadExternalDecisionReplayEvidenceV1(env, config);
  const combinedTargets = [...targets, ...external.targets].sort((a, b) =>
    Date.parse(a.target_group_at) - Date.parse(b.target_group_at)
    || compareId(a.target_group_id, b.target_group_id)
    || Number(a.leg_number || 0) - Number(b.leg_number || 0)
  );
  const allowedGroups = new Set();
  for (const target of combinedTargets) {
    if (allowedGroups.has(target.target_group_id)) continue;
    if (allowedGroups.size >= maxTargets) break;
    allowedGroups.add(target.target_group_id);
  }
  return {
    targets: combinedTargets.filter((target) => allowedGroups.has(target.target_group_id)),
    systemDiagnostics: [...systemDiagnostics, ...external.systemDiagnostics]
      .filter((item) => allowedGroups.has(item.target_group_id)),
    exclusions: { ...exclusions, external: external.exclusions }
  };
}

export async function runDecisionReplayV1(env, config = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const loaded = await loadDecisionTargets(env, config);
  const targets = loaded.targets;
  const regressionOnlyRoundIds = normalizeIdList(
    config.regression_only_round_ids ?? config.regressionOnlyRoundIds,
    'regression_only_round_ids'
  );
  const regressionOnly = new Set(regressionOnlyRoundIds);
  const automaticRegressionOnly = new Set();
  for (const target of targets) {
    if (target.version_metadata?.learning_eligibility
      && target.version_metadata.learning_eligibility !== 'eligible_by_timing') {
      regressionOnly.add(target.target_group_id);
      automaticRegressionOnly.add(target.target_group_id);
    }
  }
  const evidenceTargets = targets.filter((target) => !regressionOnly.has(target.target_group_id));
  const regressionTargets = targets.filter((target) => regressionOnly.has(target.target_group_id));
  const walkForward = buildWalkForwardFoldsV1(evidenceTargets, config.walk_forward ?? config.walkForward ?? {});
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
  const regressionBlindSummary = summarizeScores(regressionTargets.map((target) => ({
    ...target.variants.blind,
    target_id: target.target_id,
    target_group_id: target.target_group_id,
    target_at: target.target_at,
    forecast_variant: 'blind'
  })));
  const regressionDecisionSummary = summarizeScores(regressionTargets.map((target) => ({
    ...target.variants.decision,
    target_id: target.target_id,
    target_group_id: target.target_group_id,
    target_at: target.target_at,
    forecast_variant: 'decision'
  })));
  const testSystemDiagnostics = loaded.systemDiagnostics.filter((item) => testGroups.has(item.target_group_id));
  const regressionSystemDiagnostics = loaded.systemDiagnostics.filter((item) => regressionOnly.has(item.target_group_id));
  const systemSummary = summarizeSystems(testSystemDiagnostics);
  const regressionSystemSummary = summarizeSystems(regressionSystemDiagnostics);
  const evaluationFingerprint = await evaluationFingerprintV1(evaluations);
  const decisionLineages = uniqueDecisionLineages(targets);
  const resultBase = {
    contract_version: REPLAY_CONTRACT_VERSION,
    replay_version: REPLAY_VERSION,
    track: 'v85_v86_decision',
    status: walkForward.folds.length ? 'completed' : 'insufficient_evidence',
    config: {
      from: exactIso(config.from, 'from'),
      to: exactIso(config.to, 'to'),
      max_targets: replayTargetLimit(config.max_targets ?? config.maxTargets),
      decision_probability_version: config.decision_probability_version ?? null,
      regression_only_round_ids: regressionOnlyRoundIds,
      automatic_regression_only_round_ids: [...automaticRegressionOnly].sort(compareId),
      walk_forward: walkForward.policy
    },
    version_metadata: {
      ...resultSourceVersionMetadata(),
      decision_lineages: decisionLineages
    },
    cohort_fingerprint: null,
    evaluation_fingerprint: evaluationFingerprint,
    target_count: targets.length,
    evidence_target_count: evidenceTargets.length,
    regression_only_target_count: regressionTargets.length,
    fold_count: walkForward.folds.length,
    walk_forward: walkForward,
    exclusions: loaded.exclusions,
    blind_summary: blindSummary,
    decision_summary: decisionSummary,
    system_summary: systemSummary,
    system_diagnostics: testSystemDiagnostics,
    regression_only_summary: {
      blind: regressionBlindSummary,
      decision: regressionDecisionSummary,
      systems: regressionSystemSummary,
      system_diagnostics: regressionSystemDiagnostics
    },
    decision_minus_blind: {
      delta_log_loss: blindSummary.mean_log_loss == null || decisionSummary.mean_log_loss == null
        ? null : round(decisionSummary.mean_log_loss - blindSummary.mean_log_loss),
      delta_brier: blindSummary.mean_brier_score == null || decisionSummary.mean_brier_score == null
        ? null : round(decisionSummary.mean_brier_score - blindSummary.mean_brier_score)
    },
    scenario_summary: {
      status: 'unavailable_no_canonical_scenario_contract',
      scored_target_count: 0
    }
  };
  resultBase.cohort_fingerprint = await sha256Text(stableFeatureJson(canonicalCohortFingerprintInput(resultBase, evaluations)));
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
  const evaluations = canonicalReplayEvaluationsV1(result.evaluations);
  assertReplayAggregateConsistency(result, evaluations);
  const actualEvaluationFingerprint = await evaluationFingerprintV1(evaluations);
  if (actualEvaluationFingerprint !== result.evaluation_fingerprint) {
    throw new Error('evaluation_fingerprint does not match replay evaluations');
  }
  const actualCohortFingerprint = await sha256Text(stableFeatureJson(canonicalCohortFingerprintInput(result, evaluations)));
  if (actualCohortFingerprint !== result.cohort_fingerprint) {
    throw new Error('cohort_fingerprint does not match replay targets and version metadata');
  }
  const canonicalBase = { ...result };
  delete canonicalBase.evaluations;
  delete canonicalBase.result_fingerprint;
  const recalculated = await sha256Text(stableFeatureJson(canonicalBase));
  if (recalculated !== result.result_fingerprint) {
    throw new Error('result_fingerprint does not match canonical replay content');
  }
  const id = replayIdFromFingerprint(result.result_fingerprint);
  const resultForStorage = { ...result };
  delete resultForStorage.evaluations;
  const existing = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
  if (existing) {
    if (existing.result_fingerprint !== result.result_fingerprint || existing.evaluation_fingerprint !== result.evaluation_fingerprint) {
      throw new Error('replay id collision');
    }
    const stored = parseJson(existing.result_json, 'result_json');
    if (stableFeatureJson(stored) !== stableFeatureJson(resultForStorage)) {
      throw new Error('stored replay content does not match canonical result');
    }
    return storedReplayMetadata(existing, stored, true);
  }
  const createdAt = exactIso(options.createdAt ?? new Date().toISOString(), 'created_at');
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
        log_loss,brier_score,top1_hit,top2_hit,top3_hit,winner_rank,forecast_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,evaluation.target_id,evaluation.target_group_id,evaluation.target_at,evaluation.forecast_variant,
      evaluation.winner_entry_id,evaluation.entry_count,evaluation.log_loss,evaluation.brier_score,
      evaluation.top1_hit ? 1 : 0,evaluation.top2_hit ? 1 : 0,evaluation.top3_hit ? 1 : 0,
      evaluation.winner_rank,stableFeatureJson(evaluation.forecast)
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
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
    if (raced
      && raced.result_fingerprint === result.result_fingerprint
      && raced.evaluation_fingerprint === result.evaluation_fingerprint) {
      const stored = parseJson(raced.result_json, 'result_json');
      if (stableFeatureJson(stored) !== stableFeatureJson(resultForStorage)) {
        throw new Error('concurrent replay write stored different canonical content');
      }
      return storedReplayMetadata(raced, stored, true);
    }
    throw error;
  }
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
