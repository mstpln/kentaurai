import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ANALYSIS_PROVIDERS,
  analysisModelSlug,
  normalizeAnalysisModel,
  normalizeAnalysisProvider
} from '../src/analysis-provider.js';

test('Build E analysis providers are an explicit canonical allowlist', () => {
  assert.deepEqual(ALLOWED_ANALYSIS_PROVIDERS, ['openai', 'anthropic']);
  assert.equal(normalizeAnalysisProvider('openai'), 'openai');
  assert.equal(normalizeAnalysisProvider('ANTHROPIC'), 'anthropic');
  assert.throws(() => normalizeAnalysisProvider('chatgpt'), /explicitly allowed provider/);
  assert.throws(() => normalizeAnalysisProvider('claude'), /explicitly allowed provider/);
  assert.throws(() => normalizeAnalysisProvider('unknown-provider'), /explicitly allowed provider/);
});

test('producer model must be an actual non-control-character model name', () => {
  assert.equal(normalizeAnalysisModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(normalizeAnalysisModel('Claude Sonnet 4.5'), 'Claude Sonnet 4.5');
  assert.throws(() => normalizeAnalysisModel(''), /required/);
  assert.throws(() => normalizeAnalysisModel('bad\nmodel'), /control characters/);
});

test('provider-neutral output filenames can use a safe model slug without changing stored producer identity', () => {
  assert.equal(analysisModelSlug('GPT-5.6 Sol'), 'gpt-5-6-sol');
  assert.equal(analysisModelSlug('Claude Sonnet 4.5'), 'claude-sonnet-4-5');
});