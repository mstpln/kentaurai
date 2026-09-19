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

  const context = vm.createContext({
    state: { detail:null, tab:'stats' },
    detailTabs(type) {
      if (type === 'horse') return [['stats','Statistik'],['starts','Starter'],['equipment','Utrustning'],['data','Data']];
      return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
    },
    async renderDetail() {},
    document: { querySelector() { return null; } },
    api: async () => ({ items:[] }),
    esc: (value) => String(value ?? ''),
    Intl,
    Date,
    Number,
    Map,
    console
  });
  new vm.Script(script).runInContext(context);

  assert.deepEqual(
    Array.from(context.detailTabs('horse'), (row) => Array.from(row)),
    [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['equipment','Utrustning'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('trainer'), (row) => Array.from(row)),
    [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('driver'), (row) => Array.from(row)),
    [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
});

test('external evidence UI enhancer is idempotent', () => {
  const once = enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  const twice = enhanceExternalEvidenceUiHtml(once);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-script/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-style/g) || []).length, 1);
});
