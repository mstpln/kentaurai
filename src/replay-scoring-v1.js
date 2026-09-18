import { stableFeatureJson } from './analysis-v3-foundations.js';

export const REPLAY_CONTRACT_VERSION = 'kentaurai-replay-v1';
export const REPLAY_VERSION = 'replay-calibration-v1-f1';
export const REPLAY_SCORING_VERSION = 'proper-scoring-v1';
export const REPLAY_CALIBRATION_VERSION = 'decile-calibration-v1';
export const REPLAY_LOG_LOSS_FLOOR = 1e-15;

const PROBABILITY_TOLERANCE = 1e-6;
const COVERAGE_BUCKETS = new Set(['zero','low','mixed','high']);

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function probability(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a probability between 0 and 1`);
  }
  return value;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function calibrationBinV1(probabilityValue) {
  const p = probability(probabilityValue, 'probability');
  return Math.min(9, Math.floor(p * 10));
}

export function coverageBucketV1(value) {
  if (value == null) return null;
  const coverage = probability(value, 'coverage');
  if (coverage === 0) return 'zero';
  if (coverage < 0.34) return 'low';
  if (coverage < 0.8) return 'mixed';
  return 'high';
}

export function scoreProbabilityDistributionV1(entries, winnerEntryId) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('forecast distribution must contain at least two entries');
  const winner = requiredText(winnerEntryId, 'winner_entry_id', 200);
  const seen = new Set();
  let total = 0;
  const normalized = entries.map((entry, index) => {
    const raceEntryId = requiredText(entry?.race_entry_id ?? entry?.raceEntryId, `entries[${index}].race_entry_id`, 200);
    if (seen.has(raceEntryId)) throw new Error(`duplicate forecast entry ${raceEntryId}`);
    seen.add(raceEntryId);
    const p = probability(entry?.probability, `entries[${index}].probability`);
    total += p;
    return { race_entry_id: raceEntryId, probability: p };
  });
  if (!seen.has(winner)) throw new Error('winner is not present in forecast distribution');
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) throw new Error('forecast probabilities must sum to 1');

  const ordered = [...normalized].sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return a.race_entry_id < b.race_entry_id ? -1 : a.race_entry_id > b.race_entry_id ? 1 : 0;
  });
  const winnerProbability = normalized.find((entry) => entry.race_entry_id === winner).probability;
  const logLoss = -Math.log(Math.max(REPLAY_LOG_LOSS_FLOOR, winnerProbability));
  const brier = normalized.reduce((sum, entry) => {
    const observed = entry.race_entry_id === winner ? 1 : 0;
    return sum + ((entry.probability - observed) ** 2);
  }, 0);

  return {
    scoring_version: REPLAY_SCORING_VERSION,
    winner_entry_id: winner,
    winner_probability: winnerProbability,
    log_loss: logLoss,
    brier_score: brier,
    top1_hit: ordered[0]?.race_entry_id === winner,
    top2_coverage: ordered.slice(0, 2).some((entry) => entry.race_entry_id === winner),
    entry_count: normalized.length,
    probability_observations: normalized
      .map((entry) => ({
        race_entry_id: entry.race_entry_id,
        probability: entry.probability,
        won: entry.race_entry_id === winner,
        calibration_bin: calibrationBinV1(entry.probability)
      }))
      .sort((a, b) => a.race_entry_id < b.race_entry_id ? -1 : a.race_entry_id > b.race_entry_id ? 1 : 0)
  };
}

export function summarizeCalibrationV1(observations) {
  if (!Array.isArray(observations)) throw new Error('observations must be an array');
  const bins = Array.from({ length: 10 }, (_, bin) => ({
    bin,
    lower: bin / 10,
    upper: bin === 9 ? 1 : (bin + 1) / 10,
    count: 0,
    mean_probability: null,
    observed_frequency: null
  }));
  const probabilities = Array.from({ length: 10 }, () => []);
  const outcomes = Array.from({ length: 10 }, () => []);

  for (const [index, observation] of observations.entries()) {
    const p = probability(observation?.probability, `observations[${index}].probability`);
    const won = observation?.won === true || observation?.won === 1;
    const bin = calibrationBinV1(p);
    probabilities[bin].push(p);
    outcomes[bin].push(won ? 1 : 0);
  }

  let ece = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    bins[bin].count = probabilities[bin].length;
    bins[bin].mean_probability = mean(probabilities[bin]);
    bins[bin].observed_frequency = mean(outcomes[bin]);
    if (bins[bin].count && observations.length) {
      ece += (bins[bin].count / observations.length)
        * Math.abs(bins[bin].mean_probability - bins[bin].observed_frequency);
    }
  }
  return {
    calibration_version: REPLAY_CALIBRATION_VERSION,
    observation_count: observations.length,
    expected_calibration_error: observations.length ? ece : null,
    bins
  };
}

function normalizeFamilySet(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return [...new Set(value.map((item, index) => requiredText(item, `${field}[${index}]`, 160)))].sort();
}

export function assertDeclaredAblationV1(baselineManifest, candidateManifest, declaredFeatureFamily) {
  const declared = requiredText(declaredFeatureFamily, 'declared_feature_family', 160);
  const baselineFamilies = normalizeFamilySet(baselineManifest?.declared_feature_families ?? [], 'baseline.declared_feature_families');
  const candidateFamilies = normalizeFamilySet(candidateManifest?.declared_feature_families ?? [], 'candidate.declared_feature_families');
  const all = new Set([...baselineFamilies, ...candidateFamilies]);
  const changed = [...all].filter((family) => baselineFamilies.includes(family) !== candidateFamilies.includes(family)).sort();
  const undeclared = changed.filter((family) => family !== declared);
  if (undeclared.length) {
    throw new Error(`ablation changes undeclared feature families: ${undeclared.join(', ')}`);
  }
  if (!changed.includes(declared)) {
    throw new Error('ablation pair does not actually change the declared feature family');
  }

  const baselineCore = { ...baselineManifest, declared_feature_families: undefined };
  const candidateCore = { ...candidateManifest, declared_feature_families: undefined };
  if (stableFeatureJson(baselineCore) !== stableFeatureJson(candidateCore)) {
    throw new Error('ablation manifests differ outside declared feature-family membership');
  }
  return { declared_feature_family: declared, changed_feature_families: changed };
}

export function summarizePairedAblationV1({
  pairs,
  declaredFeatureFamily,
  coverageBucket = 'all',
  minPairs = 20
} = {}) {
  if (!Array.isArray(pairs)) throw new Error('pairs must be an array');
  if (coverageBucket !== 'all' && !COVERAGE_BUCKETS.has(coverageBucket)) throw new Error('unsupported coverage bucket');
  const minimum = Number(minPairs);
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error('minPairs must be a positive integer');

  const filtered = pairs.filter((pair) => coverageBucket === 'all' || pair.coverage_bucket === coverageBucket);
  for (const pair of filtered) {
    assertDeclaredAblationV1(pair.baseline_feature_manifest, pair.candidate_feature_manifest, declaredFeatureFamily);
  }
  const baselineLog = filtered.map((pair) => Number(pair.baseline_log_loss)).filter(Number.isFinite);
  const candidateLog = filtered.map((pair) => Number(pair.candidate_log_loss)).filter(Number.isFinite);
  const baselineBrier = filtered.map((pair) => Number(pair.baseline_brier)).filter(Number.isFinite);
  const candidateBrier = filtered.map((pair) => Number(pair.candidate_brier)).filter(Number.isFinite);
  if (baselineLog.length !== filtered.length || candidateLog.length !== filtered.length
    || baselineBrier.length !== filtered.length || candidateBrier.length !== filtered.length) {
    throw new Error('paired ablation rows must contain finite log-loss and Brier values');
  }

  const baselineLogLoss = mean(baselineLog);
  const candidateLogLoss = mean(candidateLog);
  const baselineBrierScore = mean(baselineBrier);
  const candidateBrierScore = mean(candidateBrier);
  let evidenceStatus = 'insufficient';
  if (filtered.length >= minimum) {
    const betterLog = candidateLogLoss < baselineLogLoss;
    const betterBrier = candidateBrierScore < baselineBrierScore;
    const worseLog = candidateLogLoss > baselineLogLoss;
    const worseBrier = candidateBrierScore > baselineBrierScore;
    if (betterLog && betterBrier) evidenceStatus = 'candidate_better';
    else if (worseLog && worseBrier) evidenceStatus = 'candidate_worse';
    else evidenceStatus = 'mixed_no_clear_gain';
  }

  return {
    declared_feature_family: requiredText(declaredFeatureFamily, 'declared_feature_family', 160),
    coverage_bucket: coverageBucket,
    paired_target_count: filtered.length,
    baseline_log_loss: baselineLogLoss,
    candidate_log_loss: candidateLogLoss,
    delta_log_loss: baselineLogLoss == null || candidateLogLoss == null ? null : candidateLogLoss - baselineLogLoss,
    baseline_brier: baselineBrierScore,
    candidate_brier: candidateBrierScore,
    delta_brier: baselineBrierScore == null || candidateBrierScore == null ? null : candidateBrierScore - baselineBrierScore,
    evidence_status: evidenceStatus
  };
}
