import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  PERFORMANCE_FEATURE_CONTRACT_VERSION,
  PERFORMANCE_FEATURE_VERSIONS,
  buildPerformanceFeaturesV3ForEntries,
  getPerformanceFeatureVersionRegistry
} from '../src/performance-features-v3.js';

function seedTrack(db, id) {
  db.prepare('INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, `Track ${id}`);
}

function seedHorse(db, id) {
  db.prepare('INSERT OR IGNORE INTO horses (id, canonical_name) VALUES (?, ?)').run(id, `Horse ${id}`);
}

function seedDriver(db, id) {
  if (id) db.prepare('INSERT OR IGNORE INTO drivers (id, canonical_name) VALUES (?, ?)').run(id, `Driver ${id}`);
}

function seedSource(db, id, fetchedAt, sourceType = 'official_provider', qualityStatus = 'normalized_verified_subset') {
  db.prepare(`
    INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sourceType, id, fetchedAt, qualityStatus);
}

function seedRaceEntry(db, {
  key,
  horseId,
  raceDate,
  scheduledAt,
  trackId = 'track-a',
  distanceM = 2140,
  startMethod = 'auto',
  driverId = 'driver-a',
  startNumber = 1,
  firstPrizeSek = 100000,
  target = false,
  placing = 4,
  prizeSek = 0,
  kmTime = null,
  gallop = false,
  disqualified = false,
  resultObservedAt = null
}) {
  seedTrack(db, trackId);
  seedHorse(db, horseId);
  seedDriver(db, driverId);
  const raceId = `race-${key}`;
  const entryId = `entry-${key}`;
  db.prepare(`
    INSERT INTO races
      (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, first_prize_sek, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'normalized_verified_subset')
  `).run(raceId, trackId, raceDate, Number(String(key).replace(/\D/g, '').slice(-3)) || 1, scheduledAt, distanceM, startMethod, firstPrizeSek);
  db.prepare(`
    INSERT INTO race_entries
      (id, race_id, horse_id, driver_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 'synthetic')
  `).run(entryId, raceId, horseId, driverId, startNumber, startNumber, distanceM);
  if (!target) {
    const sourceId = `result-source-${key}`;
    seedSource(db, sourceId, resultObservedAt || scheduledAt);
    db.prepare(`
      INSERT INTO race_results
        (race_entry_id, placing, km_time, prize_sek, gallop, disqualified, result_status, source_record_id)
      VALUES (?, ?, ?, ?, ?, ?, 'official', ?)
    `).run(entryId, placing, kmTime, prizeSek, Number(gallop), Number(disqualified), sourceId);
  }
  return { raceId, entryId, horseId };
}

function seedXlabs(db, entryId, key, observedAt, { first200 = '1.12,0 min/km', last400 = '1.11,0 min/km' } = {}) {
  const sourceId = `xlabs-source-${key}`;
  seedSource(db, sourceId, observedAt, 'xlabs_race_json', 'normalized_verified_subset');
  db.prepare(`
    INSERT INTO xlabs_data
      (id, race_entry_id, first_200_time, last_400_time, quality_status, source_record_id)
    VALUES (?, ?, ?, ?, 'xlabs-telemetry-v1', ?)
  `).run(`xlabs-${key}`, entryId, first200, last400, sourceId);
}

function seedOfficialSnapshot(db, horseId, key, observedAt, {
  startPoints = null,
  lifeStarts = null,
  lifeWins = null,
  recordSeconds = null
} = {}) {
  const sourceId = `snapshot-source-${key}`;
  seedSource(db, sourceId, observedAt);
  db.prepare(`
    INSERT INTO official_snapshot_source_sync
      (source_record_id, status, horse_stat_count, horse_record_count)
    VALUES (?, 'complete', 1, ?)
  `).run(sourceId, recordSeconds == null ? 0 : 1);
  db.prepare(`
    INSERT INTO horse_stat_snapshots
      (id, horse_id, observed_at, snapshot_scope, starts, wins, start_points, source_record_id)
    VALUES (?, ?, ?, 'life', ?, ?, ?, ?)
  `).run(`horse-stat-${key}`, horseId, observedAt, lifeStarts, lifeWins, startPoints, sourceId);
  if (recordSeconds != null) {
    const whole = Math.floor(recordSeconds);
    const tenths = Math.round((recordSeconds - whole) * 10);
    db.prepare(`
      INSERT INTO horse_record_snapshots
        (id, horse_id, observed_at, record_scope, record_ordinal, time_minutes, time_seconds, time_tenths, source_record_id)
      VALUES (?, ?, ?, 'current', 0, 1, ?, ?, ?)
    `).run(`horse-record-${key}`, horseId, observedAt, whole - 60, tenths, sourceId);
  }
}

function seedTargetOpponents(db, targetRaceId, observedAt) {
  for (let index = 1; index <= 2; index += 1) {
    const horseId = `opponent-${index}`;
    seedHorse(db, horseId);
    const entryId = `target-opponent-entry-${index}`;
    db.prepare(`
      INSERT INTO race_entries
        (id, race_id, horse_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
      VALUES (?, ?, ?, ?, ?, 0, 2140, 0, 'synthetic')
    `).run(entryId, targetRaceId, horseId, index + 1, index + 1);
    seedOfficialSnapshot(db, horseId, `opponent-${index}`, observedAt, {
      startPoints: index === 1 ? 40 : 60,
      lifeStarts: 20,
      lifeWins: 4
    });
  }
}

function seedProposition(db, raceId, observedAt) {
  const sourceId = 'prop-source';
  seedSource(db, sourceId, observedAt);
  db.prepare(`
    INSERT INTO race_proposition_facts
      (id, race_id, source_record_id, source_observation_id, observed_at, parser_version, parse_status, raw_text, normalized_text, facts_json, parser_notes_json)
    VALUES (?, ?, ?, ?, ?, 'race-proposition-v1', 'parsed', ?, ?, ?, '[]')
  `).run(
    'prop-target', raceId, sourceId, 'obs-prop', observedAt,
    '3-åriga och äldre högst 500 000 kr',
    '3-åriga och äldre högst 500 000 kr',
    JSON.stringify({ min_age: 3, max_earnings_sek: 500000 })
  );
}

function seedScenario(db) {
  const target = seedRaceEntry(db, {
    key: '100', horseId: 'horse-a', raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z',
    trackId: 'track-a', distanceM: 2140, startMethod: 'auto', firstPrizeSek: 150000, target: true
  });
  const history = [];
  const dates = ['2026-09-12', '2026-09-05', '2026-08-29', '2026-08-20', '2026-08-10', '2026-07-25', '2026-07-10', '2026-06-25', '2026-06-10', '2026-05-25'];
  for (let index = 0; index < dates.length; index += 1) {
    const sameContext = index < 3;
    const start = seedRaceEntry(db, {
      key: String(index + 1), horseId: 'horse-a', raceDate: dates[index], scheduledAt: `${dates[index]}T12:00:00Z`,
      trackId: sameContext ? 'track-a' : 'track-b',
      distanceM: sameContext ? 2140 : (index % 2 === 0 ? 1640 : 2640),
      startMethod: sameContext || index < 9 ? 'auto' : 'volt',
      driverId: index < 4 ? 'driver-a' : 'driver-b',
      firstPrizeSek: 60000 + index * 10000,
      placing: [1, 2, 4, 3, 5, 2, 1, 6, 3, 7][index],
      prizeSek: 10000 + index * 1000,
      kmTime: `1.1${index % 6},${index % 10}`,
      gallop: index === 2 || index === 7,
      disqualified: index === 7,
      resultObservedAt: `${dates[index]}T14:00:00Z`
    });
    history.push(start);
    if (index === 0 || index === 3 || index === 6 || index === 8) {
      seedXlabs(db, start.entryId, String(index + 1), `${dates[index]}T14:30:00Z`, {
        first200: `1.1${2 + (index % 3)},0 min/km`,
        last400: `1.1${1 + (index % 3)},0 min/km`
      });
    }
  }
  seedOfficialSnapshot(db, 'horse-a', 'target', '2026-09-19T10:00:00Z', {
    startPoints: 70,
    lifeStarts: 30,
    lifeWins: 6,
    recordSeconds: 70.5
  });
  seedTargetOpponents(db, target.raceId, '2026-09-19T10:00:00Z');
  seedProposition(db, target.raceId, '2026-09-19T11:00:00Z');
  return { target, history };
}

test('B3 registry exposes seven immutable versioned feature families', () => {
  const registry = getPerformanceFeatureVersionRegistry();
  assert.equal(registry.length, 7);
  assert.deepEqual(registry.map((item) => item.version).sort(), Object.values(PERFORMANCE_FEATURE_VERSIONS).sort());
  assert.ok(registry.every((item) => item.family && item.semantics));
});

test('B3 builds deterministic market-blind performance families with evidence and provenance', async () => {
  const { db, env } = createTestEnv();
  const { target } = seedScenario(db);
  const first = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const second = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  assert.deepEqual(first, second);

  const result = first.get(target.entryId);
  assert.equal(result.contractVersion, PERFORMANCE_FEATURE_CONTRACT_VERSION);
  assert.equal(result.asOf, '2026-09-20T13:00:00.000Z');
  assert.deepEqual(Object.keys(result.families).sort(), ['capacity', 'classContext', 'development', 'form', 'gallopRisk', 'methodDistance', 'restReadiness'].sort());
  assert.equal(result.families.capacity.metrics.official_start_points.value, 70);
  assert.equal(result.families.capacity.metrics.official_record_km_seconds.value, 70.5);
  assert.equal(result.families.classContext.metrics.opponent_start_points_mean.value, 50);
  assert.equal(result.families.classContext.metrics.proposition_parse_status.value, 'parsed');
  assert.equal(result.families.form.metrics.xlabs_start_coverage_rate.value, 0.4);
  assert.ok(result.families.methodDistance.metrics.method_distance_top3_rate.sample_size > 0);
  assert.ok(result.families.gallopRisk.metrics.full_history_gallop_rate.sample_size >= 10);

  for (const family of Object.values(result.families)) {
    assert.equal(family.provenance.contract_version, 'kentaurai-feature-provenance-v1');
    for (const envelope of Object.values(family.metrics)) {
      assert.equal(envelope.contract_version, 'kentaurai-evidence-v1');
      assert.ok(['A', 'B', 'C', 'D'].includes(envelope.evidence_level));
      assert.ok(envelope.coverage == null || (envelope.coverage >= 0 && envelope.coverage <= 1));
      assert.ok(envelope.confidence == null || (envelope.confidence >= 0 && envelope.confidence <= 1));
    }
  }

  assert.equal('score' in result, false);
  assert.equal(Object.values(result.families).some((family) => 'score' in family), false);
});

test('B3 ignores market snapshots completely', async () => {
  const { db, env } = createTestEnv();
  const { target } = seedScenario(db);
  const before = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');

  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, bet_stop_at, status)
    VALUES ('round-market', 'V85', '2026-09-20', '2026-09-20T13:00:00Z', '2026-09-20T13:55:00Z', 'scheduled')
  `).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round-market', 1, ?)` ).run(target.raceId);
  db.prepare(`
    INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank)
    VALUES ('market-1', 'round-market', 1, ?, '2026-09-20T12:30:00Z', 99.9, 1)
  `).run(target.entryId);
  db.prepare(`
    INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds)
    VALUES ('odds-1', ?, '2026-09-20T12:30:00Z', 'winner', 1.01)
  `).run(target.entryId);

  const after = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  assert.deepEqual(after, before);
});

test('B3 keeps missing X-Labs neutral and lowers coverage instead of fabricating values', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: '100', horseId: 'horse-a', raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedRaceEntry(db, {
    key: '1', horseId: 'horse-a', raceDate: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z',
    placing: 2, kmTime: '1.12,0', resultObservedAt: '2026-09-10T14:00:00Z'
  });
  const map = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const result = map.get(target.entryId);
  assert.equal(result.families.form.metrics.xlabs_start_coverage_rate.value, 0);
  assert.equal(result.families.form.metrics.average_xlabs_first200_km_seconds.value, null);
  assert.equal(result.families.form.metrics.average_xlabs_first200_km_seconds.confidence, null);
  assert.equal(result.families.capacity.metrics.best_relevant_xlabs_last400_km_seconds.value, null);
});

