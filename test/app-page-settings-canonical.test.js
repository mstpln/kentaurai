import test from 'node:test';
import assert from 'node:assert/strict';

import { renderAppPage } from '../src/app-page-settings.js';

test('canonical settings renderer owns the approved external analysis workflow', () => {
  const html = renderAppPage();

  assert.match(html, /canonicalAnalysisWorkflow/);
  assert.match(html, /Analysera omgång/);
  assert.match(html, /analysisRound/);
  assert.match(html, /analysisProvider/);
  assert.match(html, /Marknadsblind analys/);
  assert.match(html, /Hämta analysdata/);
  assert.match(html, /Hämta marknadsdata/);
  assert.match(html, /Registrera system/);
  assert.match(html, /registrationRound/);
  assert.match(html, /Registrera färdigt system/);
  assert.match(html, /Hämta importunderlag/);
  assert.match(html, /Kopiera importinstruktion/);
  assert.match(html, /Importera system/);

  assert.match(html, /\/app\/api\/settings\/f3-analysis-pack\?round_id=/);
  assert.match(html, /\/app\/api\/settings\/external-market\?round_id=/);
  assert.match(html, /\/app\/api\/settings\/external-step1-prompt\?provider=/);
  assert.match(html, /\/app\/api\/settings\/external-step2-prompt\?provider=/);
  assert.match(html, /\/app\/api\/settings\/system-import-context\?round_id=/);
  assert.match(html, /\/app\/api\/settings\/system-import-prompt\?provider=/);
  assert.match(html, /\/app\/api\/settings\/system-import\?round_id=/);

  assert.doesNotMatch(html, /Exportera marknadsblind data/);
  assert.doesNotMatch(html, /Skapa importfil till KentaurAI/);
  assert.doesNotMatch(html, /kentaurai-analysis-v2/);
  assert.doesNotMatch(html, /\/app\/api\/settings\/export\?/);
  assert.doesNotMatch(html, /\/app\/api\/settings\/analysis-method-prompt/);
  assert.doesNotMatch(html, /\/app\/api\/settings\/analysis-prompt/);
  assert.doesNotMatch(html, /\/app\/api\/settings\/import-analysis/);
});
