import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceExternalAnalysisUiHtml } from '../src/app-external-analysis-ui.js';

test('external analysis UI matches approved three-step structure and strips sealed optimizer UI', () => {
  const legacy = '<!doctype html><html><head><style id="kentaurai-f3-private-ui-style">old</style></head><body><div id="app"></div><script id="kentaurai-f3-private-ui-script">old()</script></body></html>';
  const html = enhanceExternalAnalysisUiHtml(legacy);

  assert.match(html,/Analysera omgång/);
  assert.match(html,/externalAnalysisRound/);
  assert.match(html,/externalProvider/);
  assert.match(html,/Marknadsblind analys/);
  assert.match(html,/Marknad och system/);
  assert.match(html,/Registrera system/);
  assert.match(html,/externalRegistrationRound/);
  assert.match(html,/Registrera färdigt system/);
  assert.match(html,/Hämta importunderlag/);
  assert.match(html,/settings-primary[^"]*" type="button">Hämta importunderlag/);
  assert.match(html,/settings-secondary[^"]*" type="button">Importera system/);
  assert.doesNotMatch(html,/kentaurai-f3-private-ui-script/);
  assert.doesNotMatch(html,/Försegla Steg 1/);
  assert.doesNotMatch(html,/Importera och optimera/);

  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length,1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});
