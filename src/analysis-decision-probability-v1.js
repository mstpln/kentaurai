import { stableFeatureJson } from './analysis-v3-foundations.js';
import { createMarketPackV3, normalizeMarketPackOptionsV3 } from './analysis-market-pack-v3.js';

export const ANALYSIS_DECISION_PROBABILITY_CONTRACT = 'kentaurai-decision-probability-v1';
export const ANALYSIS_DECISION_PROBABILITY_VERSION = 'decision-probability-v1-e1';
export const ANALYSIS_DECISION_POLICY_VERSION = 'decision-blind-v1';

const PROBABILITY_TOLERANCE = 1e-6;

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

function finiteProbability(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${field} must be a probability between 0 and 1`);
  return number;
}

function integer(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return number;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function marketLegsByNumber(pack) {
  const byLeg = new Map();
  for (const file of pack?.files || []) {
    const payload = file?.payload;
    if (!payload || !String(file.name || '').match(/^\d{2}_leg_\d+_market\.json$/)) continue;
    const legNumber = Number(payload.leg_number);
    if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8 || byLeg.has(legNumber)) {
      throw new Error('market pack must contain exactly one file for each leg 1 through 8');
    }
    byLeg.set(legNumber, payload);
  }
  if (byLeg.size !== 8) throw new Error('market pack must contain exactly eight leg files');
  return byLeg;
}

function normalizePublicProxy(marketLeg, predictionIds) {
  const quality = requiredText(marketLeg.proxy_quality, 'proxy_quality', 120);
  const method = marketLeg.proxy_method == null ? null : requiredText(marketLeg.proxy_method, 'proxy_method', 160);
  const entries = Array.isArray(marketLeg.entries) ? marketLeg.entries : [];
  if (entries.length !== predictionIds.size) throw new Error(`leg ${marketLeg.leg_number} market entries do not match the sealed Step 1 active field`);
  const byId = new Map();
  for (const entry of entries) {
    const id = requiredText(entry?.race_entry_id, 'market race_entry_id', 200);
    if (!predictionIds.has(id) || byId.has(id)) throw new Error(`leg ${marketLeg.leg_number} market entry identity does not match the sealed Step 1 active field`);
    byId.set(id, entry);
  }

  const complete = quality === 'verified_complete_winner_odds_v1';
  let proxySum = 0;
  for (const id of predictionIds) {
    const raw = byId.get(id)?.market_win_probability_proxy;
    if (complete) {
      const proxy = finiteProbability(raw, `leg ${marketLeg.leg_number} public proxy`);
      proxySum += proxy;
    } else if (raw != null) {
      throw new Error(`leg ${marketLeg.leg_number} weak/unavailable public proxy must remain null`);
    }
  }
  if (complete && Math.abs(proxySum - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`leg ${marketLeg.leg_number} public proxy probabilities must sum to 1`);
  }
  return { quality, method, complete, byId };
}

function reliabilityForLeg(marketLeg, publicProxy) {
  const entries = Array.isArray(marketLeg.entries) ? marketLeg.entries : [];
  const observations = entries.map((entry) => Number(entry?.maturity?.ownership_observation_count)).filter(Number.isFinite);
  const ages = entries.map((entry) => Number(entry?.maturity?.snapshot_age_minutes)).filter(Number.isFinite);
  return {
    proxy_available: publicProxy.complete,
    proxy_quality: publicProxy.quality,
    proxy_method: publicProxy.method,
    ownership_observation_min: observations.length ? Math.min(...observations) : 0,
    ownership_snapshot_age_max_minutes: ages.length ? Math.max(...ages) : null,
    trend_semantics_verified: false,
    blend_applied: false
  };
}

export async function buildCanonicalDecisionProbabilityV1({ lockDocument, marketPack, generatedAt = new Date().toISOString() } = {}) {
  if (!lockDocument || typeof lockDocument !== 'object' || Array.isArray(lockDocument)) throw new Error('sealed Step 1 lock document is required');
  if (!marketPack?.manifest) throw new Error('D4 market pack is required');

  const roundId = requiredText(lockDocument.round_id, 'lock round_id');
  const lockId = requiredText(lockDocument.lock_id, 'lock_id', 160);
  const lockHash = requiredText(marketPack.manifest?.lock?.lock_hash, 'lock_hash', 160);
  if (marketPack.manifest.round_id !== roundId || marketPack.manifest.lock?.lock_id !== lockId) {
    throw new Error('market pack must be bound to the same sealed Step 1 lock');
  }
  const marketFingerprint = requiredText(marketPack.manifest.market_fingerprint, 'market_fingerprint', 160);
  const marketCutoff = exactIso(marketPack.manifest.cutoff, 'market cutoff');
  const generated = exactIso(generatedAt, 'generated_at');
  const marketLegs = marketLegsByNumber(marketPack);

  if (!Array.isArray(lockDocument.legs) || lockDocument.legs.length !== 8) throw new Error('sealed Step 1 lock must contain exactly eight legs');
  const sortedLockLegs = [...lockDocument.legs].sort((a, b) => Number(a?.leg_number) - Number(b?.leg_number));

  const legs = sortedLockLegs.map((lockLeg, index) => {
    const legNumber = integer(lockLeg?.leg_number, `legs[${index}].leg_number`, 1, 8);
    if (legNumber !== index + 1) throw new Error('sealed Step 1 legs must be unique and ordered 1 through 8');
    const raceId = requiredText(lockLeg.race_id, `leg ${legNumber} race_id`, 200);
    const predictions = Array.isArray(lockLeg.predictions) ? lockLeg.predictions : [];
    if (!predictions.length) throw new Error(`leg ${legNumber} must contain sealed Step 1 predictions`);

    const predictionIds = new Set();
    let blindSum = 0;
    for (const prediction of predictions) {
      const entryId = requiredText(prediction?.race_entry_id, `leg ${legNumber} race_entry_id`, 200);
      if (predictionIds.has(entryId)) throw new Error(`leg ${legNumber} repeats race_entry_id ${entryId}`);
      predictionIds.add(entryId);
      blindSum += finiteProbability(prediction.blind_probability, `leg ${legNumber} blind_probability`);
    }
    if (Math.abs(blindSum - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} blind probabilities must sum to 1`);

    const marketLeg = marketLegs.get(legNumber);
    if (!marketLeg || marketLeg.race_id !== raceId) throw new Error(`leg ${legNumber} market race identity does not match the sealed Step 1 lock`);
    if (marketLeg.lock_id !== lockId || marketLeg.lock_hash !== lockHash || marketLeg.market_fingerprint !== marketFingerprint) {
      throw new Error(`leg ${legNumber} market binding does not match the decision parent`);
    }
    const publicProxy = normalizePublicProxy(marketLeg, predictionIds);
    const entries = predictions.map((prediction) => {
      const entryId = requiredText(prediction.race_entry_id, 'race_entry_id', 200);
      const blind = finiteProbability(prediction.blind_probability, `leg ${legNumber} blind_probability`);
      const publicValue = publicProxy.complete
        ? finiteProbability(publicProxy.byId.get(entryId)?.market_win_probability_proxy, `leg ${legNumber} public proxy`)
        : null;
      return {
        race_entry_id: entryId,
        blind_probability: blind,
        public_win_probability_proxy: publicValue,
        public_proxy_quality: publicProxy.quality,
        decision_probability: blind
      };
    });
    const decisionSum = entries.reduce((sum, entry) => sum + entry.decision_probability, 0);
    if (Math.abs(decisionSum - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} decision probabilities must sum to 1`);

    return {
      leg_number: legNumber,
      race_id: raceId,
      public_proxy_quality: publicProxy.quality,
      public_proxy_method: publicProxy.method,
      context_reliability: reliabilityForLeg(marketLeg, publicProxy),
      entries
    };
  });

  const fingerprintInput = {
    contract_version: ANALYSIS_DECISION_PROBABILITY_CONTRACT,
    decision_probability_version: ANALYSIS_DECISION_PROBABILITY_VERSION,
    policy_version: ANALYSIS_DECISION_POLICY_VERSION,
    round_id: roundId,
    lock_id: lockId,
    lock_hash: lockHash,
    market_fingerprint: marketFingerprint,
    market_cutoff: marketCutoff,
    legs
  };
  const decisionFingerprint = await sha256Text(stableFeatureJson(fingerprintInput));
  return {
    ...fingerprintInput,
    generated_at: generated,
    decision_fingerprint: decisionFingerprint,
    policy: {
      decision_source: 'blind_probability',
      market_blend_applied: false,
      ownership_used_as_win_probability: false,
      calibration_status: 'foundation_only_not_fitted'
    }
  };
}

export async function loadDecisionParentsV1(env, roundId, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const normalized = normalizeMarketPackOptionsV3(options);
  const marketPack = await createMarketPackV3(env, round, normalized);
  const row = await env.DB.prepare(`
    SELECT lock_json,lock_hash FROM analysis_step1_locks WHERE id=? AND game_round_id=? LIMIT 1
  `).bind(normalized.lockId, round).first();
  if (!row?.lock_json || row.lock_hash !== normalized.lockHash) throw new Error('sealed Step 1 lock document could not be loaded with the requested hash');
  let lockDocument;
  try { lockDocument = JSON.parse(row.lock_json); } catch { throw new Error('sealed Step 1 lock document is invalid'); }
  return { lockDocument, marketPack };
}

export async function createDecisionProbabilityV1(env, roundId, options = {}) {
  const parents = await loadDecisionParentsV1(env, roundId, options);
  return buildCanonicalDecisionProbabilityV1({ ...parents, generatedAt: options.generatedAt });
}

function decisionIdFromFingerprint(fingerprint) {
  const hex = requiredText(fingerprint, 'decision_fingerprint', 80).replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('decision_fingerprint must be sha256');
  return `decision_${hex.slice(0, 32)}`;
}

function storedRunMetadata(row, decision, reused) {
  return {
    id: row.id,
    round_id: row.game_round_id,
    lock_id: row.lock_id,
    lock_hash: row.lock_hash,
    market_fingerprint: row.market_fingerprint,
    market_cutoff: row.market_cutoff,
    contract_version: row.contract_version,
    decision_probability_version: row.decision_probability_version,
    policy_version: row.policy_version,
    decision_fingerprint: row.decision_fingerprint,
    created_at: row.created_at,
    reused,
    decision
  };
}

export async function persistDecisionProbabilityV1(env, roundId, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const decision = await createDecisionProbabilityV1(env, roundId, options);
  const id = decisionIdFromFingerprint(decision.decision_fingerprint);
  const decisionJson = stableFeatureJson(decision);
  const existing = await env.DB.prepare('SELECT * FROM analysis_decision_runs WHERE id=? LIMIT 1').bind(id).first();
  if (existing) {
    if (existing.decision_fingerprint !== decision.decision_fingerprint) {
      throw new Error('decision run id collision with different canonical content');
    }
    let storedDecision;
    try { storedDecision = JSON.parse(existing.decision_json); } catch { throw new Error('stored decision_json is invalid'); }
    return storedRunMetadata(existing, storedDecision, true);
  }

  const createdAt = exactIso(options.createdAt ?? new Date().toISOString(), 'created_at');
  const quality = decision.legs.map((leg) => ({ leg_number: leg.leg_number, proxy_quality: leg.public_proxy_quality }));
  const reliability = decision.legs.map((leg) => ({ leg_number: leg.leg_number, ...leg.context_reliability }));
  const statements = [
    env.DB.prepare(`
      INSERT INTO analysis_decision_runs (
        id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,
        decision_probability_version,policy_version,market_proxy_quality_json,context_reliability_json,
        decision_json,decision_fingerprint,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, decision.round_id, decision.lock_id, decision.lock_hash, decision.market_fingerprint, decision.market_cutoff,
      decision.contract_version, decision.decision_probability_version, decision.policy_version,
      stableFeatureJson(quality), stableFeatureJson(reliability), decisionJson, decision.decision_fingerprint, createdAt
    )
  ];
  for (const leg of decision.legs) {
    for (const entry of leg.entries) {
      statements.push(env.DB.prepare(`
        INSERT INTO analysis_decision_probabilities (
          decision_run_id,leg_number,race_entry_id,blind_probability,public_win_probability_proxy,
          public_proxy_quality,decision_probability
        ) VALUES (?,?,?,?,?,?,?)
      `).bind(
        id, leg.leg_number, entry.race_entry_id, entry.blind_probability, entry.public_win_probability_proxy,
        entry.public_proxy_quality, entry.decision_probability
      ));
    }
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await env.DB.prepare('SELECT * FROM analysis_decision_runs WHERE id=? LIMIT 1').bind(id).first();
    if (raced?.decision_fingerprint === decision.decision_fingerprint) {
      let storedDecision;
      try { storedDecision = JSON.parse(raced.decision_json); } catch { throw new Error('stored decision_json is invalid'); }
      return storedRunMetadata(raced, storedDecision, true);
    }
    throw error;
  }
  const inserted = await env.DB.prepare('SELECT * FROM analysis_decision_runs WHERE id=? LIMIT 1').bind(id).first();
  if (!inserted) throw new Error('decision run could not be read after insert');
  return storedRunMetadata(inserted, decision, false);
}

export async function getDecisionProbabilityV1(env, { roundId, id = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const row = id
    ? await env.DB.prepare('SELECT * FROM analysis_decision_runs WHERE id=? LIMIT 1').bind(requiredText(id, 'id', 160)).first()
    : await env.DB.prepare(`
        SELECT * FROM analysis_decision_runs WHERE game_round_id=? ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
      `).bind(requiredText(roundId, 'round_id')).first();
  if (!row) return null;
  let decision;
  try { decision = JSON.parse(row.decision_json); } catch { throw new Error('stored decision_json is invalid'); }
  return storedRunMetadata(row, decision, true);
}
