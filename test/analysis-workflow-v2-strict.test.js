import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCombinedSystemShape } from '../src/analysis-workflow-v2-strict.js';

function selections(counts) {
  return counts.flatMap((count, index) => Array.from({ length: count }, (_, horseIndex) => ({
    leg_number: index + 1,
    race_entry_id: `entry-${index + 1}-${horseIndex + 1}`,
    is_spike: count === 1
  })));
}

test('context-free boundary accepts structurally valid systems and leaves spike policy to round validation', () => {
  const twoSpikeV85MainShape = {
    systems: [{ system_type: 'main', notes: 'synthetic reason', selections: selections([1, 1, 2, 2, 2, 2, 2, 2]) }]
  };
  assert.equal(validateCombinedSystemShape(twoSpikeV85MainShape), twoSpikeV85MainShape);
});

test('context-free boundary rejects missing systems array', () => {
  assert.throws(() => validateCombinedSystemShape({ systems: [] }), /at least one system/);
});

test('context-free boundary rejects a system without selections', () => {
  assert.throws(
    () => validateCombinedSystemShape({ systems: [{ system_type: 'main' }] }),
    /selections must be an array/
  );
});
