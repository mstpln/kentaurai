import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceExternalEvidenceUiHtml } from '../src/app-external-evidence-v1.js';

test('external evidence UI injects the approved six-step settings flow and entity tabs', () => {
  const html=enhanceExternalEvidenceUiHtml('<html><head></head><body><main id="app"></main></body></html>');
  assert.match(html,/Marknadsblind analys/);
  assert.match(html,/Marknadsanalys/);
  assert.match(html,/Intervjuer & extern statistik/);
  assert.match(html,/Bygg färdigt system/);
  assert.match(html,/Registrera extern statistik & intervjuer/);
  assert.match(html,/Skapa och importera extern data/);
  assert.match(html,/Registrera färdigt system/);
  assert.match(html,/Extern statistik/);
  assert.match(html,/Intervjuer/);
  assert.doesNotMatch(html,/Marknad och system/);
});

test('external evidence UI is injected only once', () => {
  const once=enhanceExternalEvidenceUiHtml('<html><head></head><body></body></html>');
  const twice=enhanceExternalEvidenceUiHtml(once);
  assert.equal(twice,once);
});
