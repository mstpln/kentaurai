import { createMarketPackV3 } from './analysis-market-pack-v3.js';
import { requireLatestStep1LockV1 } from './analysis-step1-revision-v1.js';
import { stableFeatureJson } from './analysis-v3-foundations.js';

export const F4_STEP2_BUNDLE_CONTRACT = 'kentaurai-step2-bundle-v1';

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

function safeRoundId(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '_');
}

export async function createF4Step2Bundle(env, roundId, { asOf = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const lock = await requireLatestStep1LockV1(env, { roundId, asOf });
  const row = await env.DB.prepare(`
    SELECT lock_json
    FROM analysis_step1_locks
    WHERE id=? AND game_round_id=?
    LIMIT 1
  `).bind(lock.lock_id, roundId).first();
  if (!row?.lock_json) throw new Error('sealed Step 1 lock content is unavailable');

  let sealedStep1;
  try { sealedStep1 = JSON.parse(row.lock_json); }
  catch { throw new Error('sealed Step 1 lock content is invalid'); }

  const market = await createMarketPackV3(env, roundId, {
    lockId: lock.lock_id,
    lockHash: lock.lock_hash,
    asOf
  });

  return {
    contract_version: F4_STEP2_BUNDLE_CONTRACT,
    round_id: roundId,
    generated_at: market.manifest.generated_at,
    sealed_step1: sealedStep1,
    market_manifest: market.manifest,
    market_files: market.files.map((file) => ({
      name: file.name,
      content: JSON.parse(file.content)
    })),
    instructions: {
      conversation_memory_required: false,
      read_order: [
        'sealed_step1',
        'market_manifest',
        ...market.manifest.read_order.map((name) => `market_files:${name}`)
      ],
      rule: 'Use only this sealed Step 1 plus the bundled market files for Step 2. Do not reconstruct Step 1 from conversation memory.'
    }
  };
}

export async function createF4Step2BundleResponse(env, roundId, options = {}) {
  const bundle = await createF4Step2Bundle(env, roundId, options);
  return jsonResponse(bundle, 200, {
    'content-disposition': `attachment; filename="kentaurai-step2-v3_${safeRoundId(roundId)}.json"`
  });
}

export function stableF4Step2Bundle(value) {
  return stableFeatureJson(value);
}
