import test from 'node:test';
import assert from 'node:assert/strict';
import { toEntityAppView } from '../src/routes/entity-view.js';

test('entity app view keeps measured fields but removes internal provenance and analysis ids', () => {
  const view = toEntityAppView({
    type: 'trainer',
    entity: { id: 'trainer_1', name: 'Synthetic Trainer' },
    latestObservation: {
      observedAt: '2099-01-01T00:00:00Z',
      qualityStatus: 'verified',
      fields: {
        externalId: 'internal_external_id',
        priorCanonicalName: 'Old Name',
        nameConflict: true,
        homeTrackExternalId: 'track_internal',
        location: 'Synthetic City',
        license: 'A'
      }
    },
    stats: {},
    breakdowns: {},
    coverage: {},
    starts: [{
      entry_id: 'entry_internal',
      race_id: 'race_internal',
      horse_id: 'horse_1',
      horse_name: 'Synthetic Horse',
      class_flags_json: '{"x":1}',
      day_profile_json: '{"x":1}',
      features: [{ name: 'f', numericValue: 1, provenance: { sourceRecordId: 'private_internal' } }],
      featureHistory: [{ name: 'f', numericValue: 1, provenance: { sourceRecordId: 'private_internal' } }],
      aiAnalyses: [{
        analysisId: 'analysis_internal',
        modelVersionId: 'model_internal',
        aiProvider: 'provider_internal',
        aiModel: 'synthetic-model',
        winProbability: 0.2
      }]
    }]
  });

  assert.deepEqual(view.latestObservation.fields, { location: 'Synthetic City', license: 'A' });
  assert.equal('entry_id' in view.starts[0], false);
  assert.equal('race_id' in view.starts[0], false);
  assert.equal(view.starts[0].horse_id, 'horse_1');
  assert.equal('provenance' in view.starts[0].features[0], false);
  assert.equal('provenance' in view.starts[0].featureHistory[0], false);
  assert.equal('analysisId' in view.starts[0].aiAnalyses[0], false);
  assert.equal('modelVersionId' in view.starts[0].aiAnalyses[0], false);
  assert.equal('aiProvider' in view.starts[0].aiAnalyses[0], false);
  assert.equal(view.starts[0].aiAnalyses[0].aiModel, 'synthetic-model');
});
