import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrationBinV1,
  coverageBucketV1,
  scoreProbabilityDistributionV1,
  summarizeCalibrationV1,
  assertDeclaredAblationV1,
  summarizePairedAblationV1
} from '../src/replay-scoring-v1.js';

test('F1 proper scoring is deterministic for a known multiclass forecast', () => {
  const entries = [
    { race_entry_id: 'a', probability: 0.6 },
    { race_entry_id: 'b', probability: 0.3 },
    { race_entry_id: 'c', probability: 0.1 }
  ];
  const first = scoreProbabilityDistributionV1(entries, 'b');
  const second = scoreProbabilityDistributionV1([...entries].reverse(), 'b');
  assert.equal(first.winner_probability, 0.3);
  assert.ok(Math.abs(first.log_loss - (-Math.log(0.3))) < 1e-12);
  assert.ok(Math.abs(first.brier_score - (0.36 + 0.49 + 0.01)) < 1e-12);
  assert.equal(first.top1_hit, false);
  assert.equal(first.top2_coverage, true);
  assert.deepEqual(first, second);
});

test('F1 probability scorer rejects malformed distributions', () => {
  assert.throws(
    () => scoreProbabilityDistributionV1([{ race_entry_id: 'a', probability: 0.6 }, { race_entry_id: 'b', probability: 0.3 }], 'a'),
    /sum to 1/
  );
  assert.throws(
    () => scoreProbabilityDistributionV1([{ race_entry_id: 'a', probability: 0.5 }, { race_entry_id: 'a', probability: 0.5 }], 'a'),
    /duplicate/
  );
  assert.throws(
    () => scoreProbabilityDistributionV1([{ race_entry_id: 'a', probability: 0.5 }, { race_entry_id: 'b', probability: 0.5 }], 'c'),
    /winner is not present/
  );
});

test('F1 decile calibration and X-Labs coverage buckets are stable at boundaries', () => {
  assert.equal(calibrationBinV1(0), 0);
  assert.equal(calibrationBinV1(0.1), 1);
  assert.equal(calibrationBinV1(0.999), 9);
  assert.equal(calibrationBinV1(1), 9);
  assert.equal(coverageBucketV1(0), 'zero');
  assert.equal(coverageBucketV1(0.01), 'low');
  assert.equal(coverageBucketV1(0.34), 'mixed');
  assert.equal(coverageBucketV1(0.8), 'high');

  const calibration = summarizeCalibrationV1([
    { probability: 0.1, won: false },
    { probability: 0.2, won: false },
    { probability: 0.8, won: true },
    { probability: 0.9, won: true }
  ]);
  assert.equal(calibration.observation_count, 4);
  assert.equal(calibration.bins[1].count, 1);
  assert.equal(calibration.bins[8].observed_frequency, 1);
  assert.ok(calibration.expected_calibration_error >= 0);
});

test('F1 ablation validation permits only the declared feature-family membership change', () => {
  const base = {
    contract_version: 'manifest-v1',
    deterministic_feature_contract: 'features-v3',
    evaluation_invariant: { policy: 'same' },
    declared_feature_families: ['form', 'class']
  };
  const candidate = {
    ...base,
    declared_feature_families: ['form', 'class', 'xlabs_interval_profile']
  };
  assert.deepEqual(
    assertDeclaredAblationV1(base, candidate, 'xlabs_interval_profile'),
    { declared_feature_family: 'xlabs_interval_profile', changed_feature_families: ['xlabs_interval_profile'] }
  );

  assert.throws(
    () => assertDeclaredAblationV1(base, { ...candidate, evaluation_invariant: { policy: 'changed' } }, 'xlabs_interval_profile'),
    /differ outside declared/
  );
  assert.throws(
    () => assertDeclaredAblationV1(base, { ...base, declared_feature_families: ['class', 'other'] }, 'other'),
    /undeclared feature families/
  );
});

test('F1 paired ablation needs repeated evidence and both proper scores to improve', () => {
  const baseManifest = { invariant: 'same', declared_feature_families: ['form'] };
  const candidateManifest = { invariant: 'same', declared_feature_families: ['form', 'xlabs'] };
  const pairs = Array.from({ length: 3 }, (_, index) => ({
    target_group_id: `race-${index}`,
    coverage_bucket: index === 0 ? 'low' : 'high',
    baseline_log_loss: 0.8,
    candidate_log_loss: 0.7,
    baseline_brier: 0.4,
    candidate_brier: 0.35,
    baseline_feature_manifest: baseManifest,
    candidate_feature_manifest: candidateManifest
  }));
  const insufficient = summarizePairedAblationV1({
    pairs,
    declaredFeatureFamily: 'xlabs',
    minPairs: 4
  });
  assert.equal(insufficient.evidence_status, 'insufficient');

  const better = summarizePairedAblationV1({
    pairs,
    declaredFeatureFamily: 'xlabs',
    minPairs: 3
  });
  assert.equal(better.evidence_status, 'candidate_better');
  assert.ok(better.delta_log_loss < 0);
  assert.ok(better.delta_brier < 0);

  const highOnly = summarizePairedAblationV1({
    pairs,
    declaredFeatureFamily: 'xlabs',
    coverageBucket: 'high',
    minPairs: 1
  });
  assert.equal(highOnly.paired_target_count, 2);
});
