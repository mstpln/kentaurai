import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getExternalAnalysisStep1Prompt, getExternalAnalysisStep2Prompt } from '../src/external-analysis-flow-v1.js';
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

test('repository default keeps F4 v3 mode behind the worker-v077 performance layer', () => {
  assert.match(wrangler, /"main": "\.\/src\/worker-v077\.js"/);
  assert.match(wrangler, /"ANALYSIS_WORKFLOW_MODE": "v3"/);
});

test('documentation agrees on the six-step external workflow, exact3 registration and legacy compatibility', () => {
  for (const [name, text] of Object.entries({ agents, decisions, buildState, readme })) {
    assert.match(text, /external|ChatGPT|Claude/i, name);
    assert.match(text, /Step 1|Steg 1/i, name);
    assert.match(text, /Step 2|Steg 2/i, name);
    assert.match(text, /Step 3|Steg 3/i, name);
    assert.match(text, /exactly three|exact-three|exakt tre|three singleton|tre.*spik/i, name);
  }
  assert.match(agents, /Step 1 is not imported or server-sealed/i);
  assert.match(decisions, /Step 6 is system registration/i);
  assert.match(decisions, /registered separately in Step 5/i);
  assert.match(buildState, /older sealed-v3.*compatibility|sealed-v3.*compatibility/i);
  assert.match(readme, /System registration is separate/i);
});

test('active external prompts keep Step 1 blind and Step 2 market-only', () => {
  const step1 = getExternalAnalysisStep1Prompt('openai');
  const step2 = getExternalAnalysisStep2Prompt('openai');
  assert.match(step1, /Sök inte på webben och använd inte aktuell streck-, odds- eller tippsinformation/i);
  assert.match(step1, /Bygg inget system/i);
  assert.match(step2, /Marknadsanalys/i);
  assert.match(step2, /Bygg inget system/i);
  assert.match(step2, /Välj inga spikar eller garderingar ännu/i);
  assert.doesNotMatch(step2, /SYSTEMREGLER|system_policy|exakt 3 spikar/i);
});

test('F4 runbook preserves controlled release source, rollback and no-backfill boundaries', () => {
  assert.match(runbook, /source_main.*application merge commit/i);
  assert.match(runbook, /ANALYSIS_WORKFLOW_MODE=legacy_v2/);
  assert.match(runbook, /no historical replay\/backfill reset or resume/i);
  assert.match(runbook, /Worker v077/i);
});
