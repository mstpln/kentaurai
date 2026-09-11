import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisImportPrompt, recommendedAnalysisFilename } from '../src/analysis-import-prompt.js';

test('Build E recommended filename can include canonical provider, actual model and analysis stage', () => {
  assert.equal(
    recommendedAnalysisFilename('openai', 'GPT-5.6 Sol', 'pre_market'),
    'kentaurai-analysis_openai_gpt-5-6-sol_pre-market_ÅÅÅÅ-MM-DD.json'
  );
  assert.equal(
    recommendedAnalysisFilename('anthropic', 'Claude Sonnet 4.5', 'final'),
    'kentaurai-analysis_anthropic_claude-sonnet-4-5_final_ÅÅÅÅ-MM-DD.json'
  );
});

test('Build E import prompt requires actual model and provider-neutral staged filename', () => {
  const prompt = buildAnalysisImportPrompt('openai');
  assert.match(prompt, /ACTUAL-MODEL/);
  assert.match(prompt, /STAGE/);
  assert.match(prompt, /faktiska producer\.model/);
  assert.match(prompt, /producer\.provider måste vara exakt "openai"/);
});