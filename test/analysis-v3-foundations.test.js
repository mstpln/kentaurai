import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ANALYSIS_V3_EVIDENCE_POLICY,
  ANALYSIS_V3_FOUNDATION_CONTRACTS,
  ANALYSIS_V3_INITIAL_BACKOFF_POLICY,
  classifyEvidenceLevel,
  createEvidenceEnvelope,
  createFeatureProvenance,
  createFeatureVersionRegistry,
  estimateWithHierarchicalBackoff,
  filterAsOf,
  selectLatestAsOf,
  serializeFeatureProvenance,
  stableFeatureJson
} from '../src/analysis-v3-foundations.js';

const here = dirname(fileURLToPath(import.meta.url));
const leakageFixture = JSON.parse(readFileSync(resolve(here, '../fixtures/analysis-v3-foundations.example.json'), 'utf8'));

test('future observations never enter a past as-of view', () => {
  const safe = filterAsOf(leakageFixture.snapshots, { asOf: leakageFixture.as_of, timeAccessor: 'observed_at' });
  assert.deepEqual(safe.map((row) => row.id), leakageFixture.expected_eligible_ids);
  assert.equal(
    selectLatestAsOf(leakageFixture.snapshots, { asOf: leakageFixture.as_of, timeAccessor: 'observed_at' }).id,
    leakageFixture.expected_latest_id
  );
});

test('as-of tie-breaking is deterministic and does not mutate source rows', () => {
  const rows = [
    { id: 'b', observed_at: '2026-09-10T12:00:00Z' },
    { id: 'a', observed_at: '2026-09-10T12:00:00Z' }
  ];
  const before = JSON.stringify(rows);
  const selected = selectLatestAsOf(rows, { asOf: '2026-09-11T00:00:00Z', timeAccessor: 'observed_at' });
  assert.equal(selected.id, 'a');
  assert.equal(JSON.stringify(rows), before);
});

test('evidence envelope preserves null and zero as different factual states', () => {
  const common = {
    evidenceSource: 'official_history', evidenceLevel: 'B', sampleSize: 2, relevantSampleSize: 1,
    coverage: 0, confidence: 0, asOf: '2026-09-10T12:00:00Z', featureVersion: 'synthetic-feature-v1'
  };
  const zero = createEvidenceEnvelope({ ...common, value: 0 });
  const missing = createEvidenceEnvelope({ ...common, value: null });
  assert.equal(zero.value, 0);
  assert.equal(missing.value, null);
  assert.equal(zero.coverage, 0);
  assert.equal(zero.confidence, 0);
});

test('evidence level describes evidence strength without changing numeric strength', () => {
  const common = {
    value: 0.42, evidenceSource: 'synthetic', sampleSize: 3, relevantSampleSize: 3,
    coverage: 0.5, confidence: 0.5, asOf: '2026-09-10T12:00:00Z', featureVersion: 'synthetic-feature-v1'
  };
  const strong = createEvidenceEnvelope({ ...common, evidenceLevel: 'A' });
  const weak = createEvidenceEnvelope({ ...common, evidenceLevel: 'D' });
  assert.equal(strong.value, 0.42);
  assert.equal(weak.value, 0.42);
});

test('canonical evidence ladder uses explicit versioned thresholds', () => {
  assert.equal(ANALYSIS_V3_EVIDENCE_POLICY.levelA.minRelevantDirectSamples, 3);
  assert.equal(classifyEvidenceLevel({ directSampleSize: 4, relevantDirectSampleSize: 3 }), 'A');
  assert.equal(classifyEvidenceLevel({ directSampleSize: 1, relevantDirectSampleSize: 0 }), 'B');
  assert.equal(classifyEvidenceLevel({ directSampleSize: 0, relevantDirectSampleSize: 0, contextSampleSize: 10 }), 'C');
  assert.equal(classifyEvidenceLevel({ directSampleSize: 0, relevantDirectSampleSize: 0, contextSampleSize: 9 }), 'D');
});

