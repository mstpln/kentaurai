import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ANALYSIS_OPTIMIZER_CONTRACT,
  ANALYSIS_OPTIMIZER_EXACT_SPIKES,
  ANALYSIS_OPTIMIZER_POLICY_VERSION,
  ANALYSIS_OPTIMIZER_VERSION,
  buildCanonicalOptimizerV1
} from '../src/analysis-optimizer-v1.js';

globalThis.crypto ??= webcrypto;

const DECISION_FP = `sha256:${'1'.repeat(64)}`;

function syntheticDecision({ fieldSize = 4, equal = false, zeroTail = false } = {}) {
  return {
    contract_version: 'kentaurai-decision-probability-v1',
    decision_probability_version: 'decision-probability-v1-e1',
    policy_version: 'decision-blind-v1',
    round_id: 'round-e2',
    decision_fingerprint: DECISION_FP,
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      let probabilities;
      if (equal) {
        probabilities = Array.from({ length: fieldSize }, () => 1 / fieldSize);
      } else if (zeroTail && fieldSize >= 3) {
        probabilities = [0.7, 0.3, ...Array.from({ length: fieldSize - 2 }, () => 0)];
      } else {
        const weights = Array.from({ length: fieldSize }, (_, i) => fieldSize - i);
        const total = weights.reduce((sum, value) => sum + value, 0);
        probabilities = weights.map((value) => value / total);
      }
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        entries: probabilities.map((probability, entryIndex) => ({
          race_entry_id: `entry-${leg}-${String.fromCharCode(97 + entryIndex)}`,
          decision_probability: probability
        }))
      };
    })
  };
}

async function optimize(decision = syntheticDecision(), policy = {}) {
  return buildCanonicalOptimizerV1({
    decision,
    decisionRunId: 'decision-e2',
    gameType: 'V85',
    policy: {
      line_price_sek: 0.5,
      target_budget_min_sek: 150,
      max_budget_sek: 250,
      ...policy
    },
    generatedAt: '2099-06-01T12:00:00.000Z'
  });
}

test('E2 deterministically builds exactly three spikes with exact row product and budget-safe cost', async () => {
  const result = await optimize();
  assert.equal(result.contract_version, ANALYSIS_OPTIMIZER_CONTRACT);
  assert.equal(result.optimizer_version, ANALYSIS_OPTIMIZER_VERSION);
  assert.equal(result.policy_version, ANALYSIS_OPTIMIZER_POLICY_VERSION);
  assert.equal(result.system.spike_count, ANALYSIS_OPTIMIZER_EXACT_SPIKES);
  assert.equal(result.system.three_spike_legs.length, 3);

  const singletonLegs = result.system.legs.filter((leg) => leg.selected_count === 1);
  assert.equal(singletonLegs.length, 3);
  assert.ok(singletonLegs.every((leg) => leg.is_spike));
  assert.ok(result.system.legs.filter((leg) => leg.selected_count > 1).every((leg) => !leg.is_spike));

  const rows = result.system.legs.reduce((product, leg) => product * leg.selected_count, 1);
  assert.equal(result.system.row_count, rows);
  assert.equal(result.system.cost_sek, rows * 0.5);
  assert.ok(result.system.cost_sek <= 250);
  assert.ok(result.system.estimated_p8 >= 0 && result.system.estimated_p8 <= 1);
});

test('E2 same probabilities and policy always produce same canonical system and fingerprint', async () => {
  const first = await optimize();
  const later = await buildCanonicalOptimizerV1({
    decision: syntheticDecision(),
    decisionRunId: 'decision-e2',
    gameType: 'V85',
    policy: { line_price_sek: 0.5, target_budget_min_sek: 150, max_budget_sek: 250 },
    generatedAt: '2099-06-01T12:30:00.000Z'
  });
  assert.deepEqual(first.system, later.system);
  assert.deepEqual(first.metrics, later.metrics);
  assert.equal(first.optimizer_fingerprint, later.optimizer_fingerprint);
  assert.notEqual(first.generated_at, later.generated_at);
});

test('E2 stable ID ordering resolves equal-probability ties independently of input order', async () => {
  const decision = syntheticDecision({ fieldSize: 3, equal: true });
  for (const leg of decision.legs) leg.entries.reverse();
  const first = await optimize(decision, { max_budget_sek: 16, target_budget_min_sek: 1 });
  const second = await optimize(syntheticDecision({ fieldSize: 3, equal: true }), { max_budget_sek: 16, target_budget_min_sek: 1 });
  assert.deepEqual(first.system, second.system);
  for (const leg of first.system.legs) {
    assert.deepEqual(
      leg.selected_entries.map((entry) => entry.race_entry_id),
      [...leg.selected_entries.map((entry) => entry.race_entry_id)].sort()
    );
  }
});


