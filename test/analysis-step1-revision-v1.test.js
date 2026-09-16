import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ANALYSIS_STEP1_REVISION_CONTRACT,
  ANALYSIS_STEP1_REVISION_INPUT_CONTRACT,
  ANALYSIS_STEP1_REVISION_VERSION,
  buildAffectedLegFactDelta,
  canonicalLegsFromAnalysisPack,
  detectAffectedLegsFromPacks,
  getAnalysisStep1RevisionPromptV1,
  requireLatestStep1LockV1
} from '../src/analysis-step1-revision-v1.js';
import { assertAnalysisPackMarketBlind } from '../src/analysis-pack-v3.js';

globalThis.crypto ??= webcrypto;

function syntheticPack(fingerprint = 'sha256:before') {
  return {
    manifest: {
      round_id: 'round-synthetic',
      pack_id: `pack-${fingerprint.slice(-6)}`,
      as_of: '2026-09-16T08:00:00.000Z',
      facts_fingerprint: fingerprint
    },
    files: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        name: `${String(leg).padStart(2, '0')}_leg_${leg}.json`,
        payload: {
          contract_version: 'kentaurai-analysis-pack-v3',
          pack_version: 'analysis-pack-v3-d1',
          as_of: '2026-09-16T08:00:00.000Z',
          contains_current_market: false,
          leg_number: leg,
          race: { race_id: `race-${leg}`, distance_m: 2140 },
          entries: [
            {
              race_entry_id: `entry-${leg}-a`,
              current_facts: {
                analysis_eligible: true,
                scratched: false,
                driver_id: `driver-${leg}-a`,
                equipment: { shoes: 'unknown', bike: 'unknown' }
              }
            },
            {
              race_entry_id: `entry-${leg}-b`,
              current_facts: {
                analysis_eligible: true,
                scratched: false,
                driver_id: `driver-${leg}-b`,
                equipment: { shoes: 'unknown', bike: 'unknown' }
              }
            }
          ]
        }
      };
    })
  };
}

test('D3 detects scratch, driver and equipment late facts only in their affected legs', () => {
  const before = syntheticPack();
  const after = structuredClone(before);
  after.manifest.facts_fingerprint = 'sha256:after';
  after.files[0].payload.entries[1].current_facts.analysis_eligible = false;
  after.files[0].payload.entries[1].current_facts.scratched = true;
  after.files[1].payload.entries[0].current_facts.driver_id = 'driver-replacement';
  after.files[2].payload.entries[0].current_facts.equipment = { shoes: 'off', bike: 'american' };

  assert.deepEqual(detectAffectedLegsFromPacks(before, after), [1, 2, 3]);
  const delta = buildAffectedLegFactDelta(before, after, [1, 2, 3]);
  assert.equal(delta.length, 3);
  assert.ok(delta[0].changes.some((change) => change.path.includes('analysis_eligible')));
  assert.ok(delta[1].changes.some((change) => change.path.includes('driver_id')));
  assert.ok(delta[2].changes.some((change) => change.path.includes('equipment')));
});

test('D3 escalates a fingerprint-only round-level change to all eight legs', () => {
  const before = syntheticPack('sha256:before');
  const after = structuredClone(before);
  after.manifest.facts_fingerprint = 'sha256:round-only-change';
  assert.deepEqual(detectAffectedLegsFromPacks(before, after), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('D3 canonical leg comparison ignores pack transport timestamps', () => {
  const before = syntheticPack();
  const after = structuredClone(before);
  after.manifest.facts_fingerprint = before.manifest.facts_fingerprint;
  after.manifest.as_of = '2026-09-16T09:00:00.000Z';
  for (const file of after.files) file.payload.as_of = '2026-09-16T09:00:00.000Z';
  assert.deepEqual(detectAffectedLegsFromPacks(before, after), []);
  assert.equal(canonicalLegsFromAnalysisPack(after).size, 8);
});

test('D3 revision context inherits the fail-closed market boundary', () => {
  const pack = syntheticPack();
  const context = [...canonicalLegsFromAnalysisPack(pack).values()];
  assert.equal(assertAnalysisPackMarketBlind(context), true);
  context[0].entries[0].current_facts.market_percent = 22;
  assert.throws(() => assertAnalysisPackMarketBlind(context), /denied current-market fields/);
});

test('D3 requires the newest sealed Step 1 lock before Step 2 market export', async () => {
  const latest = {
    id: 'child-lock', game_round_id: 'round-synthetic', pack_id: 'pack-child', pack_as_of: '2026-09-16T08:30:00.000Z',
    facts_fingerprint: 'sha256:child', provider: 'openai', model: 'synthetic-model', prompt_version: 'step1-prompt-v3-d2',
    lock_hash: 'sha256:lock', created_at: '2026-09-16T08:31:00.000Z'
  };
  const env = {
    DB: {
      prepare() {
        return { bind() { return { first: async () => latest }; } };
      }
    }
  };
  await assert.rejects(
    () => requireLatestStep1LockV1(env, { roundId: 'round-synthetic', lockId: 'parent-lock' }),
    /newest sealed Step 1 lock/
  );
  const current = await requireLatestStep1LockV1(env, { roundId: 'round-synthetic', lockId: 'child-lock' });
  assert.equal(current.lock_id, 'child-lock');
});

test('D3 revision prompt is market-blind and affected-leg-only for both providers', () => {
  for (const provider of ['openai', 'anthropic']) {
    const prompt = getAnalysisStep1RevisionPromptV1(provider);
    assert.match(prompt, new RegExp(ANALYSIS_STEP1_REVISION_CONTRACT));
    assert.match(prompt, new RegExp(ANALYSIS_STEP1_REVISION_INPUT_CONTRACT));
    assert.match(prompt, new RegExp(ANALYSIS_STEP1_REVISION_VERSION.split('-d3')[0]));
    assert.match(prompt, /Reanalyse only the listed affected_legs/);
    assert.match(prompt, /Do not browse the web/);
    assert.match(prompt, /Do not use or discuss current streck/);
  }
  assert.throws(() => getAnalysisStep1RevisionPromptV1('other'), /provider must be openai or anthropic/);
});
