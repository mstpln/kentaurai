import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANALYSIS_V3_LEGACY_BOUNDARY,
  ANALYSIS_V3_TARGET_POLICY
} from '../src/analysis-v3-contract.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('post-F4 contract registry reflects the live v3 default and read-only legacy boundary', () => {
  assert.equal(ANALYSIS_V3_TARGET_POLICY.status, 'active_default');
  assert.equal(ANALYSIS_V3_TARGET_POLICY.exactSpikeCount, 3);
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.status, 'read_only_after_v3_cutover');
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.newLegacyCreationEnabled, false);
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.rollbackMode, 'legacy_v2');
  assert.equal(ANALYSIS_V3_LEGACY_BOUNDARY.existingTwoSpikeV85MainReadable, true);
});

test('live-state documentation contains no pre-cutover candidate markers', () => {
  const files = {
    readme: read('README.md'),
    buildState: read('docs/BUILD_STATE.md'),
    contract: read('docs/analysis-v3-contract.md')
  };
  const serialized = Object.values(files).join('\n');
  assert.doesNotMatch(serialized, /F4 is the final v3 cutover candidate/i);
  assert.doesNotMatch(serialized, /current candidate build/i);
  assert.doesNotMatch(serialized, /target contract only; not active runtime behavior/i);
  assert.doesNotMatch(serialized, /legacy runtime behavior until the later v3 cutover build/i);
  assert.doesNotMatch(serialized, /worker-v075/i);
  assert.match(files.readme, /Production release #60 is current/i);
  assert.match(files.buildState, /F4 v3 cutover\/deprecation\/release hardening: complete and deployed/i);
  assert.match(files.contract, /Status: active production contract after F4 cutover/i);
});

test('data inventory and dictionary distinguish historical source inventory from live post-F4 analytical status', () => {
  const inventory = read('docs/DATA_INVENTORY.md');
  const dictionary = read('docs/DATA_DICTIONARY.md');
  assert.match(inventory, /Post-F4 implementation overlay/);
  assert.match(inventory, /X-Labs 100 m interval features/);
  assert.match(inventory, /Named trip labels remain gated\/null/);
  assert.match(dictionary, /Post-F4 analytical truth is:/);
  assert.match(dictionary, /C1-C3 are active and partial-coverage safe/);
  assert.match(dictionary, /named trip labels C4 remain gated\/null/);
});
