import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateEditorialImport } from '../src/import/editorial.js';

const example = JSON.parse(
  readFileSync(new URL('../fixtures/editorial-import.example.json', import.meta.url), 'utf8')
);

test('manual editorial contract accepts structured export', () => {
  const items = validateEditorialImport(example);
  assert.equal(items.length, 1);
  assert.equal(items[0].horseName, 'Example Horse');
  assert.equal(items[0].signals[0].type, 'target');
});

test('manual editorial contract rejects invalid confidence', () => {
  const bad = structuredClone(example);
  bad.items[0].signals[0].confidence = 2;
  assert.throws(() => validateEditorialImport(bad), /confidence/);
});
