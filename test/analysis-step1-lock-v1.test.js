import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ANALYSIS_STEP1_LOCK_CONTRACT,
  assertStep1MarketBlind,
  importStep1LockV1,
  isExactStoredStep1Retry,
  step1LockHash,
  validateStep1LockV1AgainstPack
} from '../src/analysis-step1-lock-v1.js';
import { stableFeatureJson } from '../src/analysis-v3-foundations.js';
import { ANALYSIS_STEP1_PROMPT_V3_VERSION, getAnalysisStep1PromptV3 } from '../src/analysis-step1-prompt-v3.js';

globalThis.crypto ??= webcrypto;

function syntheticPack() {
  const files = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    files.push({
      name: `${String(leg).padStart(2, '0')}_leg_${leg}.json`,
      payload: {
        leg_number: leg,
        race: { race_id: `race-${leg}` },
        entries: [
          { race_entry_id: `entry-${leg}-a`, current_facts: { analysis_eligible: true } },
          { race_entry_id: `entry-${leg}-b`, current_facts: { analysis_eligible: true } },
          { race_entry_id: `entry-${leg}-scratched`, current_facts: { analysis_eligible: false } }
        ]
      }
    });
  }
  return {
    manifest: {
      round_id: 'round-v85-synthetic',
      pack_id: 'pack_synthetic',
      as_of: '2026-09-15T08:00:00.000Z',
      facts_fingerprint: 'sha256:synthetic-facts'
    },
    files
  };
}

function syntheticLock() {
  return {
    contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    lock_id: 'step1_synthetic_001',
    round_id: 'round-v85-synthetic',
    pack: {
      pack_id: 'pack_synthetic',
      as_of: '2026-09-15T08:00:00Z',
      facts_fingerprint: 'sha256:synthetic-facts'
    },
    provider: 'openai',
    model: 'synthetic-model',
    prompt_version: ANALYSIS_STEP1_PROMPT_V3_VERSION,
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        data_quality_summary: 'Synthetic evidence only.',
        race_shape_summary: 'Entry A has the stronger supplied sporting evidence.',
        scenario_confidence: 0.6,
        scenarios: [],
        predictions: [
          {
            race_entry_id: `entry-${leg}-a`, blind_probability: 0.6, uncertainty_low: 0.5, uncertainty_high: 0.7,
            raw_rank: 1, abcd_group: 'A', assessment_confidence: 0.7, key_unknowns: ['No direct X-Labs sample in this context.'], reasoning: 'Stronger supplied capacity and form evidence.'
          },
          {
            race_entry_id: `entry-${leg}-b`, blind_probability: 0.4, uncertainty_low: 0.3, uncertainty_high: 0.5,
            raw_rank: 2, abcd_group: 'B', assessment_confidence: 0.6, reasoning: 'Solid but weaker supplied evidence.'
          }
        ]
      };
    })
  };
}

test('Step 1 lock validates exact eight-leg active-entry identity and canonicalizes pack timestamp', async () => {
  const normalized = await validateStep1LockV1AgainstPack(syntheticLock(), syntheticPack());
  assert.equal(normalized.contract_version, ANALYSIS_STEP1_LOCK_CONTRACT);
  assert.equal(normalized.pack.as_of, '2026-09-15T08:00:00.000Z');
  assert.equal(normalized.legs.length, 8);
  assert.deepEqual(normalized.legs[0].predictions.map((item) => item.race_entry_id), ['entry-1-a', 'entry-1-b']);
  assert.equal(normalized.legs[0].predictions.some((item) => item.race_entry_id.includes('scratched')), false);
  assert.deepEqual(normalized.legs[0].predictions[0].key_unknowns, ['No direct X-Labs sample in this context.']);
  assert.equal(Object.hasOwn(normalized.legs[0].predictions[1], 'key_unknowns'), false);
});

test('Step 1 lock uses one strict snake_case wire contract', async () => {
  const camelCase = syntheticLock();
  camelCase.legs[0].predictions[0].raceEntryId = camelCase.legs[0].predictions[0].race_entry_id;
  delete camelCase.legs[0].predictions[0].race_entry_id;
  await assert.rejects(() => validateStep1LockV1AgainstPack(camelCase, syntheticPack()), /strict snake_case/);
});

test('Step 1 lock rejects unsupported top-level and nested fields fail-closed', async () => {
  const topLevel = syntheticLock();
  topLevel.unexpected_field = true;
  await assert.rejects(() => validateStep1LockV1AgainstPack(topLevel, syntheticPack()), /unsupported fields/);

  const nested = syntheticLock();
  nested.legs[0].predictions[0].unexpected_field = 'ignored only if validation is unsafe';
  await assert.rejects(() => validateStep1LockV1AgainstPack(nested, syntheticPack()), /unsupported fields/);
});

test('Step 1 lock rejects market contamination in structured fields and narrative text', async () => {
  const fieldLeak = syntheticLock();
  fieldLeak.legs[0].predictions[0].market_percent = 30;
  await assert.rejects(() => validateStep1LockV1AgainstPack(fieldLeak, syntheticPack()), /denied current-market fields/);

  const textLeak = syntheticLock();
  textLeak.legs[0].predictions[0].reasoning = 'Current odds make this attractive.';
  await assert.rejects(() => validateStep1LockV1AgainstPack(textLeak, syntheticPack()), /current-market\/system language/);
  assert.throws(() => assertStep1MarketBlind({ bettingPercentage: 12 }), /denied current-market fields/);
});

