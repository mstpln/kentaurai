import { stableFeatureJson } from './analysis-v3-foundations.js';
import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from './analysis-pack-v3-asof-guard.js';
import { ANALYSIS_STEP1_LOCK_CONTRACT, ANALYSIS_STEP1_PROMPT_V3_VERSION } from './analysis-step1-prompt-v3.js';

export { ANALYSIS_STEP1_LOCK_CONTRACT };
export const ANALYSIS_STEP1_LOCK_VERSION = 'step1-lock-v1-d2';

const PROBABILITY_TOLERANCE = 0.0001;
const ABCD_ORDER = new Map([['A', 0], ['B', 1], ['C', 2], ['D', 3]]);
const DENIED_KEY_PATTERNS = Object.freeze([
  /^(?:bet_percent|bet_percentage|bet_distribution|betting|betting_percent|betting_percentage|betting_snapshot|betting_snapshots)$/,
  /^(?:market|market_percent|market_percentage|market_rank|market_share|market_ownership|market_probability|market_win_probability|market_win_probability_proxy|ownership|ownership_percent|ownership_percentage)$/,
  /^(?:streck|streck_percent|streck_percentage)$/,
  /^(?:odds|official_odds|winner_odds|place_odds)$/,
  /(?:^|_)odds$/,
  /^(?:turnover|turnover_sek|jackpot|jackpot_sek)$/,
  /^(?:value|value_ratio|value_metric|spelvarde|spelvärde)$/,
  /^(?:external_rank|external_ranking|tip|tips|tip_rank|tip_ranking|pick|picks|spike|spik|recommendation|recommendations|recommended|selection|selections|selection_reason|system|systems)$/
]);
const DENIED_TEXT_RE = /(?:\bstreck(?:procent)?\b|\bodds\b|\bspelvärde\b|\bmarknad(?:en|s|sdata)?\b|\bmarket\b|\bbetting\b|\bownership\b|\bturnover\b|\bjackpot\b|\bexternal\s+(?:rank|ranking|tip)|\btip(?:s)?\b|\bspik(?:ar)?\b|\bspike(?:s)?\b|\bvalue\s+(?:bet|ratio|play))/i;

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function optionalText(value, field, max = 8000) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return text;
}

