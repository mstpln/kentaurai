import { stableFeatureJson } from './analysis-v3-foundations.js';
import { assertAnalysisPackMarketBlind } from './analysis-pack-v3.js';

export const ANALYSIS_STEP1_REVISION_BASIS_VERSION = 'step1-revision-basis-v1-d3';

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

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function hashValue(value) {
  return sha256Text(stableFeatureJson(value));
}

function logicalRoundMaterial(pack) {
  const file = (pack?.files || []).find((item) => item?.name === '00_round_pre_market.json');
  const payload = file?.payload;
  if (!payload) throw new Error('analysis pack is missing 00_round_pre_market.json');
  return {
    round: clone(payload.round || null),
    pre_market_cutoff: clone(payload.pre_market_cutoff || null),
    legs: (payload.legs || []).map((leg) => ({
      leg_number: Number(leg.leg_number),
      race_id: leg.race_id ?? null,
      track: clone(leg.track ?? null)
    })).sort((a, b) => a.leg_number - b.leg_number)
  };
}

export function logicalStep1RevisionLegs(pack) {
  const grouped = new Map();
  for (const file of pack?.files || []) {
    const payload = file?.payload;
    const legNumber = Number(payload?.leg_number);
    if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) continue;
    const part = clone(payload);
    delete part.contract_version;
    delete part.pack_version;
    delete part.as_of;
    delete part.split;
    const entries = Array.isArray(part.entries) ? part.entries : [];
    delete part.entries;
    if (!grouped.has(legNumber)) grouped.set(legNumber, { base: part, entries: [] });
    const current = grouped.get(legNumber);
    if (stableFeatureJson(current.base) !== stableFeatureJson(part)) {
      throw new Error(`analysis pack split files disagree for leg ${legNumber}`);
    }
    current.entries.push(...entries);
  }
  if (grouped.size !== 8) throw new Error('analysis pack must contain exactly eight logical legs');
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([legNumber, value]) => ({
    ...value.base,
    leg_number: legNumber,
    entries: value.entries.sort((a, b) => String(a?.race_entry_id || '').localeCompare(String(b?.race_entry_id || '')))
  }));
}

function volatileFactsForLeg(leg) {
  return {
    leg_number: leg.leg_number,
    race: clone(leg.race || null),
    entries: (leg.entries || []).map((entry) => ({
      race_entry_id: entry.race_entry_id,
      current_facts: clone(entry.current_facts || null)
    }))
  };
}

function stripComparisonTimes(value) {
  if (Array.isArray(value)) return value.map(stripComparisonTimes);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'as_of' || key === 'generated_at') continue;
    out[key] = stripComparisonTimes(nested);
  }
  return out;
}

async function legDescriptor(leg) {
  const comparableLeg = stripComparisonTimes(leg);
  const entries = comparableLeg.entries || [];
  const history = entries.map((entry) => ({
    race_entry_id: entry.race_entry_id,
    history_aggregates: entry.history_aggregates ?? null,
    official_history_reference: entry.official_history_reference ?? null,
    relevant_history: entry.relevant_history ?? [],
    history_selection: entry.history_selection ?? null
  }));
  return {
    leg_number: leg.leg_number,
    overall_hash: await hashValue(comparableLeg),
    race_hash: await hashValue(comparableLeg.race ?? null),
    current_facts_hash: await hashValue(entries.map((entry) => ({ race_entry_id: entry.race_entry_id, current_facts: entry.current_facts ?? null }))),
    features_hash: await hashValue(entries.map((entry) => ({ race_entry_id: entry.race_entry_id, features: entry.features ?? null }))),
    xlabs_hash: await hashValue(entries.map((entry) => ({ race_entry_id: entry.race_entry_id, xlabs: entry.xlabs ?? null }))),
    history_hash: await hashValue(history),
    signals_hash: await hashValue(entries.map((entry) => ({ race_entry_id: entry.race_entry_id, current_signals: entry.current_signals ?? [] }))),
    warnings_hash: await hashValue(comparableLeg.warnings ?? [])
  };
}

