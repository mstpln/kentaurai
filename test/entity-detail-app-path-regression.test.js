import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/worker-v065.js', import.meta.url), 'utf8');

test('entity-detail UI enhancement applies to both /app and /app/ shell paths', () => {
  assert.match(source, /path !== '\/app' && path !== '\/app\/'/);
  assert.doesNotMatch(source, /pathname !== '\/app\/'/);
});
