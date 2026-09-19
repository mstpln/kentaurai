import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceEntityDetailRuntimeFinalHtml } from '../src/entity-detail-runtime-final.js';

function extractScript(html) {
  const match = String(html).match(/<script id="kentaurai-entity-detail-runtime-final">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return match[1];
}

test('final entity runtime owns evidence tabs after all earlier overlays', async () => {
  const html = enhanceEntityDetailRuntimeFinalHtml('<html><head></head><body></body></html>');
  const script = extractScript(html);
  assert.doesNotThrow(() => new vm.Script(script));

  const context = vm.createContext({
    state: { detail:{ page:'horses', id:'horse-1' }, tab:'stats' },
    detailTabs(type) {
      if (type === 'horse') return [['stats','Statistik'],['starts','Starter'],['data','Data']];
      if (type === 'trainer') return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
      return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
    },
    statsView() { return '<div>legacy</div>'; },
    async renderDetail() {},
    app: { querySelector() { return null; } },
    api: async () => ({ items:[] }),
    esc: (value) => String(value ?? ''),
    Intl,
    Date,
    Number,
    Map,
    encodeURIComponent,
    console
  });
  new vm.Script(script).runInContext(context);

  assert.deepEqual(
    Array.from(context.detailTabs('horse'), (row) => Array.from(row)),
    [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('trainer'), (row) => Array.from(row)),
    [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('driver'), (row) => Array.from(row)),
    [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.match(context.statsView({}), /entity-detail-bootstrap-skeleton/);
});

test('final entity runtime enhancer is idempotent', () => {
  const once = enhanceEntityDetailRuntimeFinalHtml('<html><head></head><body></body></html>');
  const twice = enhanceEntityDetailRuntimeFinalHtml(once);
  assert.equal((twice.match(/kentaurai-entity-detail-runtime-final/g) || []).length, 1);
});
