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
  assert.match(files.readme, /Production release #64 (?:is current|is the currently deployed baseline)/i);
  assert.match(files.readme, /production entrypoint is `src\/worker-v078\.js`/i);
  assert.match(files.buildState, /Production schema is current through migration `0028_external_evidence_v1\.sql`/i);
  assert.match(files.buildState, /External analysis workflow production live/i);
  assert.match(files.buildState, /External evidence workflow production live/i);
  assert.match(files.buildState, /latest production release completed successfully/i);
  assert.match(files.contract, /Status: active production contract after F4 cutover/i);
});

test('data inventory and dictionary distinguish historical source inventory from live post-F4 analytical status', () => {
  const inventory = read('docs/DATA_INVENTORY.md');
  const dictionary = read('docs/DATA_DICTIONARY.md');
  assert.match(inventory, /Post-F4 implementation overlay/);
  assert.match(inventory, /X-Labs 100 m interval features/);
  assert.match(inventory, /conservative C4 named trip labels around 500 m remaining/);
  assert.match(dictionary, /Post-F4 analytical truth is:/);
  assert.match(dictionary, /C1-C3 are active and partial-coverage safe/);
  assert.match(dictionary, /C4 named trip labels are available as conservative calculated X-Labs evidence around 500 m remaining/);
});