test('B3 development requires a real recent and baseline sample before emitting deltas', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: '100', horseId: 'horse-a', raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  for (let index = 1; index <= 3; index += 1) {
    seedRaceEntry(db, {
      key: String(index), horseId: 'horse-a', raceDate: `2026-09-${String(10 - index).padStart(2, '0')}`,
      scheduledAt: `2026-09-${String(10 - index).padStart(2, '0')}T12:00:00Z`, placing: index,
      resultObservedAt: `2026-09-${String(10 - index).padStart(2, '0')}T14:00:00Z`
    });
  }
  const map = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const development = map.get(target.entryId).families.development.metrics;
  assert.equal(development.average_placing_delta_recent_minus_baseline.value, null);
  assert.equal(development.top3_rate_delta_recent_minus_baseline.value, null);
});

test('B3 sparse context uses deterministic hierarchical backoff rather than pretending direct certainty', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: '100', horseId: 'horse-a', raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z',
    distanceM: 2140, startMethod: 'auto', target: true
  });
  for (let index = 1; index <= 10; index += 1) {
    const sameDistance = index === 1;
    seedRaceEntry(db, {
      key: String(index), horseId: 'horse-a', raceDate: `2026-08-${String(index).padStart(2, '0')}`,
      scheduledAt: `2026-08-${String(index).padStart(2, '0')}T12:00:00Z`,
      distanceM: sameDistance ? 2140 : 2640,
      startMethod: 'auto', placing: index === 1 ? 1 : (index % 3) + 2,
      resultObservedAt: `2026-08-${String(index).padStart(2, '0')}T14:00:00Z`
    });
  }
  const map = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const family = map.get(target.entryId).families.methodDistance;
  assert.equal(family.metrics.method_distance_top3_rate.sample_size, 1);
  assert.equal(family.estimates.shrunk_method_distance_top3_rate.evidence_source, 'direct_plus_model_estimate');
  assert.equal(family.estimates.shrunk_method_distance_top3_rate.backoff_level, 'same_start_method');
  assert.notEqual(
    family.metrics.shrunk_method_distance_top3_rate.value,
    family.metrics.method_distance_top3_rate.value
  );
});

test('B3 caps feature as-of at target start and excludes late observations', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: '100', horseId: 'horse-a', raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedRaceEntry(db, {
    key: '1', horseId: 'horse-a', raceDate: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z',
    placing: 1, resultObservedAt: '2026-09-10T14:00:00Z'
  });
  seedOfficialSnapshot(db, 'horse-a', 'early', '2026-09-19T10:00:00Z', { startPoints: 40, lifeStarts: 10, lifeWins: 2 });
  seedOfficialSnapshot(db, 'horse-a', 'late', '2026-09-20T15:00:00Z', { startPoints: 99, lifeStarts: 10, lifeWins: 9 });

  const map = await buildPerformanceFeaturesV3ForEntries(env, [target.entryId], '2026-09-22T00:00:00Z');
  const result = map.get(target.entryId);
  assert.equal(result.asOf, '2026-09-20T14:00:00.000Z');
  assert.equal(result.families.capacity.metrics.official_start_points.value, 40);
});
