import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getAnalysisStep1PromptV3 } from '../src/analysis-step1-prompt-v3.js';
import { getAnalysisStep2PromptV3 } from '../src/analysis-step2-prompt-v3.js';
import { canonicalOptimizerPolicyForGameType } from '../src/analysis-optimizer-policy-config.js';

const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const decisions = readFileSync(new URL('../docs/DECISIONS.md', import.meta.url), 'utf8');
const buildState = readFileSync(new URL('../docs/BUILD_STATE.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../docs/V3_CUTOVER_RUNBOOK.md', import.meta.url), 'utf8');

test('F4 authoritative game config supplies current V85/V86 line prices and fails closed when missing', () => {
  const env = { V85_LINE_PRICE_SEK: '0.50', V86_LINE_PRICE_SEK: '0.25' };
  assert.equal(canonicalOptimizerPolicyForGameType(env, 'V85').line_price_sek, 0.5);
  assert.equal(canonicalOptimizerPolicyForGameType(env, 'V86').line_price_sek, 0.25);
  assert.equal(canonicalOptimizerPolicyForGameType(env, 'V85').exact_spike_count, 3);
  assert.equal(canonicalOptimizerPolicyForGameType(env, 'V86').target_budget_min_sek, 150);
  assert.equal(canonicalOptimizerPolicyForGameType(env, 'V86').max_budget_sek, 250);
  assert.throws(() => canonicalOptimizerPolicyForGameType({}, 'V85'), /V85_LINE_PRICE_SEK is not configured/);
});

test('F4 repository default points at worker-v076 and explicit v3 workflow mode', () => {
  assert.match(wrangler, /"main": "\.\/src\/worker-v076\.js"/);
  assert.match(wrangler, /"ANALYSIS_WORKFLOW_MODE": "v3"/);
});

test('F4 live documentation agrees on sealed v3, exact3 and legacy read-only policy', () => {
  for (const [name, text] of Object.entries({ agents, decisions, buildState, readme })) {
    assert.match(text, /v3/i, name);
    assert.match(text, /sealed|försegl/i, name);
    assert.match(text, /exactly three|exact-three|exact-three-spike|exakt tre|three spike/i, name);
  }
  assert.match(agents, /Legacy v1\/v2 analysis artifacts remain readable/i);
  assert.match(decisions, /New legacy creation.*disabled/i);
  assert.match(buildState, /legacy v1\/v2 analysis creation.*disabled/i);
  assert.match(readme, /disables new legacy creation/i);
});

test('F4 active v3 prompts contain no legacy two-spike, 700 SEK or client-built-system policy', () => {
  const prompts = [getAnalysisStep1PromptV3('openai'), getAnalysisStep2PromptV3('openai')].join('\n');
  assert.doesNotMatch(prompts, /700\s*(?:SEK|kr)/i);
  assert.doesNotMatch(prompts, /two[- ]spike|two spikes|två spikar|2[- ]spike/i);
  assert.doesNotMatch(prompts, /build (?:the )?system|bygg systemet/i);
  assert.match(prompts, /code optimizer will build the authoritative system/i);
});

test('F4 runbook preserves controlled release source, rollback and no-backfill boundaries', () => {
  assert.match(runbook, /source_main.*application merge commit/i);
  assert.match(runbook, /ANALYSIS_WORKFLOW_MODE=legacy_v2/);
  assert.match(runbook, /no historical replay\/backfill reset or resume/i);
  assert.match(runbook, /Worker v076/i);
});
