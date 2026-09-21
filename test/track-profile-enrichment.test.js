import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTrackProfileEnrichment, listTrackProfileTargets } from '../src/track-profile-enrichment.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrack(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, city, country_code) VALUES ('track-x','Synthetic Geometry Track','Teststad','SE')").run();
}
function payload(overrides = {}) {
  return { tracks:[{
    track_id:'track-x',
    canonical_name:'Synthetic Geometry Track',
    verified_at:'2026-09-20T12:00:00Z',
    layout_effective_from:'2026-01-01',
    facts:[{ type:'width_1640_m', value:21.2, evidence_type:'verified', source:{ type:'measurement', url:'https://example.test/geometry' } }],
    first_turn_distances:[{
      race_distance_m:1640, start_method:'auto', distance_to_first_turn_m:178.5,
      evidence_type:'calculated', source:{ type:'calculation', url:'https://example.test/first-turn' },
      calculation_note:'Synthetic calculation from verified geometry and start position'
    }],
    ...overrides
  }]};
}
test('track profile enrichment lists targets and imports idempotently', async () => {
  const { env, db } = createTestEnv(); seedTrack(db);
  const targets = await listTrackProfileTargets(env);
  assert.equal(targets.total, 1);
  assert.equal(targets.items[0].name, 'Synthetic Geometry Track');
  const first = await applyTrackProfileEnrichment(env, payload());
  assert.equal(first.profileFacts, 1); assert.equal(first.firstTurnDistances, 1); assert.equal(first.conflicts, 0);
  const second = await applyTrackProfileEnrichment(env, payload());
  assert.equal(second.conflicts, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_profile_fact_observations").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_first_turn_distances").get().n, 1);
});
test('calculated values require a calculation note', async () => {
  const { env, db } = createTestEnv(); seedTrack(db);
  const bad = payload({ facts:[], first_turn_distances:[{
    race_distance_m:2140, start_method:'auto', distance_to_first_turn_m:182, evidence_type:'calculated',
    source:{ type:'calculation', url:'https://example.test/calculated' }
  }]});
  await assert.rejects(() => applyTrackProfileEnrichment(env, bad), /calculation_note is required/);
});
test('conflicting same-layout facts are preserved instead of overwritten', async () => {
  const { env, db } = createTestEnv(); seedTrack(db);
  await applyTrackProfileEnrichment(env, payload());
  const conflict = payload({ facts:[{
    type:'width_1640_m', value:22.4, evidence_type:'verified',
    source:{ type:'official_sport', url:'https://example.test/conflicting-geometry' }
  }], first_turn_distances:[] });
  const result = await applyTrackProfileEnrichment(env, conflict);
  assert.equal(result.conflicts, 1);
  assert.deepEqual(db.prepare("SELECT numeric_value, status FROM track_profile_fact_observations ORDER BY numeric_value").all(), [
    { numeric_value:21.2, status:'active' }, { numeric_value:22.4, status:'conflict' }
  ]);
});