export async function buildStep1RevisionBasisFromPack(pack, { lockId = null, roundId = null } = {}) {
  if (!pack?.manifest) throw new Error('analysis pack manifest is required');
  assertAnalysisPackMarketBlind(pack.manifest);
  for (const file of pack.files || []) assertAnalysisPackMarketBlind(file.payload);
  const legs = logicalStep1RevisionLegs(pack);
  const descriptors = [];
  for (const leg of legs) descriptors.push(await legDescriptor(leg));
  return {
    basis_version: ANALYSIS_STEP1_REVISION_BASIS_VERSION,
    lock_id: lockId == null ? null : String(lockId),
    round_id: roundId == null ? String(pack.manifest.round_id) : String(roundId),
    pack_id: String(pack.manifest.pack_id),
    pack_as_of: timestamp(pack.manifest.as_of, 'pack.as_of'),
    facts_fingerprint: String(pack.manifest.facts_fingerprint),
    round_material_hash: await hashValue(logicalRoundMaterial(pack)),
    leg_material_hashes: descriptors,
    volatile_facts: legs.map(volatileFactsForLeg)
  };
}

function descriptorMap(basis) {
  return new Map((basis?.leg_material_hashes || []).map((item) => [Number(item.leg_number), item]));
}

function volatileMap(basis) {
  return new Map((basis?.volatile_facts || []).map((item) => [Number(item.leg_number), item]));
}

function stableEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return stableFeatureJson(left) === stableFeatureJson(right);
}

function diffValues(before, after, path = '$', out = []) {
  if (stableEqual(before, after)) return out;
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before);
  const afterObject = after && typeof after === 'object' && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) diffValues(before[key], after[key], `${path}.${key}`, out);
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) diffValues(before[index], after[index], `${path}[${index}]`, out);
    return out;
  }
  out.push({ path, before: before ?? null, after: after ?? null });
  return out;
}

export async function compareStep1RevisionBasis(basis, targetPack) {
  const targetBasis = await buildStep1RevisionBasisFromPack(targetPack, {
    lockId: basis?.lock_id ?? null,
    roundId: targetPack?.manifest?.round_id
  });
  const prior = descriptorMap(basis);
  const current = descriptorMap(targetBasis);
  const structuralChanged = String(basis?.round_material_hash || '') !== String(targetBasis.round_material_hash || '');
  const changedLegs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const left = prior.get(leg);
    const right = current.get(leg);
    if (!left || !right || left.overall_hash !== right.overall_hash) changedLegs.push(leg);
  }
  const scope = structuralChanged ? 'full_round' : (changedLegs.length ? 'affected_legs' : null);
  const affectedLegs = structuralChanged ? [1, 2, 3, 4, 5, 6, 7, 8] : changedLegs;
  const previousVolatile = volatileMap(basis);
  const currentVolatile = volatileMap(targetBasis);
  const factChanges = [];
  const sectionChanges = [];
  for (const leg of affectedLegs) {
    const left = prior.get(leg) || {};
    const right = current.get(leg) || {};
    const changedSections = ['race_hash', 'current_facts_hash', 'features_hash', 'xlabs_hash', 'history_hash', 'signals_hash', 'warnings_hash']
      .filter((key) => left[key] !== right[key])
      .map((key) => key.replace(/_hash$/, ''));
    sectionChanges.push({ leg_number: leg, changed_sections: changedSections });
    diffValues(previousVolatile.get(leg) ?? null, currentVolatile.get(leg) ?? null, `leg_${leg}`, factChanges);
  }
  return {
    structural_changed: structuralChanged,
    revision_scope: scope,
    affected_legs: affectedLegs,
    section_changes: sectionChanges,
    fact_changes: factChanges,
    target_basis: targetBasis
  };
}
