import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ANALYSIS_V3_CONTRACTS,
  ANALYSIS_V3_LEGACY_BOUNDARY,
  ANALYSIS_V3_TARGET_POLICY,
  analysisV3ContractSnapshot
} from '../src/analysis-v3-contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturePath = resolve(repoRoot, 'fixtures/analysis-v3-contract.example.json');

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

test('v3 target contract identifiers are explicit and stable', () => {
  assert.deepEqual(ANALYSIS_V3_CONTRACTS, {
    analysisPack: 'kentaurai-analysis-pack-v3',
    step1Lock: 'kentaurai-step1-lock-v1',
    marketPack: 'kentaurai-market-pack-v3',
    step2Result: 'kentaurai-step2-result-v1',
    optimizer: 'kentaurai-optimizer-v1',
    systemPolicy: 'kentaurai-system-policy-v1',
    analysisPersistence: 'kentaurai-analysis-v3'
  });
});

test('v3 target policy is exact-three-spikes while legacy two-spike reads remain compatible', () => {
  assert.equal(ANALYSIS_V3_TARGET_POLICY.status, 'target_not_active');
  assert.equal(ANALYSIS_V3_TARGET_POLICY.exactSpikeCount, 3);
  assert.deepEqual(ANALYSIS_V3_TARGET_POLICY.defaultMainBudgetSek, { min: 150, max: 250 });
  assert.equal(ANALYSIS_V3_TARGET_POLICY.alternativesRequired, false);
  assert.equal(ANALYSIS_V3_TARGET_POLICY.optimizerProbabilityField, 'decision_probability');
  assert.equal(ANALYSIS_V3_TARGET_POLICY.missingOptionalEvidenceIsNeutral, true);

  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.status, 'legacy_until_v3_cutover');
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.currentInputContract, 'kentaurai-analysis-input-v2');
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.currentSubmissionContract, 'kentaurai-analysis-v2');
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.existingTwoSpikeV85MainReadable, true);
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.v3WritersMayCreateTwoSpikeSystems, false);
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.rewriteHistoricalSystems, false);
});

test('synthetic fixture mirrors the target contract vocabulary without private data', () => {
  const value = fixture();
  assert.deepEqual(value.contracts, {
    analysis_pack: ANALYSIS_V3_CONTRACTS.analysisPack,
    step1_lock: ANALYSIS_V3_CONTRACTS.step1Lock,
    market_pack: ANALYSIS_V3_CONTRACTS.marketPack,
    step2_result: ANALYSIS_V3_CONTRACTS.step2Result,
    optimizer: ANALYSIS_V3_CONTRACTS.optimizer,
    system_policy: ANALYSIS_V3_CONTRACTS.systemPolicy,
    analysis_persistence: ANALYSIS_V3_CONTRACTS.analysisPersistence
  });
  assert.equal(value.target_policy.exact_spike_count, 3);
  assert.equal(value.target_policy.missing_optional_evidence_is_neutral, true);
  assert.equal(value.legacy_boundary.existing_two_spike_v85_main_readable, true);
  assert.equal(value.legacy_boundary.v3_writer_may_create_two_spike_system, false);
  assert.match(value.synthetic_example.round_id, /synthetic/);
  assert.equal(value.synthetic_example.contains_current_market, false);

  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ['raw_object_key', 'source_url', 'bearer ', 'admin_token', 'app_password', 'https://', 'http://']) {
    assert.equal(serialized.includes(forbidden), false, `synthetic fixture must not contain ${forbidden}`);
  }
});

test('contract snapshot returns mutable copies without mutating canonical constants', () => {
  const snapshot = analysisV3ContractSnapshot();
  snapshot.targetPolicy.supportedGameTypes.push('OTHER');
  snapshot.targetPolicy.defaultMainBudgetSek.min = 1;
  assert.deepEqual(ANALYSIS_V3_TARGET_POLICY.supportedGameTypes, ['V85', 'V86']);
  assert.deepEqual(ANALYSIS_V3_TARGET_POLICY.defaultMainBudgetSek, { min: 150, max: 250 });
});

test('tracked repository filenames reject private strategy, build-plan, coverage and real reference artifacts', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const forbiddenPatterns = [
    /KentaurAI_Analys_och_Datastrategi.*\.pdf$/i,
    /KentaurAI_Implementation_Master_Plan.*\.pdf$/i,
    /KentaurAI_Detaljerad_Byggplan_Statistik_Analys_Data.*\.pdf$/i,
    /V85_V86_Trav_Intelligence_Full_Build_Plan.*\.pdf$/i,
    /kentaurai-data-coverage.*\.json$/i,
    /kentaurai_V8[56]_.*\.json$/i,
    /_V8[56]_.*_reference\.json$/i,
    /\.private\.json$/i,
    /\.dump$/i,
    /\.sqlite3?$/i
  ];
  const violations = tracked.filter((path) => forbiddenPatterns.some((pattern) => pattern.test(path)));
  assert.deepEqual(violations, []);
});
