import test from 'node:test';
import assert from 'node:assert/strict';
import { xlabsTelemetrySourceGap } from '../src/import/xlabs-source-gap.js';

test('X-Labs no verified frame coverage is treated as a neutral source gap', () => {
  assert.deepEqual(
    xlabsTelemetrySourceGap(new Error('captured X-Labs telemetry had no official entries with verified frame coverage')),
    { code: 'no_verified_frame_coverage' }
  );
});

test('unrelated X-Labs normalization failures remain technical errors', () => {
  assert.equal(
    xlabsTelemetrySourceGap(new Error('captured X-Labs and official track ids are not the verified observed identity')),
    null
  );
});
