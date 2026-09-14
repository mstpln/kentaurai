const FOUNDATION_CONTRACTS = Object.freeze({
  asOfSelection: 'kentaurai-as-of-v1',
  evidenceEnvelope: 'kentaurai-evidence-v1',
  featureProvenance: 'kentaurai-feature-provenance-v1',
  hierarchicalBackoff: 'kentaurai-hierarchical-backoff-v1'
});

export const ANALYSIS_V3_FOUNDATION_CONTRACTS = FOUNDATION_CONTRACTS;

export const ANALYSIS_V3_EVIDENCE_LEVELS = Object.freeze(['A', 'B', 'C', 'D']);

export const ANALYSIS_V3_EVIDENCE_POLICY = Object.freeze({
  version: FOUNDATION_CONTRACTS.evidenceEnvelope,
  levelA: Object.freeze({ minRelevantDirectSamples: 3 }),
  levelB: Object.freeze({ minDirectSamples: 1 }),
  levelC: Object.freeze({ minContextSamples: 10 }),
  fallbackLevel: 'D'
});

export const ANALYSIS_V3_INITIAL_BACKOFF_POLICY = Object.freeze({
  version: FOUNDATION_CONTRACTS.hierarchicalBackoff,
  minEffectiveSampleSize: 8,
  priorEquivalentSampleSize: 8
});

function requiredText(value, field, max = 200) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function nonNegativeNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function positiveNumber(value, field) {
  const number = nonNegativeNumber(value, field);
  if (number === 0) throw new Error(`${field} must be greater than 0`);
  return number;
}

function nullableUnitInterval(value, field) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be null or a finite number between 0 and 1`);
  }
  return value;
}

function finiteNumberOrNull(value, field) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be null or a finite number`);
  return value;
}

function evidenceValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('value must be null or a finite scalar');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function instantMs(value, field) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid instant`);
    return ms;
  }
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a valid instant`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid instant`);
  return ms;
}

function instantText(value, field) {
  const ms = instantMs(value, field);
  return new Date(ms).toISOString();
}

function canonicalize(value, path = 'value') {
  if (value === undefined) throw new Error(`${path} must not contain undefined`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers`);
    return value;
  }
  if (value instanceof Date) return instantText(value, path);
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} contains an unsupported object type`);
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key], `${path}.${key}`);
    return out;
  }
  throw new Error(`${path} contains an unsupported value type`);
}

export function stableFeatureJson(value) {
  return JSON.stringify(canonicalize(value));
}

function resolveTimeAccessor(timeAccessor) {
  if (typeof timeAccessor === 'function') return timeAccessor;
  const key = requiredText(timeAccessor, 'timeAccessor', 100);
  return (row) => row?.[key];
}

function resolveTieAccessor(tieAccessor) {
  if (tieAccessor == null) return (row) => row?.id == null ? stableFeatureJson(row) : String(row.id);
  if (typeof tieAccessor === 'function') return (row) => String(tieAccessor(row) ?? '');
  const key = requiredText(tieAccessor, 'tieAccessor', 100);
  return (row) => String(row?.[key] ?? '');
}

export function filterAsOf(rows, { asOf, timeAccessor } = {}) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const cutoff = instantMs(asOf, 'asOf');
  const getTime = resolveTimeAccessor(timeAccessor);
  return rows.filter((row) => {
    const value = getTime(row);
    if (value == null || value === '') return false;
    try {
      return instantMs(value, 'row observation time') <= cutoff;
    } catch {
      return false;
    }
  });
}

export function selectLatestAsOf(rows, { asOf, timeAccessor, tieAccessor = null } = {}) {
  const safe = filterAsOf(rows, { asOf, timeAccessor });
  if (!safe.length) return null;
  const getTime = resolveTimeAccessor(timeAccessor);
  const getTie = resolveTieAccessor(tieAccessor);
  return [...safe].sort((a, b) => {
    const timeDelta = instantMs(getTime(b), 'row observation time') - instantMs(getTime(a), 'row observation time');
    if (timeDelta !== 0) return timeDelta;
    return getTie(a).localeCompare(getTie(b));
  })[0];
}

export function classifyEvidenceLevel({ directSampleSize = 0, relevantDirectSampleSize = 0, contextSampleSize = 0 } = {}, policy = ANALYSIS_V3_EVIDENCE_POLICY) {
  nonNegativeInteger(directSampleSize, 'directSampleSize');
  nonNegativeInteger(relevantDirectSampleSize, 'relevantDirectSampleSize');
  nonNegativeInteger(contextSampleSize, 'contextSampleSize');
  if (relevantDirectSampleSize > directSampleSize) throw new Error('relevantDirectSampleSize cannot exceed directSampleSize');
  if (relevantDirectSampleSize >= policy.levelA.minRelevantDirectSamples) return 'A';
  if (directSampleSize >= policy.levelB.minDirectSamples) return 'B';
  if (contextSampleSize >= policy.levelC.minContextSamples) return 'C';
  return policy.fallbackLevel;
}

export function createEvidenceEnvelope({
  value = null,
  evidenceSource,
  evidenceLevel,
  sampleSize = 0,
  relevantSampleSize = 0,
  coverage = null,
  confidence = null,
  asOf,
  featureVersion
}) {
  if (!ANALYSIS_V3_EVIDENCE_LEVELS.includes(evidenceLevel)) throw new Error('evidenceLevel must be one of A, B, C or D');
  const sample = nonNegativeInteger(sampleSize, 'sampleSize');
  const relevant = nonNegativeInteger(relevantSampleSize, 'relevantSampleSize');
  if (relevant > sample) throw new Error('relevantSampleSize cannot exceed sampleSize');
  const normalizedValue = evidenceValue(value);
  return deepFreeze({
    contract_version: FOUNDATION_CONTRACTS.evidenceEnvelope,
    value: normalizedValue,
    evidence_source: requiredText(evidenceSource, 'evidenceSource', 120),
    evidence_level: evidenceLevel,
    sample_size: sample,
    relevant_sample_size: relevant,
    coverage: nullableUnitInterval(coverage, 'coverage'),
    confidence: nullableUnitInterval(confidence, 'confidence'),
    as_of: instantText(asOf, 'asOf'),
    feature_version: requiredText(featureVersion, 'featureVersion', 120)
  });
}

function normalizeSourceRef(source, index, featureAsOfMs) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`sourceRefs[${index}] must be an object`);
  const selectedAt = instantText(source.selected_at, `sourceRefs[${index}].selected_at`);
  if (instantMs(selectedAt, `sourceRefs[${index}].selected_at`) > featureAsOfMs) {
    throw new Error(`sourceRefs[${index}].selected_at cannot be after feature asOf`);
  }
  return {
    source_record_id: requiredText(source.source_record_id, `sourceRefs[${index}].source_record_id`, 200),
    selected_at: selectedAt,
    time_basis: requiredText(source.time_basis, `sourceRefs[${index}].time_basis`, 80)
  };
}

export function createFeatureProvenance({
  featureFamily,
  featureVersion,
  asOf,
  sourceRefs = [],
  inputVersions = {},
  parameters = {},
  backoffLevel = null,
  estimateSource = null
}) {
  if (!Array.isArray(sourceRefs)) throw new Error('sourceRefs must be an array');
  if (!inputVersions || typeof inputVersions !== 'object' || Array.isArray(inputVersions)) throw new Error('inputVersions must be an object');
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('parameters must be an object');
  const asOfText = instantText(asOf, 'asOf');
  const asOfMs = instantMs(asOfText, 'asOf');
  const payload = {
    contract_version: FOUNDATION_CONTRACTS.featureProvenance,
    feature_family: requiredText(featureFamily, 'featureFamily', 120),
    feature_version: requiredText(featureVersion, 'featureVersion', 120),
    as_of: asOfText,
    source_refs: sourceRefs.map((source, index) => normalizeSourceRef(source, index, asOfMs)).sort((a, b) =>
      `${a.source_record_id}|${a.selected_at}|${a.time_basis}`.localeCompare(`${b.source_record_id}|${b.selected_at}|${b.time_basis}`)
    ),
    input_versions: canonicalize(inputVersions, 'inputVersions'),
    parameters: canonicalize(parameters, 'parameters'),
    backoff_level: backoffLevel == null ? null : requiredText(backoffLevel, 'backoffLevel', 120),
    estimate_source: estimateSource == null ? null : requiredText(estimateSource, 'estimateSource', 120)
  };
  return deepFreeze(payload);
}

export function serializeFeatureProvenance(provenance) {
  return stableFeatureJson(provenance);
}

function normalizeFeatureDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('feature definition must be an object');
  return deepFreeze({
    family: requiredText(definition.family, 'feature definition family', 120),
    version: requiredText(definition.version, 'feature definition version', 120),
    semantics: requiredText(definition.semantics, 'feature definition semantics', 2000),
    parameters: canonicalize(definition.parameters ?? {}, 'feature definition parameters')
  });
}

export function createFeatureVersionRegistry(initialDefinitions = []) {
  if (!Array.isArray(initialDefinitions)) throw new Error('initialDefinitions must be an array');
  const registry = new Map();
  function register(definition) {
    const normalized = normalizeFeatureDefinition(definition);
    const key = `${normalized.family}@${normalized.version}`;
    const existing = registry.get(key);
    if (existing && stableFeatureJson(existing) !== stableFeatureJson(normalized)) {
      throw new Error(`feature version ${key} is already registered with different semantics`);
    }
    if (!existing) registry.set(key, normalized);
    return registry.get(key);
  }
  for (const definition of initialDefinitions) register(definition);
  return Object.freeze({
    register,
    get(family, version) {
      return registry.get(`${requiredText(family, 'family', 120)}@${requiredText(version, 'version', 120)}`) ?? null;
    },
    snapshot() {
      return [...registry.values()]
        .map((definition) => canonicalize(definition))
        .sort((a, b) => `${a.family}@${a.version}`.localeCompare(`${b.family}@${b.version}`));
    }
  });
}

function normalizeCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`backoffCandidates[${index}] must be an object`);
  return {
    level: requiredText(candidate.level, `backoffCandidates[${index}].level`, 120),
    value: finiteNumberOrNull(candidate.value, `backoffCandidates[${index}].value`),
    sample_size: nonNegativeInteger(candidate.sampleSize ?? 0, `backoffCandidates[${index}].sampleSize`),
    effective_sample_size: nonNegativeNumber(candidate.effectiveSampleSize ?? candidate.sampleSize ?? 0, `backoffCandidates[${index}].effectiveSampleSize`)
  };
}

export function estimateWithHierarchicalBackoff({
  directValue = null,
  directSampleSize = 0,
  backoffCandidates = [],
  policy = ANALYSIS_V3_INITIAL_BACKOFF_POLICY
} = {}) {
  const direct = finiteNumberOrNull(directValue, 'directValue');
  const directN = nonNegativeInteger(directSampleSize, 'directSampleSize');
  if (!Array.isArray(backoffCandidates)) throw new Error('backoffCandidates must be an array');
  const minEffective = nonNegativeNumber(policy.minEffectiveSampleSize, 'policy.minEffectiveSampleSize');
  const priorN = positiveNumber(policy.priorEquivalentSampleSize, 'policy.priorEquivalentSampleSize');
  const candidates = backoffCandidates.map(normalizeCandidate);
  const prior = candidates.find((candidate) => candidate.value != null && candidate.effective_sample_size >= minEffective) ?? null;

  if (direct != null && directN > 0 && prior) {
    const denominator = directN + priorN;
    return Object.freeze({
      contract_version: FOUNDATION_CONTRACTS.hierarchicalBackoff,
      value: ((direct * directN) + (prior.value * priorN)) / denominator,
      evidence_source: 'direct_plus_model_estimate',
      direct_sample_size: directN,
      backoff_level: prior.level,
      backoff_sample_size: prior.sample_size,
      backoff_effective_sample_size: prior.effective_sample_size,
      direct_weight: directN / denominator,
      prior_weight: priorN / denominator,
      policy_version: requiredText(policy.version, 'policy.version', 120)
    });
  }

  if (direct != null && directN > 0) {
    return Object.freeze({
      contract_version: FOUNDATION_CONTRACTS.hierarchicalBackoff,
      value: direct,
      evidence_source: 'direct',
      direct_sample_size: directN,
      backoff_level: null,
      backoff_sample_size: 0,
      backoff_effective_sample_size: 0,
      direct_weight: 1,
      prior_weight: 0,
      policy_version: requiredText(policy.version, 'policy.version', 120)
    });
  }

  if (prior) {
    return Object.freeze({
      contract_version: FOUNDATION_CONTRACTS.hierarchicalBackoff,
      value: prior.value,
      evidence_source: 'model_estimate',
      direct_sample_size: directN,
      backoff_level: prior.level,
      backoff_sample_size: prior.sample_size,
      backoff_effective_sample_size: prior.effective_sample_size,
      direct_weight: 0,
      prior_weight: 1,
      policy_version: requiredText(policy.version, 'policy.version', 120)
    });
  }

  return Object.freeze({
    contract_version: FOUNDATION_CONTRACTS.hierarchicalBackoff,
    value: null,
    evidence_source: 'unknown',
    direct_sample_size: directN,
    backoff_level: null,
    backoff_sample_size: 0,
    backoff_effective_sample_size: 0,
    direct_weight: 0,
    prior_weight: 0,
    policy_version: requiredText(policy.version, 'policy.version', 120)
  });
}
