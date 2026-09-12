import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import worker from '../src/worker-v065.js';

const source = fs.readFileSync(new URL('../src/worker-v065.js', import.meta.url), 'utf8');

test('bare /app is canonicalized to /app/ so the complete enhancement stack always runs', async () => {
  assert.match(source, /url\.pathname !== '\/app'/);
  assert.match(source, /target\.pathname = '\/app\/'/);
  assert.match(source, /path !== '\/app\/'/);

  const response = await worker.fetch(new Request('https://example.test/app?from=test'), {}, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.test/app/?from=test');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