test('Step 1 lock rejects stale/wrong parent identity, incomplete coverage and invalid probability order', async () => {
  const wrongPack = syntheticLock();
  wrongPack.pack.facts_fingerprint = 'sha256:other';
  await assert.rejects(() => validateStep1LockV1AgainstPack(wrongPack, syntheticPack()), /facts_fingerprint/);

  const missing = syntheticLock();
  missing.legs[2].predictions.pop();
  await assert.rejects(() => validateStep1LockV1AgainstPack(missing, syntheticPack()), /cover every active entry/);

  const wrongRace = syntheticLock();
  wrongRace.legs[4].race_id = 'race-other';
  await assert.rejects(() => validateStep1LockV1AgainstPack(wrongRace, syntheticPack()), /race_id does not match/);

  const inverted = syntheticLock();
  inverted.legs[5].predictions[0].blind_probability = 0.4;
  inverted.legs[5].predictions[0].uncertainty_low = 0.3;
  inverted.legs[5].predictions[0].uncertainty_high = 0.5;
  inverted.legs[5].predictions[1].blind_probability = 0.6;
  inverted.legs[5].predictions[1].uncertainty_low = 0.5;
  inverted.legs[5].predictions[1].uncertainty_high = 0.7;
  await assert.rejects(() => validateStep1LockV1AgainstPack(inverted, syntheticPack()), /raw_rank conflicts/);
});

test('Step 1 lock canonical hash is stable for equivalent key ordering and changes with sealed content', async () => {
  const lock = await validateStep1LockV1AgainstPack(syntheticLock(), syntheticPack());
  const reordered = Object.fromEntries(Object.entries(lock).reverse());
  assert.equal(await step1LockHash(lock), await step1LockHash(reordered));
  const changed = structuredClone(lock);
  changed.legs[0].predictions[0].reasoning = 'Changed sealed interpretation.';
  assert.notEqual(await step1LockHash(lock), await step1LockHash(changed));
});

test('exact stored Step 1 retry is idempotent without reopening the parent pack', async () => {
  const normalized = await validateStep1LockV1AgainstPack(syntheticLock(), syntheticPack());
  const row = { lock_json: stableFeatureJson(normalized) };
  const exactRetry = structuredClone(normalized);
  exactRetry.pack.as_of = '2026-09-15T08:00:00Z';
  assert.equal(isExactStoredStep1Retry(row, exactRetry), true);

  const changed = structuredClone(exactRetry);
  changed.legs[0].predictions[0].reasoning = 'Changed sealed interpretation.';
  assert.equal(isExactStoredStep1Retry(row, changed), false);

  const aliasRetry = structuredClone(exactRetry);
  aliasRetry.lockId = aliasRetry.lock_id;
  delete aliasRetry.lock_id;
  assert.equal(isExactStoredStep1Retry(row, aliasRetry), false);
});

test('stored Step 1 lock reuses an exact retry and rejects changed content under the same lock id', async () => {
  const normalized = await validateStep1LockV1AgainstPack(syntheticLock(), syntheticPack());
  const row = {
    id: normalized.lock_id,
    game_round_id: normalized.round_id,
    contract_version: normalized.contract_version,
    pack_id: normalized.pack.pack_id,
    pack_as_of: normalized.pack.as_of,
    facts_fingerprint: normalized.pack.facts_fingerprint,
    provider: normalized.provider,
    model: normalized.model,
    prompt_version: normalized.prompt_version,
    lock_json: stableFeatureJson(normalized),
    lock_hash: await step1LockHash(normalized),
    created_at: '2026-09-15T08:05:00.000Z'
  };
  const env = {
    DB: {
      prepare() {
        return { bind() { return { first: async () => row }; } };
      }
    }
  };

  const exactRetry = structuredClone(normalized);
  exactRetry.pack.as_of = '2026-09-15T08:00:00Z';
  const reused = await importStep1LockV1(env, exactRetry);
  assert.equal(reused.reused, true);
  assert.equal(reused.lock_hash, row.lock_hash);

  const changed = structuredClone(exactRetry);
  changed.legs[0].predictions[0].reasoning = 'Changed sealed interpretation.';
  await assert.rejects(() => importStep1LockV1(env, changed), /already sealed with different content/);
});

test('Step 1 prompt v3 is provider-neutral at core and forbids outside/current-market analysis', () => {
  const openai = getAnalysisStep1PromptV3('openai');
  const anthropic = getAnalysisStep1PromptV3('anthropic');
  for (const prompt of [openai, anthropic]) {
    assert.match(prompt, /Use only the supplied kentaurai-analysis-pack-v3 files/);
    assert.match(prompt, /Do not browse the web/);
    assert.match(prompt, /Missing X-Labs.*must never reduce a horse's baseline strength/s);
    assert.match(prompt, /blind_probability/);
    assert.match(prompt, /key_unknowns/);
    assert.match(prompt, /kentaurai-step1-lock-v1/);
    assert.match(prompt, /step1-prompt-v3-d2/);
    assert.match(prompt, /Do not use or discuss current streck/);
  }
  assert.match(openai, /provider to "openai"/);
  assert.match(anthropic, /provider to "anthropic"/);
  assert.throws(() => getAnalysisStep1PromptV3('other'), /provider must be openai or anthropic/);
});
