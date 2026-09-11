import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceTrendHtml } from '../src/trend-ui.js';

test('Trend enhancement preserves previously composed renderStart wrappers', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
  assert.match(match[1], /const priorTrendRenderStart=renderStart;/);
  assert.match(match[1], /await priorTrendRenderStart\(\);/);
  assert.match(match[1], /return renderTrendBuildA\(\);/);
  assert.match(match[1], /data-trend-category[\s\S]*renderTrendBuildA\(\)/);
  assert.doesNotMatch(match[1], /renderStart=async function\(\)\{\s*state\.detail=null/);
});
