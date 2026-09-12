import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_STEP_1_PROMPT } from '../src/analysis-step-1-prompt.js';
import { ANALYSIS_STEP_2_PROMPT } from '../src/analysis-step-2-prompt.js';
import { buildCombinedAnalysisImportPrompt } from '../src/analysis-import-prompt-v2.js';
import { ANALYSIS_COMBINED_VERSION, ANALYSIS_INPUT_VERSION, getAnalysisMethodPrompt } from '../src/analysis-workflow-v2.js';

const promptContext = {
  export_stage: 'combined',
  provider: 'anthropic',
  round_id: 'round-synthetic-v85',
  context_fingerprint: `sha256:${'a'.repeat(64)}`,
  context: {
    round: { id: 'round-synthetic-v85', gameType: 'V85' },
    legs: Array.from({ length: 8 }, (_, index) => ({ legNumber: index + 1, raceId: `race-${index + 1}`, entries: [] })),
    market: { cutoff: '2026-09-12T10:00:00.000Z' }
  }
};

test('v2 workflow exposes canonical A1 and A2 prompts without rewriting them', () => {
  assert.equal(getAnalysisMethodPrompt(1), ANALYSIS_STEP_1_PROMPT);
  assert.equal(getAnalysisMethodPrompt(2), ANALYSIS_STEP_2_PROMPT);
  assert.match(ANALYSIS_STEP_1_PROMPT, /Importfilen till KentaurAI skapas först när både analysen och systemet är färdiga — inte nu\./);
  assert.match(ANALYSIS_STEP_2_PROMPT, /### Huvudsystemsprincipen — balans/);
  assert.match(ANALYSIS_STEP_2_PROMPT, /Skriv dessutom in motiveringen i systemets \*\*`notes`\*\*/);
});

test('combined export prompt encodes the locked one-import workflow', () => {
  const prompt = buildCombinedAnalysisImportPrompt('anthropic', promptContext);
  assert.equal(ANALYSIS_INPUT_VERSION, 'kentaurai-analysis-input-v2');
  assert.equal(ANALYSIS_COMBINED_VERSION, 'kentaurai-analysis-v2');
  assert.match(prompt, /stage måste vara exakt "combined"/);
  assert.match(prompt, /parent_submission_id får INTE finnas/);
  assert.match(prompt, /analysis_blindness får INTE finnas/);
  assert.match(prompt, /V85 \+ system_type "main": 2 eller 3 spikar tillåtet/);
  assert.match(prompt, /V85 main med 2 spikar måste systemets notes innehålla/);
  assert.match(prompt, /steg 1 oförändrat/i);
  assert.match(prompt, /round-synthetic-v85/);
  assert.match(prompt, new RegExp(`sha256:${'a'.repeat(64)}`));
});
