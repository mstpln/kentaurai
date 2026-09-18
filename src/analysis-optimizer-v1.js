import { stableFeatureJson } from './analysis-v3-foundations.js';
import {
  ANALYSIS_DECISION_PROBABILITY_CONTRACT,
  getDecisionProbabilityV1
} from './analysis-decision-probability-v1.js';
import { requireLatestStep1LockV1 } from './analysis-step1-revision-v1.js';

export const ANALYSIS_OPTIMIZER_CONTRACT = 'kentaurai-optimizer-v1';
export const ANALYSIS_OPTIMIZER_VERSION = 'optimizer-p8-exact3-v1-e2';
export const ANALYSIS_OPTIMIZER_POLICY_VERSION = 'v85-v86-exact3-main-v1';
export const ANALYSIS_OPTIMIZER_EXACT_SPIKES = 3;
export const ANALYSIS_OPTIMIZER_DEFAULT_TARGET_MIN_SEK = 150;
export const ANALYSIS_OPTIMIZER_DEFAULT_MAX_BUDGET_SEK = 250;

const PROBABILITY_TOLERANCE = 1e-6;
const MONEY_SCALE = 1_000_000;
const SECONDARY_TIE_BREAK = 'lower_cost_then_stable_selection_signature_v1';

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

function finiteProbability(value, field) {
  if (value == null || value === '') throw new Error(`${field} must be a probability between 0 and 1`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${field} must be a probability between 0 and 1`);
  }
  return number;
}

function roundNumber(value, digits = 12) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scaledMoney(value, field) {
  if (value == null || value === '') throw new Error(`${field} is required`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000) {
    throw new Error(`${field} must be a positive finite SEK amount`);
  }
  const scaledRaw = number * MONEY_SCALE;
  const scaled = Math.round(scaledRaw);
  if (Math.abs(scaledRaw - scaled) > 1e-6) throw new Error(`${field} supports at most 6 decimal places`);
  return scaled;
}

function moneyFromScaled(value) {
  return Number((value / MONEY_SCALE).toFixed(6));
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function sha256Fingerprint(value, field) {
  const text = requiredText(value, field, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error(`${field} must be sha256`);
  return text;
}

export function normalizeOptimizerPolicyV1(options = {}) {
  const linePriceScaled = scaledMoney(options.line_price_sek ?? options.linePriceSek, 'line_price_sek');
  const targetMinScaled = scaledMoney(
    options.target_budget_min_sek ?? options.targetBudgetMinSek ?? ANALYSIS_OPTIMIZER_DEFAULT_TARGET_MIN_SEK,
    'target_budget_min_sek'
  );
  const maxBudgetScaled = scaledMoney(
    options.max_budget_sek ?? options.maxBudgetSek ?? ANALYSIS_OPTIMIZER_DEFAULT_MAX_BUDGET_SEK,
    'max_budget_sek'
  );
  if (targetMinScaled > maxBudgetScaled) throw new Error('target_budget_min_sek must be <= max_budget_sek');

  const exactSpikes = Number(options.exact_spike_count ?? options.exactSpikeCount ?? ANALYSIS_OPTIMIZER_EXACT_SPIKES);
  if (exactSpikes !== ANALYSIS_OPTIMIZER_EXACT_SPIKES) {
    throw new Error('v3 optimizer policy requires exactly 3 spikes');
  }
  const systemType = String(options.system_type ?? options.systemType ?? 'main').trim();
  if (systemType !== 'main') throw new Error('E2 v1 optimizer supports only the main system');

  const tieBreak = String(options.secondary_tie_break ?? options.secondaryTieBreak ?? SECONDARY_TIE_BREAK).trim();
  if (tieBreak !== SECONDARY_TIE_BREAK) throw new Error('unsupported optimizer secondary tie-break policy');

  return {
    system_type: systemType,
    target_budget_min_sek: moneyFromScaled(targetMinScaled),
    max_budget_sek: moneyFromScaled(maxBudgetScaled),
    line_price_sek: moneyFromScaled(linePriceScaled),
    line_price_source: 'explicit_policy_config',
    exact_spike_count: ANALYSIS_OPTIMIZER_EXACT_SPIKES,
    primary_objective: 'maximize_estimated_p8_under_max_budget',
    secondary_tie_break: SECONDARY_TIE_BREAK,
    minimum_budget_is_hard_constraint: false
  };
}

function normalizeDecisionForOptimizer(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('canonical decision probability input is required');
  }
  if (decision.contract_version !== ANALYSIS_DECISION_PROBABILITY_CONTRACT) {
    throw new Error('unsupported decision probability contract');
  }
  const roundId = requiredText(decision.round_id, 'decision round_id');
  const decisionFingerprint = sha256Fingerprint(decision.decision_fingerprint, 'decision_fingerprint');
  const decisionVersion = requiredText(decision.decision_probability_version, 'decision_probability_version', 160);
  if (!Array.isArray(decision.legs) || decision.legs.length !== 8) {
    throw new Error('optimizer requires exactly eight decision legs');
  }

  const globalIds = new Set();
  const legs = decision.legs.map((leg, index) => {
    const legNumber = Number(leg?.leg_number);
    if (legNumber !== index + 1) throw new Error('decision legs must be ordered uniquely 1 through 8');
    const raceId = requiredText(leg.race_id, `leg ${legNumber} race_id`, 200);
    if (!Array.isArray(leg.entries) || !leg.entries.length) throw new Error(`leg ${legNumber} has no active entries`);

    let sum = 0;
    const entries = leg.entries.map((entry) => {
      const raceEntryId = requiredText(entry?.race_entry_id, `leg ${legNumber} race_entry_id`, 200);
      if (globalIds.has(raceEntryId)) throw new Error(`duplicate race_entry_id ${raceEntryId} in optimizer input`);
      globalIds.add(raceEntryId);
      if (entry?.scratched === true || entry?.eligible === false) {
        throw new Error(`leg ${legNumber} contains an ineligible/scratched entry; revise the sealed decision first`);
      }
      const probability = finiteProbability(entry.decision_probability, `leg ${legNumber} decision_probability`);
      sum += probability;
      return { race_entry_id: raceEntryId, decision_probability: probability };
    });
    if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`leg ${legNumber} decision probabilities must sum to 1`);
    }

    entries.sort((a, b) => {
      const probabilityOrder = b.decision_probability - a.decision_probability;
      if (probabilityOrder !== 0) return probabilityOrder;
      return a.race_entry_id < b.race_entry_id ? -1 : a.race_entry_id > b.race_entry_id ? 1 : 0;
    });
    return { leg_number: legNumber, race_id: raceId, entries };
  });

  return {
    round_id: roundId,
    decision_fingerprint: decisionFingerprint,
    decision_probability_version: decisionVersion,
    legs
  };
}

function buildLegFrontier(leg) {
  let cumulative = 0;
  return leg.entries.map((entry, index) => {
    cumulative += entry.decision_probability;
    const coverage = Math.min(1, cumulative);
    return {
      k: index + 1,
      q: coverage,
      selected_entries: leg.entries.slice(0, index + 1)
    };
  });
}

function stateSignature(parts) {
  return parts.join('|');
}

function choiceSignature(legNumber, frontier) {
  return `${String(legNumber).padStart(2, '0')}:${frontier.selected_entries.map((entry) => entry.race_entry_id).join(',')}`;
}

function stateBetter(a, b) {
  if (!b) return true;
  if (a.log_p8 > b.log_p8) return true;
  if (b.log_p8 > a.log_p8) return false;
  return stateSignature(a.signature_parts) < stateSignature(b.signature_parts);
}

function finalBetter(a, b) {
  if (!b) return true;
  if (a.log_p8 > b.log_p8) return true;
  if (b.log_p8 > a.log_p8) return false;
  if (a.row_count !== b.row_count) return a.row_count < b.row_count;
  return stateSignature(a.signature_parts) < stateSignature(b.signature_parts);
}

function searchExact3(frontiers, maxRows) {
  let states = new Map();
  states.set('0:1', {
    row_count: 1,
    spikes_used: 0,
    log_p8: 0,
    choices: [],
    signature_parts: []
  });
  let statesEvaluated = 0;

  for (let legIndex = 0; legIndex < frontiers.length; legIndex += 1) {
    const next = new Map();
    const remaining = frontiers.length - legIndex - 1;
    for (const state of states.values()) {
      for (const frontier of frontiers[legIndex]) {
        statesEvaluated += 1;
        const rowCount = state.row_count * frontier.k;
        if (!Number.isSafeInteger(rowCount) || rowCount > maxRows) continue;
        const spikesUsed = state.spikes_used + (frontier.k === 1 ? 1 : 0);
        if (spikesUsed > ANALYSIS_OPTIMIZER_EXACT_SPIKES) continue;
        if (spikesUsed + remaining < ANALYSIS_OPTIMIZER_EXACT_SPIKES) continue;
        if (!(frontier.q > 0)) continue;

        const candidate = {
          row_count: rowCount,
          spikes_used: spikesUsed,
          log_p8: state.log_p8 + Math.log(frontier.q),
          choices: [...state.choices, frontier],
          signature_parts: [...state.signature_parts, choiceSignature(legIndex + 1, frontier)]
        };
        const key = `${spikesUsed}:${rowCount}`;
        if (stateBetter(candidate, next.get(key))) next.set(key, candidate);
      }
    }
    states = next;
    if (!states.size) break;
  }

  let best = null;
  for (const state of states.values()) {
    if (state.spikes_used !== ANALYSIS_OPTIMIZER_EXACT_SPIKES) continue;
    if (finalBetter(state, best)) best = state;
  }
  return { best, statesEvaluated, finalStateCount: states.size };
}

export async function buildCanonicalOptimizerV1({
  decision,
  decisionRunId,
  gameType,
  policy = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const normalizedDecision = normalizeDecisionForOptimizer(decision);
  const decisionRun = requiredText(decisionRunId, 'decision_run_id', 160);
  const game = requiredText(gameType, 'game_type', 20);
  if (!['V85', 'V86'].includes(game)) throw new Error('optimizer supports only V85/V86');
  const normalizedPolicy = normalizeOptimizerPolicyV1(policy);
  const generated = exactIso(generatedAt, 'generated_at');

  const linePriceScaled = scaledMoney(normalizedPolicy.line_price_sek, 'line_price_sek');
  const maxBudgetScaled = scaledMoney(normalizedPolicy.max_budget_sek, 'max_budget_sek');
  const maxRows = Math.floor(maxBudgetScaled / linePriceScaled);
  if (maxRows < 1) throw new Error('max budget cannot buy one row');

  const forcedSingletonLegs = normalizedDecision.legs.filter((leg) => leg.entries.length === 1).length;
  if (forcedSingletonLegs > ANALYSIS_OPTIMIZER_EXACT_SPIKES) {
    throw new Error('more than three legs have only one active entry; exact-three-spike system is impossible');
  }
  const multiEntryLegs = normalizedDecision.legs.filter((leg) => leg.entries.length >= 2).length;
  if (multiEntryLegs < 8 - ANALYSIS_OPTIMIZER_EXACT_SPIKES) {
    throw new Error('not enough multi-entry legs to construct exactly three spikes');
  }

  const frontiers = normalizedDecision.legs.map(buildLegFrontier);
  const search = searchExact3(frontiers, maxRows);
  if (!search.best) {
    throw new Error('no exact-three-spike system fits the configured max budget and line price');
  }

  const systemLegs = normalizedDecision.legs.map((leg, index) => {
    const choice = search.best.choices[index];
    return {
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      selected_count: choice.k,
      is_spike: choice.k === 1,
      leg_coverage_probability: roundNumber(choice.q),
      selected_entries: choice.selected_entries.map((entry) => ({
        race_entry_id: entry.race_entry_id,
        decision_probability: entry.decision_probability
      }))
    };
  });
  const spikeLegs = systemLegs.filter((leg) => leg.is_spike).map((leg) => leg.leg_number);
  if (spikeLegs.length !== ANALYSIS_OPTIMIZER_EXACT_SPIKES) throw new Error('optimizer invariant failed: spike count is not exactly three');

  const rowCount = systemLegs.reduce((rows, leg) => rows * leg.selected_count, 1);
  if (rowCount !== search.best.row_count) throw new Error('optimizer invariant failed: row product mismatch');
  const costScaled = rowCount * linePriceScaled;
  if (!Number.isSafeInteger(costScaled) || costScaled > maxBudgetScaled) throw new Error('optimizer invariant failed: cost exceeds budget');
  const estimatedP8 = Math.exp(search.best.log_p8);

  const system = {
    system_type: normalizedPolicy.system_type,
    three_spike_legs: spikeLegs,
    spike_count: spikeLegs.length,
    row_count: rowCount,
    line_price_sek: normalizedPolicy.line_price_sek,
    cost_sek: moneyFromScaled(costScaled),
    max_budget_sek: normalizedPolicy.max_budget_sek,
    target_budget_min_sek: normalizedPolicy.target_budget_min_sek,
    budget_unused_sek: moneyFromScaled(maxBudgetScaled - costScaled),
    within_target_budget_band: costScaled >= scaledMoney(normalizedPolicy.target_budget_min_sek, 'target_budget_min_sek'),
    estimated_p8: roundNumber(estimatedP8),
    legs: systemLegs
  };

  const metrics = {
    frontier_sizes: frontiers.map((frontier) => frontier.length),
    max_rows: maxRows,
    states_evaluated: search.statesEvaluated,
    final_state_count: search.finalStateCount,
    objective_log_p8: roundNumber(search.best.log_p8),
    budget_forcing_applied: false,
    stable_tie_break_applied: normalizedPolicy.secondary_tie_break
  };

  const fingerprintInput = {
    contract_version: ANALYSIS_OPTIMIZER_CONTRACT,
    optimizer_version: ANALYSIS_OPTIMIZER_VERSION,
    policy_version: ANALYSIS_OPTIMIZER_POLICY_VERSION,
    round_id: normalizedDecision.round_id,
    game_type: game,
    decision_run_id: decisionRun,
    decision_fingerprint: normalizedDecision.decision_fingerprint,
    decision_probability_version: normalizedDecision.decision_probability_version,
    policy: normalizedPolicy,
    system,
    metrics
  };
  const optimizerFingerprint = await sha256Text(stableFeatureJson(fingerprintInput));
  return {
    ...fingerprintInput,
    generated_at: generated,
    optimizer_fingerprint: optimizerFingerprint
  };
}

async function assertCurrentDecisionFieldV1(env, roundId, decision) {
  const rows = await env.DB.prepare(`
    SELECT gl.leg_number,re.id AS race_entry_id,re.scratched
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number,re.id
  `).bind(roundId).all();
  const current = Array.isArray(rows?.results) ? rows.results : [];
  const expected = [];
  for (const leg of decision?.legs || []) {
    for (const entry of leg?.entries || []) {
      expected.push({ leg_number: Number(leg.leg_number), race_entry_id: String(entry.race_entry_id || '') });
    }
  }
  expected.sort((a, b) => a.leg_number - b.leg_number
    || (a.race_entry_id < b.race_entry_id ? -1 : a.race_entry_id > b.race_entry_id ? 1 : 0));
  const active = current
    .filter((row) => Number(row.scratched) !== 1)
    .map((row) => ({ leg_number: Number(row.leg_number), race_entry_id: String(row.race_entry_id || '') }));
  if (stableFeatureJson(active) !== stableFeatureJson(expected)) {
    throw new Error('current active field no longer matches the persisted decision; create a new Step 1/market/decision lineage before optimizing');
  }
  return true;
}

export async function loadOptimizerParentsV1(env, roundId, options = {}) {
  const round = requiredText(roundId, 'round_id');
  const decisionRunId = requiredText(options.decision_run_id ?? options.decisionRunId, 'decision_run_id', 160);
  const policy = normalizeOptimizerPolicyV1(options);
  if (!env?.DB) throw new Error('DB is not configured');

  const roundRow = await env.DB.prepare('SELECT id,game_type FROM game_rounds WHERE id=? LIMIT 1').bind(round).first();
  if (!roundRow || !['V85', 'V86'].includes(roundRow.game_type)) throw new Error('V85/V86 round was not found');

  const stored = await getDecisionProbabilityV1(env, { id: decisionRunId });
  if (!stored || stored.round_id !== round) throw new Error('decision run was not found for the requested round');
  if (stored.decision_fingerprint !== stored.decision?.decision_fingerprint) {
    throw new Error('stored decision fingerprint metadata does not match decision content');
  }
  const latestLock = await requireLatestStep1LockV1(env, { roundId: round, lockId: stored.lock_id });
  if (latestLock.lock_hash !== stored.lock_hash || stored.decision?.lock_id !== stored.lock_id || stored.decision?.lock_hash !== stored.lock_hash) {
    throw new Error('decision run is not bound to the newest sealed Step 1 lock');
  }
  await assertCurrentDecisionFieldV1(env, round, stored.decision);
  return {
    decision: stored.decision,
    decisionRunId: stored.id,
    gameType: roundRow.game_type,
    policy
  };
}

export async function createOptimizerV1(env, roundId, options = {}) {
  const parents = await loadOptimizerParentsV1(env, roundId, options);
  return buildCanonicalOptimizerV1({ ...parents, generatedAt: options.generatedAt });
}

function optimizerIdFromFingerprint(fingerprint) {
  const hex = sha256Fingerprint(fingerprint, 'optimizer_fingerprint').replace(/^sha256:/, '');
  return `optimizer_${hex.slice(0, 32)}`;
}

function storedOptimizerMetadata(row, optimizer, reused) {
  return {
    id: row.id,
    round_id: row.game_round_id,
    decision_run_id: row.decision_run_id,
    decision_fingerprint: row.decision_fingerprint,
    contract_version: row.contract_version,
    optimizer_version: row.optimizer_version,
    policy_version: row.policy_version,
    optimizer_fingerprint: row.optimizer_fingerprint,
    created_at: row.created_at,
    reused,
    optimizer
  };
}

async function assertCanonicalOptimizerForPersistenceV1(optimizer, decision) {
  if (!optimizer || optimizer.contract_version !== ANALYSIS_OPTIMIZER_CONTRACT) throw new Error('canonical E2 optimizer result is required');
  if (optimizer.optimizer_version !== ANALYSIS_OPTIMIZER_VERSION || optimizer.policy_version !== ANALYSIS_OPTIMIZER_POLICY_VERSION) {
    throw new Error('unsupported E2 optimizer/policy version');
  }
  const rebuilt = await buildCanonicalOptimizerV1({
    decision,
    decisionRunId: optimizer.decision_run_id,
    gameType: optimizer.game_type,
    policy: optimizer.policy,
    generatedAt: optimizer.generated_at
  });
  if (stableFeatureJson(rebuilt) !== stableFeatureJson(optimizer)) {
    throw new Error('optimizer result does not match deterministic E2 canonical output');
  }
  return true;
}

export async function persistCanonicalOptimizerV1(env, optimizer, decision, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  await assertCanonicalOptimizerForPersistenceV1(optimizer, decision);
  const id = optimizerIdFromFingerprint(optimizer.optimizer_fingerprint);
  const existing = await env.DB.prepare('SELECT * FROM analysis_optimizer_runs WHERE id=? LIMIT 1').bind(id).first();
  if (existing) {
    if (existing.optimizer_fingerprint !== optimizer.optimizer_fingerprint) {
      throw new Error('optimizer run id collision with different canonical content');
    }
    let storedOptimizer;
    try { storedOptimizer = JSON.parse(existing.optimizer_json); } catch { throw new Error('stored optimizer_json is invalid'); }
    return storedOptimizerMetadata(existing, storedOptimizer, true);
  }

  const createdAt = exactIso(options.createdAt ?? new Date().toISOString(), 'created_at');
  const statements = [
    env.DB.prepare(`
      INSERT INTO analysis_optimizer_runs (
        id,game_round_id,decision_run_id,decision_fingerprint,contract_version,optimizer_version,policy_version,
        line_price_sek,target_budget_min_sek,max_budget_sek,spike_count,row_count,cost_sek,estimated_p8,
        policy_json,metrics_json,optimizer_json,optimizer_fingerprint,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, optimizer.round_id, optimizer.decision_run_id, optimizer.decision_fingerprint,
      optimizer.contract_version, optimizer.optimizer_version, optimizer.policy_version,
      optimizer.system.line_price_sek, optimizer.system.target_budget_min_sek, optimizer.system.max_budget_sek,
      optimizer.system.spike_count, optimizer.system.row_count, optimizer.system.cost_sek, optimizer.system.estimated_p8,
      stableFeatureJson(optimizer.policy), stableFeatureJson(optimizer.metrics),
      stableFeatureJson(optimizer), optimizer.optimizer_fingerprint, createdAt
    )
  ];
  for (const leg of optimizer.system.legs) {
    for (const entry of leg.selected_entries) {
      statements.push(env.DB.prepare(`
        INSERT INTO analysis_optimizer_selections (
          optimizer_run_id,leg_number,race_entry_id,is_spike,decision_probability
        ) VALUES (?,?,?,?,?)
      `).bind(id, leg.leg_number, entry.race_entry_id, leg.is_spike ? 1 : 0, entry.decision_probability));
    }
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await env.DB.prepare('SELECT * FROM analysis_optimizer_runs WHERE id=? LIMIT 1').bind(id).first();
    if (raced?.optimizer_fingerprint === optimizer.optimizer_fingerprint) {
      let storedOptimizer;
      try { storedOptimizer = JSON.parse(raced.optimizer_json); } catch { throw new Error('stored optimizer_json is invalid'); }
      return storedOptimizerMetadata(raced, storedOptimizer, true);
    }
    throw error;
  }

  const inserted = await env.DB.prepare('SELECT * FROM analysis_optimizer_runs WHERE id=? LIMIT 1').bind(id).first();
  if (!inserted) throw new Error('optimizer run could not be read after insert');
  return storedOptimizerMetadata(inserted, optimizer, false);
}

