import test from 'node:test';
import assert from 'node:assert/strict';

import { importVerifiedFinalAnalysis } from '../src/analysis-final-import.js';
import { createTestEnv } from './helpers/d1.js';

function baseInput() {
  const legs = Array.from({ length: 8 }, (_, index) => {
    const legNumber = index + 1;
    return {
      legNumber,
      raceId: `race_${legNumber}`,
      scenarios: null,
      raceShapeSummary: null,
      conclusion: null,
      dataQuality: 'sufficient',
      predictions: [
        { raceEntryId: `entry_${legNumber}_1`, winProbability: 0.6, rawRank: 1, abcdGroup: 'A' },
        { raceEntryId: `entry_${legNumber}_2`, winProbability: 0.4, rawRank: 2, abcdGroup: 'B' }
      ]
    };
  });
  return {
    roundId: 'round-final-import',
    submissionId: 'final-1',
    parentSubmissionId: 'pre-1',
    provider: 'openai',
    model: 'synthetic-model',
    analysisVersion: 'synthetic-v1',
    contextFingerprint: `sha256:${'a'.repeat(64)}`,
    dataSnapshotAt: '2099-05-01T12:00:00.000Z',
    roundSummary: 'Synthetic final summary',
    recommendations: null,
    legs,
    systems: [],
    market: {
      definitionVersion: 'verified-market-at-stop-v1',
      roundId: 'round-final-import',
      cutoff: '2099-05-01T12:00:00.000Z',
      betting: []
    }
  };
}

test('verified final importer preserves legacy text bounds before any write', async () => {
  const { env } = createTestEnv();
  await assert.rejects(
    importVerifiedFinalAnalysis(env, { ...baseInput(), roundSummary: 'x'.repeat(12001) }),
    /round_summary must be at most 12000 characters/
  );
  await assert.rejects(
    importVerifiedFinalAnalysis(env, { ...baseInput(), analysisVersion: 'x'.repeat(201) }),
    /analysis_version must be at most 200 characters/
  );
});

test('verified final importer treats every singleton leg as a spike', async () => {
  const { env } = createTestEnv();
  const input = baseInput();
  const selections = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    if (leg <= 4) {
      selections.push({ leg_number: leg, race_entry_id: `entry_${leg}_1`, is_spike: leg <= 3 });
    } else {
      selections.push({ leg_number: leg, race_entry_id: `entry_${leg}_1`, is_spike: false });
      selections.push({ leg_number: leg, race_entry_id: `entry_${leg}_2`, is_spike: false });
    }
  }
  input.systems = [{
    system_id: 'invalid-four-singletons',
    system_type: 'main',
    budget_sek: 8,
    line_price_sek: 0.5,
    selections
  }];
  await assert.rejects(
    importVerifiedFinalAnalysis(env, input),
    /every one-horse leg is a spike/
  );
});
