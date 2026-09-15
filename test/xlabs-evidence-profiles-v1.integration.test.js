import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildXlabsEvidenceProfilesForRace } from '../src/xlabs-evidence-profiles-v1.js';

function insert(db, sql, ...args) { db.prepare(sql).run(...args); }

function seedRace(db, {
  raceId, date, scheduledAt, trackId, method = 'auto', distance = 2140,
  raceName = 'Klass I', mainClass = 'Klass I', fieldSize = 10
}) {
  insert(db, `INSERT OR IGNORE INTO tracks (id,canonical_name) VALUES (?,?)`, trackId, trackId);
  insert(db, `INSERT INTO races
    (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,field_size,race_name,main_class,status,source_quality)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  raceId, trackId, date, 1, scheduledAt, distance, method, fieldSize, raceName, mainClass, 'result', 'official');
}

function seedHorse(db, id) {
  insert(db, `INSERT OR IGNORE INTO horses (id,canonical_name) VALUES (?,?)`, id, id);
}

function seedEntry(db, { id, raceId, horseId, number, scratched = 0, actualDistance = 2140 }) {
  seedHorse(db, horseId);
  insert(db, `INSERT INTO race_entries
    (id,race_id,horse_id,start_number,actual_start_distance_m,scratched,data_quality)
    VALUES (?,?,?,?,?,?,?)`, id, raceId, horseId, number, actualDistance, scratched, 'official');
}

function seedSource(db, { id, type, fetchedAt }) {
  insert(db, `INSERT INTO source_records
    (id,source_type,fetched_at,quality_status)
    VALUES (?,?,?,?)`, id, type, fetchedAt, 'normalized_verified_subset');
}

function seedResult(db, entryId, sourceId) {
  insert(db, `INSERT INTO race_results
    (race_entry_id,placing,source_record_id) VALUES (?,?,?)`, entryId, 1, sourceId);
}

function seedXlabs(db, { entryId, sourceId, opening = null, closing = null, extraDistance = null }) {
  if (opening != null) {
    insert(db, `INSERT INTO xlabs_intervals
      (id,race_entry_id,source_record_id,interval_start_m,interval_end_m,elapsed_ms,km_pace_ms,
       measured_distance_m,local_target_frame_count,local_window_frame_count,local_frame_coverage,
       eligibility_status,mapper_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `int-${entryId}-${sourceId}`, entryId, sourceId, 0, 100, opening / 10, opening,
    100, 11, 11, 1, 'valid', 'xlabs-intervals-v2');
  }
  if (closing != null || extraDistance != null) {
    insert(db, `INSERT INTO xlabs_data
      (id,race_entry_id,last_400_time,actual_distance_m,extra_distance_m,quality_status,source_record_id)
      VALUES (?,?,?,?,?,?,?)`,
    `xl-${entryId}-${sourceId}`, entryId, closing, 2140 + (extraDistance || 0), extraDistance,
    'xlabs-telemetry-v1', sourceId);
  }
}

function seedHistoricalStart(db, {
  suffix, horseId, date, method = 'auto', distance = 2140, trackId = 'track-a',
  opening = 74000, closing = '1.12,0 min/km', extraDistance = 20,
  xlabsFetchedAt = `${date}T15:00:00.000Z`, resultFetchedAt = `${date}T16:00:00.000Z`
}) {
  const raceId = `race-${suffix}`;
  const entryId = `entry-${suffix}`;
  const resultSource = `official-${suffix}`;
  const xlabsSource = `xlabs-${suffix}`;
  seedRace(db, { raceId, date, scheduledAt: `${date}T12:00:00.000Z`, trackId, method, distance });
  seedEntry(db, { id: entryId, raceId, horseId, number: 1, actualDistance: distance });
  seedSource(db, { id: resultSource, type: 'official_provider', fetchedAt: resultFetchedAt });
  seedResult(db, entryId, resultSource);
  seedSource(db, { id: xlabsSource, type: 'xlabs_race_json', fetchedAt: xlabsFetchedAt });
  seedXlabs(db, { entryId, sourceId: xlabsSource, opening, closing, extraDistance });
}

test('DB wrapper is as-of safe and exposes measured field/front-contender coverage', async () => {
  const { db, env } = createTestEnv();
  seedHistoricalStart(db, { suffix: 'a', horseId: 'horse-1', date: '2026-08-01' });
  seedHistoricalStart(db, { suffix: 'b', horseId: 'horse-1', date: '2026-08-10', opening: 73000 });
  seedHistoricalStart(db, { suffix: 'c', horseId: 'horse-1', date: '2026-08-20', opening: 72000 });
  seedHistoricalStart(db, { suffix: 'd', horseId: 'horse-2', date: '2026-08-05', opening: null, closing: '1.13,0 min/km' });
  seedHistoricalStart(db, {
    suffix: 'future-source', horseId: 'horse-2', date: '2026-08-25', opening: 70000,
    xlabsFetchedAt: '2026-09-16T10:00:00.000Z'
  });

  seedRace(db, {
    raceId: 'target-race', date: '2026-09-20', scheduledAt: '2026-09-20T13:00:00.000Z',
    trackId: 'track-a', method: 'auto', distance: 2140
  });
  seedEntry(db, { id: 'target-1', raceId: 'target-race', horseId: 'horse-1', number: 1 });
  seedEntry(db, { id: 'target-2', raceId: 'target-race', horseId: 'horse-2', number: 2 });
  seedEntry(db, { id: 'target-3', raceId: 'target-race', horseId: 'horse-3', number: 3 });

  const result = await buildXlabsEvidenceProfilesForRace(env, {
    raceId: 'target-race',
    asOf: '2026-09-15T06:00:00.000Z',
    frontContenderEntryIds: ['target-1', 'target-2']
  });

  const one = result.profiles.find((row) => row.horse_id === 'horse-1');
  const two = result.profiles.find((row) => row.horse_id === 'horse-2');
  assert.equal(one.features.opening_100_km_pace_ms.sample_size, 3);
  assert.equal(one.features.opening_100_km_pace_ms.evidence_level, 'A');
  assert.equal(two.features.opening_100_km_pace_ms.sample_size, 0);
  assert.equal(two.features.closing_400_km_pace_ms.sample_size, 1);
  assert.equal(result.coverage.field.features.opening_100_km_pace_ms.measured_entries, 1);
  assert.equal(result.coverage.field.features.opening_100_km_pace_ms.eligible_entries, 3);
  assert.equal(result.coverage.front_contenders.features.closing_400_km_pace_ms.measured_entries, 2);
  assert.equal(result.separation.baseline_strength_modified, false);
});

test('DB wrapper replays deterministically at the same cutoff', async () => {
  const { db, env } = createTestEnv();
  seedHistoricalStart(db, { suffix: 'a', horseId: 'horse-1', date: '2026-08-01' });
  seedRace(db, {
    raceId: 'target-race', date: '2026-09-20', scheduledAt: '2026-09-20T13:00:00.000Z',
    trackId: 'track-a', method: 'auto', distance: 2140
  });
  seedEntry(db, { id: 'target-1', raceId: 'target-race', horseId: 'horse-1', number: 1 });

  const options = { raceId: 'target-race', asOf: '2026-09-15T06:00:00.000Z' };
  const first = await buildXlabsEvidenceProfilesForRace(env, options);
  const second = await buildXlabsEvidenceProfilesForRace(env, options);
  assert.deepEqual(first, second);
});
