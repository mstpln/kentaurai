import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCombinedSystemSpikeContract } from '../src/analysis-workflow-v2-strict.js';

function selections(counts) {
  return counts.flatMap((count, index) => Array.from({ length: count }, (_, horseIndex) => ({
    leg_number: index + 1,
    race_entry_id: `entry-${index + 1}-${horseIndex + 1}`,
    is_spike: count === 1
  })));
}

test('strict combined boundary accepts exactly three singleton spike legs', () => {
  const payload = { systems: [{ selections: selections([1, 1, 1, 2, 2, 2, 2, 2]) }] };
  assert.equal(validateCombinedSystemSpikeContract(payload), payload);
});

test('strict combined boundary rejects V85-style two-spike systems before persistence', () => {
  const payload = { systems: [{ system_type: 'main', selections: selections([1, 1, 2, 2, 2, 2, 2, 2]) }] };
  assert.throws(
    () => validateCombinedSystemSpikeContract(payload),
    /exactly three spike legs/
  );
});

test('strict combined boundary rejects four singleton spike legs', () => {
  const payload = { systems: [{ selections: selections([1, 1, 1, 1, 2, 2, 2, 2]) }] };
  assert.throws(
    () => validateCombinedSystemSpikeContract(payload),
    /exactly three spike legs/
  );
});
