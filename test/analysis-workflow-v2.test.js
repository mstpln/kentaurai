import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_STEP_1_PROMPT } from '../src/analysis-step-1-prompt.js';
import { ANALYSIS_STEP_2_PROMPT } from '../src/analysis-step-2-prompt.js';
import { buildCombinedAnalysisImportPrompt } from '../src/analysis-import-prompt-v2.js';
import {
  ANALYSIS_COMBINED_VERSION,
  ANALYSIS_INPUT_VERSION,
  getAnalysisMethodPrompt,
  stableWorkflowFingerprintInput
} from '../src/analysis-workflow-v2.js';

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

test('v2 workflow exposes the canonical final A1 and A2 prompts unchanged', () => {
  assert.equal(getAnalysisMethodPrompt(1), ANALYSIS_STEP_1_PROMPT);
  assert.equal(getAnalysisMethodPrompt(2), ANALYSIS_STEP_2_PROMPT);
  assert.match(ANALYSIS_STEP_1_PROMPT, /Importfilen till KentaurAI skapas först när både analysen och systemet är färdiga — inte nu\./);
  assert.match(ANALYSIS_STEP_2_PROMPT, /Huvudsystem, 700 kr/);
  assert.match(ANALYSIS_STEP_2_PROMPT, /Två spikar är tillåtet/);
  assert.match(ANALYSIS_STEP_2_PROMPT, /Skriv dessutom in motiveringen i systemets \*\*`notes`\*\*/);
  assert.match(ANALYSIS_STEP_2_PROMPT, /max 144 kr/);
});

test('combined export prompt encodes the locked one-import workflow and contextual spike rules', () => {
  const prompt = buildCombinedAnalysisImportPrompt('anthropic', promptContext);
  assert.equal(ANALYSIS_INPUT_VERSION, 'kentaurai-analysis-input-v2');
  assert.equal(ANALYSIS_COMBINED_VERSION, 'kentaurai-analysis-v2');
  assert.match(prompt, /stage måste vara exakt "combined"/);
  assert.match(prompt, /parent_submission_id får INTE finnas/);
  assert.match(prompt, /analysis_blindness får INTE finnas/);
  assert.match(prompt, /V85 \+ system_type "main": 2 eller 3 singleton-spikar är tillåtet/);
  assert.match(prompt, /Om V85 main har 2 spikar måste systemets notes vara icke-tomt/);
  assert.match(prompt, /Alla andra V85\/V86-system måste ha exakt 3 singleton-spikar/);
  assert.match(prompt, /Regeln baseras aldrig på budgetbeloppet/);
  assert.match(prompt, /INTE strategiskt kontrollera, ändra eller reparera spikantalet/);
  assert.match(prompt, /steg 1 exakt/i);
  assert.match(prompt, /normalisera kvarvarande steg-1-sannolikheter proportionellt/);
  assert.match(prompt, /komprimera raw_rank till obruten 1\.\.N/);
  assert.match(prompt, /round-synthetic-v85/);
  assert.match(prompt, new RegExp(`sha256:${'a'.repeat(64)}`));
});

test('combined context fingerprint input ignores time-only market metadata but keeps authoritative market observations', () => {
  const base = {
    contractVersion: ANALYSIS_INPUT_VERSION,
    round: { id: 'round-synthetic-v85', gameType: 'V85', betStopAt: '2026-09-12T15:00:00Z' },
    legs: [{ legNumber: 1, raceId: 'race-1', entries: [{ raceEntryId: 'entry-1' }] }],
    market: {
      definitionVersion: 'verified-market-at-stop-v1',
      roundId: 'round-synthetic-v85',
      betStopAt: '2026-09-12T15:00:00Z',
      asOf: '2026-09-12T12:00:00Z',
      cutoff: '2026-09-12T12:00:00Z',
      betting: [{ raceEntryId: 'entry-1', betPercent: 42, capturedAt: '2026-09-12T11:59:00Z' }],
      odds: []
    }
  };
  const later = structuredClone(base);
  later.market.asOf = '2026-09-12T12:05:00Z';
  later.market.cutoff = '2026-09-12T12:05:00Z';

  assert.deepEqual(stableWorkflowFingerprintInput(later), stableWorkflowFingerprintInput(base));
  assert.equal(stableWorkflowFingerprintInput(base).market.asOf, undefined);
  assert.equal(stableWorkflowFingerprintInput(base).market.cutoff, undefined);
  assert.equal(stableWorkflowFingerprintInput(base).market.betting[0].betPercent, 42);

  const changedMarket = structuredClone(base);
  changedMarket.market.betting[0].betPercent = 43;
  assert.notDeepEqual(stableWorkflowFingerprintInput(changedMarket), stableWorkflowFingerprintInput(base));
});
