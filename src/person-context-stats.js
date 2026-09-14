import { ANALYSIS_V3_INITIAL_BACKOFF_POLICY, classifyEvidenceLevel, createEvidenceEnvelope, estimateWithHierarchicalBackoff } from './analysis-v3-foundations.js';

function number(value) { const n = Number(value); return value == null || !Number.isFinite(n) ? null : n; }
function flag(value) { if (value === true || value === 1 || value === '1') return true; if (value === false || value === 0 || value === '0') return false; return null; }

export function placingStats(rows) {
  const values = rows.map((row) => number(row.placing)).filter((value) => value != null && value > 0);
  return { known: values.length, winRate: values.length ? values.filter((value) => value === 1).length / values.length : null, top3Rate: values.length ? values.filter((value) => value <= 3).length / values.length : null };
}

export function binaryStats(rows, field) {
  const values = rows.map((row) => flag(row[field])).filter((value) => value != null);
  return { known: values.length, rate: values.length ? values.filter(Boolean).length / values.length : null };
}

export function personEvidence({ value, source, known = 0, total = known, asOf, version, context = 0 }) {
  const coverage = total > 0 ? Math.min(1, known / total) : null;
  const sample = Number.isInteger(known) ? Math.max(0, known) : 0;
  const confidence = value == null || !(sample || context) ? null : Math.min(1, (sample || context) / ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize) * (coverage ?? 1);
  return createEvidenceEnvelope({ value: value ?? null, evidenceSource: source, evidenceLevel: classifyEvidenceLevel({ directSampleSize: sample, relevantDirectSampleSize: sample, contextSampleSize: context }), sampleSize: sample, relevantSampleSize: sample, coverage, confidence, asOf, featureVersion: version });
}

export function shrinkRate(value, sample, baselineValue, baselineSample) {
  return estimateWithHierarchicalBackoff({ directValue: value, directSampleSize: sample, backoffCandidates: baselineValue != null && baselineSample > 0 ? [{ level: 'person_365d_baseline', value: baselineValue, sampleSize: baselineSample, effectiveSampleSize: baselineSample }] : [] });
}

export function shrinkDelta(value, sample) {
  return estimateWithHierarchicalBackoff({ directValue: value, directSampleSize: sample, backoffCandidates: value != null && sample > 0 ? [{ level: 'no_relative_change_prior', value: 0, sampleSize: 8, effectiveSampleSize: 8 }] : [] });
}
