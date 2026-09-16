import { stableFeatureJson } from './analysis-v3-foundations.js';
import {
  ANALYSIS_STEP1_LOCK_CONTRACT,
  assertStep1MarketBlind,
  step1LockHash,
  validateStep1LockV1AgainstPack
} from './analysis-step1-lock-v1.js';
import { ANALYSIS_STEP1_PROMPT_V3_VERSION } from './analysis-step1-prompt-v3.js';
import {
  ANALYSIS_STEP1_REVISION_CONTRACT,
  ANALYSIS_STEP1_REVISION_PROMPT_VERSION
} from './analysis-step1-revision-prompt-v1.js';

const REVISION_KEYS = new Set([
  'contract_version', 'revision_id', 'child_lock_id', 'round_id', 'parent_lock_id',
  'parent_lock_hash', 'target_pack', 'provider', 'model', 'prompt_version', 'revised_legs'
]);
const TARGET_PACK_KEYS = new Set(['pack_id', 'as_of', 'facts_fingerprint']);
const VALID_PROVIDERS = new Set(['openai', 'anthropic']);

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function timestamp(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function assertAllowedKeys(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${field} contains unsupported fields: ${unknown.slice(0, 10).join(', ')}`);
}

function inspectNonSnakeCaseKeys(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectNonSnakeCaseKeys(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, nested] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) out.push(`${path}.${key}`);
    inspectNonSnakeCaseKeys(nested, `${path}.${key}`, out);
  }
  return out;
}

function assertSnakeCase(value) {
  const invalid = inspectNonSnakeCaseKeys(value);
  if (invalid.length) throw new Error(`Step 1 revision keys must use strict snake_case: ${invalid.slice(0, 10).join(', ')}`);
}

function normalizeProvider(value) {
  const provider = requiredText(value, 'provider', 40).toLowerCase();
  if (!VALID_PROVIDERS.has(provider)) throw new Error('provider must be openai or anthropic');
  return provider;
}

function sameNumberSet(left, right) {
  const a = [...left].map(Number).sort((x, y) => x - y);
  const b = [...right].map(Number).sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function composeStep1RevisionChildLockV1({ payload, revisionPack, parentLock, targetPack } = {}) {
  assertSnakeCase(payload);
  assertAllowedKeys(payload, REVISION_KEYS, 'Step 1 revision');
  assertStep1MarketBlind(payload, 'Step 1 revision');
  if (requiredText(payload.contract_version, 'contract_version') !== ANALYSIS_STEP1_REVISION_CONTRACT) {
    throw new Error(`contract_version must be ${ANALYSIS_STEP1_REVISION_CONTRACT}`);
  }
  if (revisionPack?.revision_required !== true) throw new Error('server revision pack does not require a revision');
  const revisionId = requiredText(payload.revision_id, 'revision_id', 160);
  const childLockId = requiredText(payload.child_lock_id, 'child_lock_id', 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(revisionId)) throw new Error('revision_id contains unsupported characters');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(childLockId)) throw new Error('child_lock_id contains unsupported characters');
  const roundId = requiredText(payload.round_id, 'round_id');
  if (roundId !== revisionPack.round_id) throw new Error('round_id does not match the server revision pack');
  const parentLockId = requiredText(payload.parent_lock_id, 'parent_lock_id', 160);
  const parentLockHash = requiredText(payload.parent_lock_hash, 'parent_lock_hash', 100);
  if (parentLockId !== revisionPack.parent_lock.lock_id || parentLockHash !== revisionPack.parent_lock.lock_hash) {
    throw new Error('parent lock identity does not match the server revision pack');
  }
  assertAllowedKeys(payload.target_pack, TARGET_PACK_KEYS, 'target_pack');
  const target = {
    pack_id: requiredText(payload.target_pack.pack_id, 'target_pack.pack_id'),
    as_of: timestamp(payload.target_pack.as_of, 'target_pack.as_of'),
    facts_fingerprint: requiredText(payload.target_pack.facts_fingerprint, 'target_pack.facts_fingerprint', 160)
  };
  if (target.pack_id !== revisionPack.target_pack.pack_id || target.as_of !== revisionPack.target_pack.as_of || target.facts_fingerprint !== revisionPack.target_pack.facts_fingerprint) {
    throw new Error('target_pack does not match the server revision pack');
  }
  const provider = normalizeProvider(payload.provider);
  const model = requiredText(payload.model, 'model', 160);
  const promptVersion = requiredText(payload.prompt_version, 'prompt_version', 120);
  if (promptVersion !== ANALYSIS_STEP1_REVISION_PROMPT_VERSION) throw new Error(`prompt_version must be ${ANALYSIS_STEP1_REVISION_PROMPT_VERSION}`);
  if (!Array.isArray(payload.revised_legs)) throw new Error('revised_legs must be an array');
  const revisedNumbers = payload.revised_legs.map((leg) => Number(leg?.leg_number));
  if (!sameNumberSet(revisedNumbers, revisionPack.affected_legs)) throw new Error('revised_legs must match affected_legs exactly');
  if (new Set(revisedNumbers).size !== revisedNumbers.length) throw new Error('revised_legs contains duplicate leg numbers');

  const revisedByLeg = new Map(payload.revised_legs.map((leg) => [Number(leg.leg_number), leg]));
  // Reuse the proven D2 structural validator with its original prompt marker, then seal truthful D3 prompt provenance.
  const validationCandidate = {
    contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    lock_id: childLockId,
    round_id: roundId,
    pack: target,
    provider,
    model,
    prompt_version: ANALYSIS_STEP1_PROMPT_V3_VERSION,
    legs: (parentLock.legs || []).map((leg) => revisedByLeg.get(Number(leg.leg_number)) || leg)
  };
  const validated = await validateStep1LockV1AgainstPack(validationCandidate, targetPack);
  validated.prompt_version = ANALYSIS_STEP1_REVISION_PROMPT_VERSION;
  assertStep1MarketBlind(validated, 'Step 1 revision child lock');
  const childLockJson = stableFeatureJson(validated);
  const childLockHash = await step1LockHash(validated);
  const normalizedRevisedLegs = validated.legs.filter((leg) => revisionPack.affected_legs.includes(Number(leg.leg_number)));
  const normalizedRevision = {
    contract_version: ANALYSIS_STEP1_REVISION_CONTRACT,
    revision_id: revisionId,
    child_lock_id: childLockId,
    round_id: roundId,
    parent_lock_id: parentLockId,
    parent_lock_hash: parentLockHash,
    target_pack: target,
    provider,
    model,
    prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
    revised_legs: normalizedRevisedLegs
  };
  const revisionJson = stableFeatureJson(normalizedRevision);
  const revisionHash = await sha256Text(revisionJson);
  return { normalizedRevision, revisionJson, revisionHash, childLock: validated, childLockJson, childLockHash };
}
