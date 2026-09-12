import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceAnalysisExportDownloads } from '../src/analysis-export-ui-fix.js';

test('analysis export UI installs one capture-phase single-download handler bound to selected round', () => {
  const html = enhanceAnalysisExportDownloads('<html><body><button id="exportStep1">Export</button></body></html>');
  assert.match(html, /kentaurai-analysis-export-download-fix/);
  assert.match(html, /stopImmediatePropagation/);
  assert.match(html, /exportBusy/);
  assert.match(html, /exportProvider/);
  assert.match(html, /analysisRound/);
  assert.match(html, /analysis-rounds/);
  assert.match(html, /round_id=/);
  assert.match(html, /stage=.*market|pre_market/);
  assert.match(html, /link\.download=filename/);
});

test('analysis export UI binds the final export prompt to the same selected round and marks historical recovery', () => {
  const html = enhanceAnalysisExportDownloads('<html><body><button id="copyAnalysisPrompt">Copy</button></body></html>');
  assert.match(html, /copyAnalysisPrompt/);
  assert.match(html, /analysis-prompt\?provider=/);
  assert.match(html, /round_id=/);
  assert.match(html, /post_race_recovery/);
  assert.match(html, /historisk/);
});

test('analysis export UI enhancer is idempotent', () => {
  const once = enhanceAnalysisExportDownloads('<html><body></body></html>');
  const twice = enhanceAnalysisExportDownloads(once);
  assert.equal((twice.match(/kentaurai-analysis-export-download-fix/g) || []).length, 1);
});