function timestamp(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function finiteNumber(value, field, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite JSON number between ${min} and ${max}`);
  }
  return value;
}

function integer(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be a JSON integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeKey(key) {
  return String(key).trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
}

function inspectDeniedKeys(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectDeniedKeys(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (DENIED_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) out.push(`${path}.${key}`);
    inspectDeniedKeys(nested, `${path}.${key}`, out);
  }
  return out;
}

export function assertStep1MarketBlind(value, field = 'step1 lock') {
  const denied = inspectDeniedKeys(value);
  if (denied.length) throw new Error(`${field} contains denied current-market fields: ${denied.slice(0, 10).join(', ')}`);
  return true;
}

function assertMarketBlindText(value, field) {
  if (value == null) return;
  const clean = String(value)
    .replace(/\bmarket[- ]blind(?:ness)?\b/gi, '')
    .replace(/\bmarknadsblind(?:a|t|het(?:en|ens)?)?\b/gi, '');
  if (DENIED_TEXT_RE.test(clean)) throw new Error(`${field} contains current-market/system language`);
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function step1LockHash(value) {
  return sha256Text(stableFeatureJson(value));
}

function packLegIndex(pack) {
  const byLeg = new Map();
  for (const file of pack.files || []) {
    const payload = file?.payload;
    const legNumber = Number(payload?.leg_number);
    if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) continue;
    const raceId = requiredText(payload?.race?.race_id, `pack leg ${legNumber} race_id`);
    if (!byLeg.has(legNumber)) byLeg.set(legNumber, { raceId, activeEntryIds: new Set() });
    const indexed = byLeg.get(legNumber);
    if (indexed.raceId !== raceId) throw new Error(`pack leg ${legNumber} has conflicting race identities`);
    for (const entry of payload.entries || []) {
      if (entry?.current_facts?.analysis_eligible !== true) continue;
      const entryId = requiredText(entry?.race_entry_id, `pack leg ${legNumber} race_entry_id`);
      if (indexed.activeEntryIds.has(entryId)) throw new Error(`pack leg ${legNumber} repeats active entry ${entryId}`);
      indexed.activeEntryIds.add(entryId);
    }
  }
  if (byLeg.size !== 8 || [...byLeg.keys()].sort((a, b) => a - b).some((number, index) => number !== index + 1)) {
    throw new Error('source analysis pack must contain exactly eight legs');
  }
  return byLeg;
}

function normalizeScenario(value, field, allowedEntries) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const name = requiredText(value.name, `${field}.name`, 160);
  const weight = finiteNumber(value.weight, `${field}.weight`, { min: 0, max: 1 });
  const assumptions = Array.isArray(value.assumptions) ? value.assumptions.map((item, index) => {
    const text = requiredText(item, `${field}.assumptions[${index}]`, 1000);
    assertMarketBlindText(text, `${field}.assumptions[${index}]`);
    return text;
  }) : [];
  const normalizeIds = (items, key) => {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error(`${field}.${key} must be an array`);
    const ids = items.map((item, index) => requiredText(item, `${field}.${key}[${index}]`));
    if (new Set(ids).size !== ids.length) throw new Error(`${field}.${key} contains duplicate entry ids`);
    for (const id of ids) if (!allowedEntries.has(id)) throw new Error(`${field}.${key} contains entry outside the active leg: ${id}`);
    return ids;
  };
  const evidenceQuality = optionalText(value.evidence_quality ?? value.evidenceQuality, `${field}.evidence_quality`, 1000);
  assertMarketBlindText(name, `${field}.name`);
  assertMarketBlindText(evidenceQuality, `${field}.evidence_quality`);
  return {
    name,
    weight,
    assumptions,
    beneficiaries: normalizeIds(value.beneficiaries, 'beneficiaries'),
    disadvantaged: normalizeIds(value.disadvantaged, 'disadvantaged'),
    evidence_quality: evidenceQuality
  };
}

function normalizePrediction(value, field, allowedEntries) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  assertStep1MarketBlind(value, field);
  const raceEntryId = requiredText(value.race_entry_id ?? value.raceEntryId, `${field}.race_entry_id`);
  if (!allowedEntries.has(raceEntryId)) throw new Error(`${field}.race_entry_id does not belong to the active leg`);
  const blindProbability = finiteNumber(value.blind_probability ?? value.blindProbability, `${field}.blind_probability`, { min: 0, max: 1 });
  const low = finiteNumber(value.uncertainty_low ?? value.uncertaintyLow, `${field}.uncertainty_low`, { min: 0, max: 1, nullable: true });
  const high = finiteNumber(value.uncertainty_high ?? value.uncertaintyHigh, `${field}.uncertainty_high`, { min: 0, max: 1, nullable: true });
  if (low != null && low > blindProbability) throw new Error(`${field}.uncertainty_low cannot exceed blind_probability`);
  if (high != null && high < blindProbability) throw new Error(`${field}.uncertainty_high cannot be below blind_probability`);
  const rawRank = integer(value.raw_rank ?? value.rawRank, `${field}.raw_rank`, { min: 1, max: allowedEntries.size });
  const abcdGroup = requiredText(value.abcd_group ?? value.abcdGroup, `${field}.abcd_group`, 1).toUpperCase();
  if (!ABCD_ORDER.has(abcdGroup)) throw new Error(`${field}.abcd_group must be A, B, C or D`);
  const assessmentConfidence = finiteNumber(value.assessment_confidence ?? value.assessmentConfidence, `${field}.assessment_confidence`, { min: 0, max: 1, nullable: true });
  const reasoning = optionalText(value.reasoning, `${field}.reasoning`, 4000);
  assertMarketBlindText(reasoning, `${field}.reasoning`);
  return {
    race_entry_id: raceEntryId,
    blind_probability: blindProbability,
    uncertainty_low: low,
    uncertainty_high: high,
    raw_rank: rawRank,
    abcd_group: abcdGroup,
    assessment_confidence: assessmentConfidence,
    reasoning
  };
}

function normalizeLeg(value, index, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`legs[${index}] must be an object`);
  assertStep1MarketBlind(value, `legs[${index}]`);
  const legNumber = integer(value.leg_number ?? value.legNumber, `legs[${index}].leg_number`, { min: 1, max: 8 });
  if (legNumber !== index + 1) throw new Error('legs must be unique and ordered 1 through 8');
  const source = expected.get(legNumber);
  const raceId = requiredText(value.race_id ?? value.raceId, `legs[${index}].race_id`);
  if (raceId !== source.raceId) throw new Error(`leg ${legNumber} race_id does not match the analysis pack`);
  if (!Array.isArray(value.predictions) || value.predictions.length !== source.activeEntryIds.size) {
    throw new Error(`leg ${legNumber} predictions must cover every active entry exactly once`);
  }
  const predictions = value.predictions.map((item, predictionIndex) => normalizePrediction(item, `legs[${index}].predictions[${predictionIndex}]`, source.activeEntryIds));
  if (new Set(predictions.map((item) => item.race_entry_id)).size !== predictions.length) throw new Error(`leg ${legNumber} contains duplicate predictions`);
  const predictedIds = new Set(predictions.map((item) => item.race_entry_id));
  for (const id of source.activeEntryIds) if (!predictedIds.has(id)) throw new Error(`leg ${legNumber} is missing active entry ${id}`);

  const ranked = [...predictions].sort((a, b) => a.raw_rank - b.raw_rank);
  ranked.forEach((prediction, rankIndex) => {
    if (prediction.raw_rank !== rankIndex + 1) throw new Error(`leg ${legNumber} raw_rank must be unique and contiguous`);
    if (rankIndex && prediction.blind_probability > ranked[rankIndex - 1].blind_probability + PROBABILITY_TOLERANCE) {
      throw new Error(`leg ${legNumber} raw_rank conflicts with blind_probability`);
    }
    if (rankIndex && ABCD_ORDER.get(prediction.abcd_group) < ABCD_ORDER.get(ranked[rankIndex - 1].abcd_group)) {
      throw new Error(`leg ${legNumber} ABCD groups must form contiguous strength bands along ranking`);
    }
  });
  const probabilitySum = predictions.reduce((sum, item) => sum + item.blind_probability, 0);
  if (Math.abs(probabilitySum - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} blind_probability values must sum to 1`);

  const scenariosRaw = value.scenarios == null ? [] : value.scenarios;
  if (!Array.isArray(scenariosRaw)) throw new Error(`legs[${index}].scenarios must be an array`);
  if (scenariosRaw.length > 4) throw new Error(`leg ${legNumber} may contain at most four scenarios`);
  const scenarios = scenariosRaw.map((item, scenarioIndex) => normalizeScenario(item, `legs[${index}].scenarios[${scenarioIndex}]`, source.activeEntryIds));
  if (scenarios.length) {
    const scenarioSum = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
    if (Math.abs(scenarioSum - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} scenario weights must sum to 1`);
  }
  const dataQualitySummary = optionalText(value.data_quality_summary ?? value.dataQualitySummary, `legs[${index}].data_quality_summary`, 3000);
  const raceShapeSummary = optionalText(value.race_shape_summary ?? value.raceShapeSummary, `legs[${index}].race_shape_summary`, 3000);
  const scenarioConfidence = finiteNumber(value.scenario_confidence ?? value.scenarioConfidence, `legs[${index}].scenario_confidence`, { min: 0, max: 1, nullable: true });
  assertMarketBlindText(dataQualitySummary, `legs[${index}].data_quality_summary`);
  assertMarketBlindText(raceShapeSummary, `legs[${index}].race_shape_summary`);
  return {
    leg_number: legNumber,
    race_id: raceId,
    data_quality_summary: dataQualitySummary,
    race_shape_summary: raceShapeSummary,
    scenario_confidence: scenarioConfidence,
    scenarios,
    predictions
  };
}

function normalizeProvider(value) {
  const provider = requiredText(value, 'provider', 40).toLowerCase();
  if (!['openai', 'anthropic'].includes(provider)) throw new Error('provider must be openai or anthropic');
  return provider;
}

export async function validateStep1LockV1AgainstPack(payload, pack) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Step 1 lock must be a JSON object');
  assertStep1MarketBlind(payload);
  const contractVersion = requiredText(payload.contract_version ?? payload.contractVersion, 'contract_version', 80);
  if (contractVersion !== ANALYSIS_STEP1_LOCK_CONTRACT) throw new Error(`contract_version must be ${ANALYSIS_STEP1_LOCK_CONTRACT}`);
  const lockId = requiredText(payload.lock_id ?? payload.lockId, 'lock_id', 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(lockId)) throw new Error('lock_id contains unsupported characters');
  const roundId = requiredText(payload.round_id ?? payload.roundId, 'round_id');
  if (roundId !== pack.manifest.round_id) throw new Error('round_id does not match the analysis pack');
  if (!payload.pack || typeof payload.pack !== 'object' || Array.isArray(payload.pack)) throw new Error('pack metadata is required');
  const packId = requiredText(payload.pack.pack_id ?? payload.pack.packId, 'pack.pack_id');
  const packAsOf = timestamp(payload.pack.as_of ?? payload.pack.asOf, 'pack.as_of');
  const factsFingerprint = requiredText(payload.pack.facts_fingerprint ?? payload.pack.factsFingerprint, 'pack.facts_fingerprint', 160);
  if (packId !== pack.manifest.pack_id) throw new Error('pack.pack_id does not match the server-generated analysis pack');
  if (packAsOf !== pack.manifest.as_of) throw new Error('pack.as_of does not match the server-generated analysis pack');
  if (factsFingerprint !== pack.manifest.facts_fingerprint) throw new Error('pack.facts_fingerprint does not match the server-generated analysis pack');
  const provider = normalizeProvider(payload.provider);
  const model = requiredText(payload.model, 'model', 160);
  const promptVersion = requiredText(payload.prompt_version ?? payload.promptVersion, 'prompt_version', 120);
  if (promptVersion !== ANALYSIS_STEP1_PROMPT_V3_VERSION) throw new Error(`prompt_version must be ${ANALYSIS_STEP1_PROMPT_V3_VERSION}`);
  if (!Array.isArray(payload.legs) || payload.legs.length !== 8) throw new Error('Step 1 lock must contain exactly eight legs');
  const expected = packLegIndex(pack);
  const sorted = [...payload.legs].sort((a, b) => Number(a?.leg_number ?? a?.legNumber) - Number(b?.leg_number ?? b?.legNumber));
  const legs = sorted.map((leg, index) => normalizeLeg(leg, index, expected));
  return {
    contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    lock_id: lockId,
    round_id: roundId,
    pack: { pack_id: packId, as_of: packAsOf, facts_fingerprint: factsFingerprint },
    provider,
    model,
    prompt_version: promptVersion,
    legs
  };
}

export async function prepareStep1LockV1(env, payload) {
  if (!env?.DB) throw new Error('DB is not configured');
  const roundId = requiredText(payload?.round_id ?? payload?.roundId, 'round_id');
  const asOf = timestamp(payload?.pack?.as_of ?? payload?.pack?.asOf, 'pack.as_of');
  await assertAnalysisPackReplaySafe(env, roundId, asOf);
  const pack = await createPreMarketAnalysisPackV3(env, roundId, { asOf });
  const lock = await validateStep1LockV1AgainstPack(payload, pack);
  const lockJson = stableFeatureJson(lock);
  const lockHash = await sha256Text(lockJson);
  return { lock, lockJson, lockHash, pack };
}

function rowMetadata(row, { reused = false } = {}) {
  if (!row) return null;
  return {
    contract_version: row.contract_version,
    lock_id: row.id,
    round_id: row.game_round_id,
    pack_id: row.pack_id,
    pack_as_of: row.pack_as_of,
    facts_fingerprint: row.facts_fingerprint,
    provider: row.provider,
    model: row.model,
    prompt_version: row.prompt_version,
    lock_hash: row.lock_hash,
    created_at: row.created_at,
    sealed: true,
    reused
  };
}

function exactRetryJson(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  try {
    const candidate = structuredClone(payload);
    if (candidate.pack?.as_of != null) candidate.pack.as_of = timestamp(candidate.pack.as_of, 'pack.as_of');
    if (candidate.provider != null) candidate.provider = String(candidate.provider).trim().toLowerCase();
    return stableFeatureJson(candidate);
  } catch {
    return null;
  }
}

export function isExactStoredStep1Retry(row, payload) {
  return Boolean(row?.lock_json) && exactRetryJson(payload) === row.lock_json;
}

export async function importStep1LockV1(env, payload, { now = new Date().toISOString() } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const lockId = requiredText(payload?.lock_id ?? payload?.lockId, 'lock_id', 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(lockId)) throw new Error('lock_id contains unsupported characters');

  const existing = await env.DB.prepare(`SELECT * FROM analysis_step1_locks WHERE id=? LIMIT 1`).bind(lockId).first();
  if (existing) {
    if (!isExactStoredStep1Retry(existing, payload)) {
      throw new Error('lock_id is already sealed with different content; create a new lock/revision id');
    }
    return rowMetadata(existing, { reused: true });
  }

  const prepared = await prepareStep1LockV1(env, payload);
  const createdAt = timestamp(now, 'created_at');
  try {
    await env.DB.prepare(`
      INSERT INTO analysis_step1_locks (
        id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      prepared.lock.lock_id,prepared.lock.round_id,ANALYSIS_STEP1_LOCK_CONTRACT,prepared.lock.pack.pack_id,
      prepared.lock.pack.as_of,prepared.lock.pack.facts_fingerprint,prepared.lock.provider,prepared.lock.model,
      prepared.lock.prompt_version,prepared.lockJson,prepared.lockHash,createdAt
    ).run();
  } catch (error) {
    const raced = await env.DB.prepare(`SELECT * FROM analysis_step1_locks WHERE id=? LIMIT 1`).bind(prepared.lock.lock_id).first();
    if (raced && raced.lock_hash === prepared.lockHash && raced.lock_json === prepared.lockJson) return rowMetadata(raced, { reused: true });
    throw error;
  }
  const inserted = await env.DB.prepare(`SELECT * FROM analysis_step1_locks WHERE id=? LIMIT 1`).bind(prepared.lock.lock_id).first();
  if (!inserted) throw new Error('sealed Step 1 lock could not be read after insert');
  return rowMetadata(inserted);
}

export async function getStep1LockV1(env, { roundId = null, lockId = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (lockId) {
    const id = requiredText(lockId, 'lock_id', 160);
    return rowMetadata(await env.DB.prepare(`SELECT * FROM analysis_step1_locks WHERE id=? LIMIT 1`).bind(id).first());
  }
  const round = requiredText(roundId, 'round_id');
  return rowMetadata(await env.DB.prepare(`
    SELECT * FROM analysis_step1_locks WHERE game_round_id=? ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
  `).bind(round).first());
}

export async function requireSealedStep1LockV1(env, { roundId, lockId = null } = {}) {
  const lock = await getStep1LockV1(env, { roundId, lockId });
  if (!lock || lock.round_id !== String(roundId)) throw new Error('a valid sealed Step 1 lock is required before current market export');
  return lock;
}