test('E2 keeps exact3 when only two legs have enormous favorites', async () => {
  const decision = syntheticDecision({ fieldSize: 3 });
  for (let leg = 0; leg < 2; leg += 1) {
    decision.legs[leg].entries = [
      { race_entry_id: `entry-${leg + 1}-a`, decision_probability: 0.96 },
      { race_entry_id: `entry-${leg + 1}-b`, decision_probability: 0.03 },
      { race_entry_id: `entry-${leg + 1}-c`, decision_probability: 0.01 }
    ];
  }
  const result = await optimize(decision);
  assert.equal(result.system.spike_count, 3);
  assert.equal(result.system.legs.filter((leg) => leg.selected_count === 1).length, 3);
});

test('E2 still selects exactly three spikes when four legs look spike-like', async () => {
  const decision = syntheticDecision({ fieldSize: 3 });
  for (let leg = 0; leg < 4; leg += 1) {
    decision.legs[leg].entries = [
      { race_entry_id: `entry-${leg + 1}-a`, decision_probability: 0.98 },
      { race_entry_id: `entry-${leg + 1}-b`, decision_probability: 0.015 },
      { race_entry_id: `entry-${leg + 1}-c`, decision_probability: 0.005 }
    ];
  }
  const result = await optimize(decision);
  assert.equal(result.system.spike_count, 3);
  assert.equal(result.system.three_spike_legs.length, 3);
});

test('E2 accepts a budget that exactly equals the selected candidate cost', async () => {
  const first = await optimize(syntheticDecision({ fieldSize: 3 }), {
    target_budget_min_sek: 1,
    max_budget_sek: 250
  });
  const exact = await optimize(syntheticDecision({ fieldSize: 3 }), {
    target_budget_min_sek: 1,
    max_budget_sek: first.system.cost_sek
  });
  assert.equal(exact.system.cost_sek, first.system.cost_sek);
  assert.equal(exact.system.budget_unused_sek, 0);
  assert.equal(exact.system.spike_count, 3);
});

test('E2 does not force budget spend when extra rows add no P8 coverage', async () => {
  const result = await optimize(syntheticDecision({ fieldSize: 4, zeroTail: true }));
  assert.equal(result.system.row_count, 32);
  assert.equal(result.system.cost_sek, 16);
  assert.equal(result.system.within_target_budget_band, false);
  assert.equal(result.metrics.budget_forcing_applied, false);
  assert.ok(result.system.budget_unused_sek > 0);
});

test('E2 handles a wide 15-entry leg within deterministic frontier search', async () => {
  const decision = syntheticDecision();
  const wideWeights = Array.from({ length: 15 }, (_, index) => 15 - index);
  const total = wideWeights.reduce((sum, value) => sum + value, 0);
  decision.legs[4].entries = wideWeights.map((weight, index) => ({
    race_entry_id: `entry-5-wide-${String(index + 1).padStart(2, '0')}`,
    decision_probability: weight / total
  }));
  const result = await optimize(decision);
  assert.equal(result.system.legs[4].selected_entries.length, result.system.legs[4].selected_count);
  assert.ok(result.metrics.frontier_sizes.includes(15));
  assert.equal(result.system.spike_count, 3);
});

test('E2 supports decimal line price without floating budget drift', async () => {
  const result = await optimize(syntheticDecision({ fieldSize: 3 }), {
    line_price_sek: 0.17,
    target_budget_min_sek: 1,
    max_budget_sek: 5.44
  });
  assert.equal(result.system.cost_sek, result.system.row_count * 0.17);
  assert.ok(result.system.cost_sek <= 5.44);
});

test('E2 fails closed on missing probability, duplicate entry identity, scratched input and impossible exact3', async () => {
  const missing = syntheticDecision();
  missing.legs[0].entries[0].decision_probability = null;
  await assert.rejects(() => optimize(missing), /probability between 0 and 1/);

  const duplicate = syntheticDecision();
  duplicate.legs[1].entries[0].race_entry_id = duplicate.legs[0].entries[0].race_entry_id;
  await assert.rejects(() => optimize(duplicate), /duplicate race_entry_id/);

  const scratched = syntheticDecision();
  scratched.legs[0].entries[0].scratched = true;
  await assert.rejects(() => optimize(scratched), /ineligible\/scratched entry/);

  const impossible = syntheticDecision();
  for (let leg = 0; leg < 4; leg += 1) impossible.legs[leg].entries = [{ race_entry_id: `entry-${leg + 1}-a`, decision_probability: 1 }];
  await assert.rejects(() => optimize(impossible), /more than three legs have only one active entry/);
});

test('E2 rejects two-spike policy proposals and unsupported game/system policy', async () => {
  await assert.rejects(
    () => optimize(syntheticDecision(), { exact_spike_count: 2 }),
    /requires exactly 3 spikes/
  );
  await assert.rejects(
    () => optimize(syntheticDecision(), { system_type: 'alternative' }),
    /supports only the main system/
  );
  await assert.rejects(
    () => buildCanonicalOptimizerV1({
      decision: syntheticDecision(),
      decisionRunId: 'decision-e2',
      gameType: 'V75',
      policy: { line_price_sek: 0.5, max_budget_sek: 250, target_budget_min_sek: 150 }
    }),
    /only V85\/V86/
  );
});