export async function persistOptimizerV1(env, roundId, options = {}) {
  const parents = await loadOptimizerParentsV1(env, roundId, options);
  const optimizer = await buildCanonicalOptimizerV1({ ...parents, generatedAt: options.generatedAt });
  return persistCanonicalOptimizerV1(env, optimizer, parents.decision, options);
}

export async function getOptimizerV1(env, { roundId, id = null, decisionRunId = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  let row;
  if (id) {
    row = await env.DB.prepare('SELECT * FROM analysis_optimizer_runs WHERE id=? LIMIT 1').bind(requiredText(id, 'id', 160)).first();
  } else if (decisionRunId) {
    row = await env.DB.prepare(`
      SELECT * FROM analysis_optimizer_runs
      WHERE decision_run_id=?
      ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
    `).bind(requiredText(decisionRunId, 'decision_run_id', 160)).first();
  } else {
    row = await env.DB.prepare(`
      SELECT * FROM analysis_optimizer_runs
      WHERE game_round_id=?
      ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
    `).bind(requiredText(roundId, 'round_id')).first();
  }
  if (!row) return null;
  let optimizer;
  try { optimizer = JSON.parse(row.optimizer_json); } catch { throw new Error('stored optimizer_json is invalid'); }
  return storedOptimizerMetadata(row, optimizer, true);
}
