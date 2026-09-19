import test from 'node:test';
import assert from 'node:assert/strict';

import { enhanceExternalEvidenceUiHtml } from '../src/app-external-evidence-ui.js';

test('external evidence enhancer installs presentation styles only', () => {
  const html = enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  assert.match(html, /kentaurai-external-evidence-ui-style/);
  assert.match(html, /external-evidence-table/);
  assert.match(html, /external-interview-card/);
  assert.doesNotMatch(html, /kentaurai-external-evidence-ui-script/);
});

test('external evidence style enhancer is idempotent', () => {
  const once = enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  const twice = enhanceExternalEvidenceUiHtml(once);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-style/g) || []).length, 1);
});
