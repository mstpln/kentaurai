import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  RACE_PRIOR_CONTRACT_VERSION,
  RACE_PRIOR_FEATURE_VERSION,
  buildRacePriorsV1ForEntries
} from '../src/race-priors-v1.js';

function seedTrack(db, id) {
  db.prepare('INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, `Track ${id}`);
}
function seedHorse(db, id) {
  db.prepare('INSERT OR IGNORE INTO horses (id, canonical_name) VALUES (?, ?)').run(id, `Horse ${id}`);
}
function seedSource(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, 'official_provider', ?, ?, 'normalized_verified_subset')`).run(id, id, fetchedAt);
}

function seedRace(db, {
  id, date, scheduledAt = `${date}T12:00:00Z`, trackId = 'track-a', method = 'auto', distance = 2140,
  name = 'Stolopp', mainClass = null, fieldSize = null
}) {
  seedTrack(db, trackId);
  db.prepare(`INSERT INTO races
    (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, field_size,
     race_name, main_class, class_flags_json, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'official', 'normalized_verified_subset')`)
    .run(id, trackId, date, Number(id.replace(/\D/g, '').slice(-3)) || 1, scheduledAt, distance, method, fieldSize, name, mainClass);
}

function seedEntry(db, {
  id, raceId, horseId, lane = null, tier = null, handicap = 0, actualDistance = 2140, scratched = 0,
  placing = null, gallop = null, sourceId = null, observedAt = null
}) {
  seedHorse(db, horseId);
  db.prepare(`INSERT INTO race_entries
    (id, race_id, horse_id, start_number, actual_lane, start_tier, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synthetic')`)
    .run(id, raceId, horseId, Number(id.replace(/\D/g, '').slice(-2)) || 1, lane, tier, handicap, actualDistance, scratched);
  if (sourceId) {
    seedSource(db, sourceId, observedAt);
    db.prepare(`INSERT INTO race_results
      (race_entry_id, placing, gallop, disqualified, official_odds, result_status, source_record_id)
      VALUES (?, ?, ?, 0, 2.5, 'official', ?)`)
      .run(id, placing, gallop == null ? null : Number(gallop), sourceId);
  }
}

function seedProposition(db, { raceId, key, observedAt, facts = { sex_restriction: 'mares_only' } }) {
  const sourceId = `prop-source-${key}`;
  const obsId = `prop-obs-${key}`;
  seedSource(db, sourceId, observedAt);
  db.prepare(`INSERT INTO normalized_observations
    (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES (?, 'race', ?, ?, ?, '{}', 'normalized_verified_subset')`).run(obsId, raceId, sourceId, observedAt);
  db.prepare(`INSERT INTO race_proposition_facts
    (id, race_id, source_observation_id, source_record_id, observed_at, parser_version, parse_status,
     raw_terms_json, facts_json, matched_patterns_json, unparsed_fragments_json, ambiguous_fragments_json)
    VALUES (?, ?, ?, ?, ?, 'kentaurai-race-proposition-v1', 'parsed', '[]', ?, '[]', '[]', '[]')`)
    .run(`prop-${key}`, raceId, obsId, sourceId, observedAt, JSON.stringify(facts));
}

function seedHistoricalRace(db, index, {
  trackId = 'track-a', distance = 2140, method = 'auto', fieldCount = 3,
  winnerLane = 1, gallopLane = null, raceName = 'Stolopp', proposition = true,
  resultObservedAt = null
} = {}) {
  const day = String(index).padStart(2, '0');
  const date = `2026-08-${day}`;
  const raceId = `hist-${index}`;
  seedRace(db, { id: raceId, date, trackId, method, distance, name: raceName, fieldSize: fieldCount });
  for (let lane = 1; lane <= fieldCount; lane += 1) {
    seedEntry(db, {
      id: `hist-${index}-e${lane}`,
      raceId,
      horseId: `hist-${index}-h${lane}`,
      lane,
      tier: method === 'volt' ? 1 : null,
      handicap: 0,
      actualDistance: distance,
      placing: lane === winnerLane ? 1 : lane === ((winnerLane % fieldCount) + 1) ? 2 : 4,
      gallop: gallopLane === lane,
      sourceId: `result-${index}-${lane}`,
      observedAt: resultObservedAt || `${date}T14:00:00Z`
    });
  }
  if (proposition) seedProposition(db, { raceId, key: `hist-${index}`, observedAt: `${date}T10:00:00Z` });
  return raceId;
}

function seedTarget(db, { lane = 1, tier = null, handicap = 0, raceName = 'Stolopp', proposition = true } = {}) {
  const raceId = 'target-race';
  seedRace(db, { id: raceId, date: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', trackId: 'track-a', method: 'auto', distance: 2140, name: raceName, fieldSize: 3 });
  seedEntry(db, { id: 'target-entry', raceId, horseId: 'target-horse', lane, tier, handicap, actualDistance: 2140 });
  seedEntry(db, { id: 'target-other-1', raceId, horseId: 'target-other-h1', lane: 2, actualDistance: 2140 });
  seedEntry(db, { id: 'target-other-2', raceId, horseId: 'target-other-h2', lane: 3, actualDistance: 2140 });
  if (proposition) seedProposition(db, { raceId, key: 'target', observedAt: '2026-09-19T10:00:00Z' });
  return { raceId, entryId: 'target-entry' };
}

function seedScenario(db) {
  const target = seedTarget(db);
  seedHistoricalRace(db, 1, { trackId: 'track-a', winnerLane: 1, gallopLane: 3 });
  seedHistoricalRace(db, 2, { trackId: 'track-a', winnerLane: 2 });
  for (let index = 3; index <= 10; index += 1) {
    seedHistoricalRace(db, index, { trackId: 'track-b', winnerLane: index % 3 + 1, gallopLane: index % 4 === 0 ? 2 : null });
  }
  return target;
}

function allPriorObjects(pack) {
  return [
    ...Object.values(pack.priors.race_outcome),
    pack.priors.race_context.win_rate,
    pack.priors.race_context.top3_rate,
    pack.priors.race_context.gallop_rate,
    pack.priors.starting_position.lane.win_rate,
    pack.priors.starting_position.lane.top3_rate,
    pack.priors.starting_position.lane.gallop_rate,
    pack.priors.starting_position.tier.win_rate,
    pack.priors.starting_position.tier.top3_rate,
    pack.priors.starting_position.tier.gallop_rate,
    pack.priors.starting_position.handicap.win_rate,
    pack.priors.starting_position.handicap.top3_rate,
    pack.priors.starting_position.handicap.gallop_rate,
    pack.priors.shape.winner_lane_hhi,
    pack.priors.shape.winner_lane_normalized_entropy
  ];
}

test('B6 full seven-level hierarchy stays below the production D1 compound-select ceiling', async () => {
  const { db, env } = createTestEnv();
  const target = seedScenario(db);
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);

  assert.equal(pack.priors.race_outcome.win_rate.direct_level, 'track_method_distance_field');
  assert.equal(pack.priors.race_outcome.win_rate.backoff_level, 'method_distance_field');
  assert.ok(pack.priors.race_outcome.win_rate.sample_size > 0);
  assert.ok(pack.priors.shape.winner_lane_hhi.sample_size > 0);
});

test('B6 builds deterministic as-of race, lane and shape priors with explicit evidence metadata', async () => {
  const { db, env } = createTestEnv();
  const target = seedScenario(db);
  const first = await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const second = await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  assert.deepEqual(first, second);
  const pack = first.get(target.entryId);
  assert.equal(pack.contractVersion, RACE_PRIOR_CONTRACT_VERSION);
  assert.equal(pack.featureVersion, RACE_PRIOR_FEATURE_VERSION);
  assert.equal(pack.target.distanceBucket, 'middle');
  assert.equal(pack.target.fieldBucket, 'small');
  assert.equal(pack.priors.race_outcome.win_rate.direct_effective_sample_size, 2);
  assert.equal(pack.priors.race_outcome.win_rate.evidence_source, 'direct_plus_model_estimate');
  assert.equal(pack.priors.race_outcome.win_rate.backoff_level, 'method_distance_field');
  assert.ok(pack.priors.race_outcome.win_rate.confidence > 0);
  assert.equal(pack.priors.race_context.status, 'available');
  assert.equal(pack.priors.race_context.win_rate.direct_level, 'race_type_proposition');
  assert.ok(pack.priors.race_context.proposition_signature);
  assert.equal(pack.priors.starting_position.lane.value, 1);
  assert.ok(pack.priors.starting_position.lane.win_rate.sample_size > 0);
  assert.ok(pack.priors.shape.winner_lane_hhi.value > 0);
  assert.ok(pack.priors.shape.winner_lane_normalized_entropy.value >= 0);
  for (const prior of allPriorObjects(pack)) {
    assert.ok('sample_size' in prior);
    assert.ok('effective_sample_size' in prior);
    assert.ok('backoff_level' in prior);
    assert.ok('confidence' in prior);
  }
  assert.equal(pack.provenance.contract_version, 'kentaurai-feature-provenance-v1');
});

test('B6 is market blind and ignores race_positions', async () => {
  const { db, env } = createTestEnv();
  const target = seedScenario(db);
  const before = await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('market-round','V85','2026-09-20','scheduled')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('market-round',1,?)`).run(target.raceId);
  db.prepare(`INSERT INTO betting_snapshots
    (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank)
    VALUES ('market-bet','market-round',1,?,'2026-09-20T12:00:00Z',99.9,1)`).run(target.entryId);
  db.prepare(`INSERT INTO odds_snapshots
    (id, race_entry_id, captured_at, market_type, odds)
    VALUES ('market-odds',?,'2026-09-20T12:00:00Z','winner',1.01)`).run(target.entryId);
  db.prepare(`INSERT INTO race_positions
    (id, race_entry_id, observed_at_m, position, lane, leader, source_record_id)
    VALUES ('position-x',?,500,1,1,1,NULL)`).run('hist-1-e1');
  const after = await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  assert.deepEqual(after, before);
});

test('B6 excludes historical results whose source was not observed by the cutoff', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db);
  seedHistoricalRace(db, 1, { trackId: 'track-a', winnerLane: 1 });
  seedHistoricalRace(db, 2, { trackId: 'track-a', winnerLane: 1, resultObservedAt: '2026-09-21T10:00:00Z' });
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(pack.priors.race_outcome.win_rate.direct_effective_sample_size, 1);
  assert.equal(pack.priors.race_outcome.win_rate.direct_sample_size, 3);
});

test('B6 preserves unknown position context instead of treating it as lane or tier zero', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db, { lane: null, tier: null, handicap: 0 });
  for (let index = 1; index <= 8; index += 1) seedHistoricalRace(db, index, { trackId: 'track-a' });
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(pack.priors.starting_position.lane.status, 'unavailable');
  assert.equal(pack.priors.starting_position.lane.value, null);
  assert.equal(pack.priors.starting_position.lane.win_rate.value, null);
  assert.equal(pack.priors.starting_position.tier.status, 'unavailable');
  assert.equal(pack.priors.starting_position.tier.top3_rate.value, null);
  assert.equal(pack.priors.starting_position.handicap.value, 0, 'verified zero handicap remains a known fact');
});

test('B6 rare-track direct evidence backs off as ESS grows in broader population', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db);
  seedHistoricalRace(db, 1, { trackId: 'track-a', winnerLane: 1 });
  for (let index = 2; index <= 9; index += 1) seedHistoricalRace(db, index, { trackId: 'track-b', winnerLane: 2 });
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  const prior = pack.priors.race_outcome.win_rate;
  assert.equal(prior.direct_effective_sample_size, 1);
  assert.equal(prior.backoff_level, 'method_distance_field');
  assert.ok(prior.backoff_effective_sample_size >= 8);
  assert.equal(prior.evidence_source, 'direct_plus_model_estimate');
});

test('B6 buckets race distance rather than a handicapped entry start distance', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db);
  db.prepare('UPDATE race_entries SET actual_start_distance_m = 1740 WHERE race_id = ?').run(target.raceId);
  const historicalRaceId = seedHistoricalRace(db, 1, { distance: 2140, trackId: 'track-a' });
  db.prepare('UPDATE race_entries SET actual_start_distance_m = 1740 WHERE race_id = ?').run(historicalRaceId);
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(pack.target.distanceBucket, 'middle');
  assert.equal(pack.priors.race_outcome.win_rate.direct_effective_sample_size, 1);
  assert.equal(pack.priors.race_outcome.win_rate.direct_sample_size, 3);
});

test('B6 labels a race-type-only refinement truthfully', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db, { proposition: false, raceName: 'Stolopp' });
  seedHistoricalRace(db, 1, { proposition: false, raceName: 'Stolopp' });
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(pack.priors.race_context.status, 'available');
  assert.equal(pack.priors.race_context.proposition_signature, null);
  assert.equal(pack.priors.race_context.win_rate.direct_level, 'race_type');
  assert.equal(pack.priors.race_context.win_rate.direct_effective_sample_size, 1);
});

test('B6 marks a known but unseen race refinement sparse while broader backoff remains usable', async () => {
  const { db, env } = createTestEnv();
  const target = seedTarget(db, { proposition: false, raceName: 'Stolopp' });
  for (let index = 1; index <= 8; index += 1) {
    seedHistoricalRace(db, index, { proposition: false, raceName: 'Final' });
  }
  const pack = (await buildRacePriorsV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(pack.priors.race_context.status, 'sparse');
  assert.equal(pack.priors.race_context.win_rate.direct_level, 'race_type');
  assert.equal(pack.priors.race_context.win_rate.direct_sample_size, 0);
  assert.equal(pack.priors.race_context.win_rate.backoff_level, 'track_method_distance_field');
  assert.notEqual(pack.priors.race_context.win_rate.value, null);
});
