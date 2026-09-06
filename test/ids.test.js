import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, stableId } from '../src/ids.js';

test('normalizeName is stable for Swedish text', () => {
  assert.equal(normalizeName('Jägersro'), 'jagersro');
  assert.equal(normalizeName('  Ready Star  '), 'ready-star');
});

test('stableId joins normalized identity parts', () => {
  assert.equal(stableId('race', 'Jägersro', '2026-09-06', '5'), 'race_jagersro__2026-09-06__5');
});
