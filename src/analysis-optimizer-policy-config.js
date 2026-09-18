export const ANALYSIS_OPTIMIZER_POLICY_CONFIG_VERSION = 'v85-v86-line-price-config-v1';
export const ANALYSIS_OPTIMIZER_TARGET_MIN_SEK = 150;
export const ANALYSIS_OPTIMIZER_MAX_BUDGET_SEK = 250;
export const ANALYSIS_OPTIMIZER_EXACT_SPIKES_CONFIG = 3;

function positiveMoney(value, field) {
  if (value == null || value === '') throw new Error(`${field} is not configured`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1000) {
    throw new Error(`${field} must be a positive finite SEK amount`);
  }
  return number;
}

export function configuredLinePriceSek(env, gameType) {
  const type = String(gameType || '').trim().toUpperCase();
  if (type === 'V85') return positiveMoney(env?.V85_LINE_PRICE_SEK, 'V85_LINE_PRICE_SEK');
  if (type === 'V86') return positiveMoney(env?.V86_LINE_PRICE_SEK, 'V86_LINE_PRICE_SEK');
  throw new Error('optimizer line-price config supports only V85/V86');
}

export function canonicalOptimizerPolicyForGameType(env, gameType) {
  return {
    line_price_sek: configuredLinePriceSek(env, gameType),
    target_budget_min_sek: ANALYSIS_OPTIMIZER_TARGET_MIN_SEK,
    max_budget_sek: ANALYSIS_OPTIMIZER_MAX_BUDGET_SEK,
    exact_spike_count: ANALYSIS_OPTIMIZER_EXACT_SPIKES_CONFIG,
    system_type: 'main'
  };
}

export async function canonicalOptimizerPolicyForRound(env, roundId) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = String(roundId || '').trim();
  if (!id) throw new Error('round_id is required');
  const row = await env.DB.prepare('SELECT game_type FROM game_rounds WHERE id=? LIMIT 1').bind(id).first();
  if (!row) throw new Error('V85/V86 round was not found');
  return canonicalOptimizerPolicyForGameType(env, row.game_type);
}
