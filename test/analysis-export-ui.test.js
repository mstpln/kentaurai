import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceAnalysisExportDownloads } from '../src/analysis-export-ui-fix.js';

test('analysis export UI installs one capture-phase single-download handler', () => {
  const html = enhanceAnalysisExportDownloads('<html><body><button id="exportStep1">Export</button></body></html>');
  assert.match(html, /kentaurai-analysis-export-download-fix/);
  assert.match(html, /stopImmediatePropagation/);
  assert.match(html, /exportBusy/);
  assert.match(html, /provider=.*selected|exportProvider/);
  assert.match(html, /stage=.*market|pre_market/);
  assert.match(html, /link\.download=filename/);
});

test('analysis export UI enhancer is idempotent', () => {
  const once = enhanceAnalysisExportDownloads('<html><body></body></html>');
  const twice = enhanceAnalysisExportDownloads(once);
  assert.equal((twice.match(/kentaurai-analysis-export-download-fix/g) || []).length, 1);
});
