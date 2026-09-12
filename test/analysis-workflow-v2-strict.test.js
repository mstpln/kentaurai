import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCombinedImportPayload, validateCombinedSystemShape } from '../src/analysis-workflow-v2-strict.js';

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

test('combined import normalizes overlong risk_profile without requiring the user to edit the file', () => {
  const fullRiskProfile = 'A'.repeat(180);
  const payload = {
    systems: [{
      system_type: 'main',
      risk_profile: fullRiskProfile,
      notes: 'Original notes',
      selections: selections([1, 1, 1, 2, 2, 2, 2, 2])
    }]
  };
  const normalized = normalizeCombinedImportPayload(payload);
  assert.notEqual(normalized, payload);
  assert.equal(normalized.systems[0].risk_profile.length, 100);
  assert.match(normalized.systems[0].notes, /Original notes/);
  assert.match(normalized.systems[0].notes, /Full risk_profile from import:/);
  assert.match(normalized.systems[0].notes, new RegExp(`A{180}`));
  assert.equal(payload.systems[0].risk_profile.length, 180);
});

test('combined import leaves valid risk_profile untouched', () => {
  const payload = {
    systems: [{ system_type: 'main', risk_profile: 'Balanserad', selections: selections([1, 1, 1, 2, 2, 2, 2, 2]) }]
  };
  assert.equal(normalizeCombinedImportPayload(payload), payload);
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