test('feature provenance serialization is stable across object key order', () => {
  const a = createFeatureProvenance({
    featureFamily: 'synthetic_profile', featureVersion: 'synthetic-profile-v1', asOf: '2026-09-10T12:00:00Z',
    sourceRefs: [
      { source_record_id: 'src_2', selected_at: '2026-09-09T00:00:00Z', time_basis: 'observed_at' },
      { source_record_id: 'src_1', selected_at: '2026-09-08T00:00:00Z', time_basis: 'effective_at' }
    ],
    inputVersions: { zeta: 'z1', alpha: 'a1' }, parameters: { beta: 2, alpha: 1 }
  });
  const b = createFeatureProvenance({
    featureFamily: 'synthetic_profile', featureVersion: 'synthetic-profile-v1', asOf: '2026-09-10T12:00:00Z',
    sourceRefs: [
      { time_basis: 'effective_at', selected_at: '2026-09-08T00:00:00Z', source_record_id: 'src_1' },
      { time_basis: 'observed_at', selected_at: '2026-09-09T00:00:00Z', source_record_id: 'src_2' }
    ],
    inputVersions: { alpha: 'a1', zeta: 'z1' }, parameters: { alpha: 1, beta: 2 }
  });
  assert.equal(serializeFeatureProvenance(a), serializeFeatureProvenance(b));
  assert.equal(stableFeatureJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('feature provenance rejects a source timestamp after the feature as-of cutoff', () => {
  assert.throws(() => createFeatureProvenance({
    featureFamily: 'synthetic_profile',
    featureVersion: 'synthetic-profile-v1',
    asOf: '2026-09-10T12:00:00Z',
    sourceRefs: [{
      source_record_id: 'src_future',
      selected_at: '2026-09-10T12:00:01Z',
      time_basis: 'observed_at'
    }]
  }), /cannot be after feature asOf/);
});

test('feature version registry is immutable by semantic version key', () => {
  const registry = createFeatureVersionRegistry([{
    family: 'synthetic_profile', version: 'synthetic-profile-v1', semantics: 'Synthetic semantics.', parameters: { window: 5 }
  }]);
  assert.equal(registry.get('synthetic_profile', 'synthetic-profile-v1').parameters.window, 5);
  assert.doesNotThrow(() => registry.register({
    family: 'synthetic_profile', version: 'synthetic-profile-v1', semantics: 'Synthetic semantics.', parameters: { window: 5 }
  }));
  assert.throws(() => registry.register({
    family: 'synthetic_profile', version: 'synthetic-profile-v1', semantics: 'Changed semantics.', parameters: { window: 5 }
  }), /different semantics/);
});

test('hierarchical backoff is explicit, null-safe and marks fallbacks as model estimates', () => {
  assert.equal(ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize, 8);
  assert.equal(ANALYSIS_V3_INITIAL_BACKOFF_POLICY.priorEquivalentSampleSize, 8);
  const fallback = estimateWithHierarchicalBackoff({
    directValue: null,
    directSampleSize: 0,
    backoffCandidates: [
      { level: 'track_method_distance', value: 0.31, sampleSize: 5, effectiveSampleSize: 5 },
      { level: 'track_method', value: 0.27, sampleSize: 22, effectiveSampleSize: 14.5 }
    ]
  });
  assert.equal(fallback.value, 0.27);
  assert.equal(fallback.evidence_source, 'model_estimate');
  assert.equal(fallback.backoff_level, 'track_method');

  const unknown = estimateWithHierarchicalBackoff({
    directValue: null,
    backoffCandidates: [{ level: 'broad', value: 0.1, sampleSize: 4, effectiveSampleSize: 4 }]
  });
  assert.equal(unknown.value, null);
  assert.equal(unknown.evidence_source, 'unknown');
});

test('hierarchical shrinkage keeps zero as a real direct value', () => {
  const result = estimateWithHierarchicalBackoff({
    directValue: 0,
    directSampleSize: 8,
    backoffCandidates: [{ level: 'broad', value: 1, sampleSize: 100, effectiveSampleSize: 100 }]
  });
  assert.equal(result.value, 0.5);
  assert.equal(result.evidence_source, 'direct_plus_model_estimate');
  assert.equal(result.direct_weight, 0.5);
  assert.equal(result.prior_weight, 0.5);
});

test('foundation contract identifiers are stable and explicit', () => {
  assert.deepEqual(ANALYSIS_V3_FOUNDATION_CONTRACTS, {
    asOfSelection: 'kentaurai-as-of-v1',
    evidenceEnvelope: 'kentaurai-evidence-v1',
    featureProvenance: 'kentaurai-feature-provenance-v1',
    hierarchicalBackoff: 'kentaurai-hierarchical-backoff-v1'
  });
});
