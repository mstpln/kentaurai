import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceExternalEvidenceUiHtml } from '../src/app-external-evidence-ui.js';

function extractScript(html) {
  const match = String(html).match(/<script id="kentaurai-external-evidence-ui-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return match[1];
}

test('external evidence UI adds only the approved entity tabs and compiles', async () => {
  const html = enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  assert.match(html, /Extern statistik/);
  assert.match(html, /Intervjuer/);
  const script = extractScript(html);
  assert.doesNotThrow(() => new vm.Script(script));

  assert.match(script, /function evidenceTabs\(page\)/);
  assert.match(script, /\['external_stats','Extern statistik'\]/);
  assert.match(script, /\['interviews','Intervjuer'\]/);
  assert.match(script, /data-external-evidence-tab/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /renderEvidenceTab/);
  assert.doesNotMatch(script, /const previousEvidenceTabs = detailTabs/);
  assert.doesNotMatch(script, /renderDetail = async function/);
});

test('external evidence UI enhancer is idempotent', () => {
  const once = enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  const twice = enhanceExternalEvidenceUiHtml(once);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-script/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-style/g) || []).length, 1);
});
