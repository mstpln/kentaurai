import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  RELEVANT_HISTORY_CONTRACT_VERSION,
  RELEVANT_HISTORY_SELECTION_VERSION,
  buildRelevantHistoryForEntries
} from '../src/relevant-history-v1.js';

function seedTrack(db, id) {
  db.prepare('INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, `Track ${id}`);
}

function seedHorse(db, id = 'horse-a') {
  db.prepare('INSERT OR IGNORE INTO horses (id, canonical_name) VALUES (?, ?)').run(id, `Horse ${id}`);
}

function seedDriver(db, id) {
  if (!id) return;
  db.prepare('INSERT OR IGNORE INTO drivers (id, canonical_name) VALUES (?, ?)').run(id, `Driver ${id}`);
}

function seedResultSource(db, id, fetchedAt) {
  db.prepare(`
    INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, 'official_provider', ?, ?, 'normalized_verified_subset')
  `).run(id, id, fetchedAt);
}

function seedStart(db, {
  index,
  horseId = 'horse-a',
  raceDate,
  scheduledAt,
  trackId = 'track-a',
  distanceM = 2140,
  startMethod = 'auto',
  driverId = 'driver-a',
  placing = 4,
  prizeSek = 0,
  gallop = false,
  disqualified = false,
  resultObservedAt,
  target = false
}) {
  seedHorse(db, horseId);
  seedTrack(db, trackId);
  seedDriver(db, driverId);
  const raceId = `race-${index}`;
  const entryId = `entry-${index}`;
  db.prepare(`
    INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', 'normalized_verified_subset')
  `).run(raceId, trackId, raceDate, index, scheduledAt, distanceM, startMethod);
  db.prepare(`
    INSERT INTO race_entries
      (id, race_id, horse_id, driver_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, ?, ?, 1, 1, 0, ?, 0, 'synthetic')
  `).run(entryId, raceId, horseId, driverId, distanceM);
  if (!target) {
    const sourceId = `source-${index}`;
    seedResultSource(db, sourceId, resultObservedAt || scheduledAt);
    db.prepare(`
      INSERT INTO race_results
        (race_entry_id, placing, prize_sek, gallop, disqualified, result_status, source_record_id)
      VALUES (?, ?, ?, ?, ?, 'official', ?)
    `).run(entryId, placing, prizeSek, Number(gallop), Number(disqualified), sourceId);
  }
  return { raceId, entryId };
}

function buildBaseHistory(db) {
  const target = seedStart(db, {
    index: 100,
    raceDate: '2026-09-20',
    scheduledAt: '2026-09-20T14:00:00Z',
    trackId: 'track-a',
    distanceM: 2140,
    startMethod: 'auto',
    driverId: 'driver-a',
    target: true
  });
  seedStart(db, {
    index: 1,
    raceDate: '2026-09-15', scheduledAt: '2026-09-15T12:00:00Z',
    trackId: 'track-b', distanceM: 1640, startMethod: 'volt', driverId: 'driver-b',
    placing: 5, prizeSek: 1000, resultObservedAt: '2026-09-15T14:00:00Z'
  });
  seedStart(db, {
    index: 2,
    raceDate: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z',
    trackId: 'track-b', distanceM: 1640, startMethod: 'volt', driverId: 'driver-b',
    placing: 6, prizeSek: 2000, resultObservedAt: '2026-09-10T14:00:00Z'
  });
  seedStart(db, {
    index: 3,
    raceDate: '2026-09-05', scheduledAt: '2026-09-05T12:00:00Z',
    trackId: 'track-b', distanceM: 2640, startMethod: 'volt', driverId: 'driver-b',
    placing: 7, prizeSek: 3000, resultObservedAt: '2026-09-05T14:00:00Z'
  });
  const oldRelevant = seedStart(db, {
    index: 4,
    raceDate: '2026-08-01', scheduledAt: '2026-08-01T12:00:00Z',
    trackId: 'track-a', distanceM: 2140, startMethod: 'auto', driverId: 'driver-a',
    placing: 1, prizeSek: 4000, resultObservedAt: '2026-08-01T14:00:00Z'
  });
  return { target, oldRelevant };
}

test('B2 returns versioned deterministic history with explicit counts and reasons', async () => {
  const { db, env } = createTestEnv();
  const { target, oldRelevant } = buildBaseHistory(db);
  const first = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z', { maxRows: 3, recentRows: 2 });
  const second = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z', { maxRows: 3, recentRows: 2 });
  assert.deepEqual(first, second);

  const result = first.get(target.entryId);
  assert.equal(result.contractVersion, RELEVANT_HISTORY_CONTRACT_VERSION);
  assert.equal(result.selectionVersion, RELEVANT_HISTORY_SELECTION_VERSION);
  assert.deepEqual(result.counts, { totalSafe: 4, included: 3, omitted: 1 });
  assert.equal(result.relevantHistoryUnion.length, 3);
  assert.ok(result.relevantHistoryUnion.every((row) => row.inclusionReasons.length > 0));
  assert.ok(result.relevantHistoryUnion.some((row) => row.raceEntryId === oldRelevant.entryId));
  assert.ok(!result.relevantHistoryUnion.some((row) => row.raceEntryId === 'entry-3'));
  const old = result.relevantHistoryUnion.find((row) => row.raceEntryId === oldRelevant.entryId);
  assert.ok(old.inclusionReasons.includes('same_start_method'));
  assert.ok(old.inclusionReasons.includes('similar_distance'));
  assert.ok(old.inclusionReasons.includes('same_track_context'));
  assert.ok(old.inclusionReasons.includes('same_driver'));
});

test('B2 full-history aggregates include safe starts omitted from row-level union', async () => {
  const { db, env } = createTestEnv();
  const target = seedStart(db, {
    index: 100, raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z',
    trackId: 'track-a', distanceM: 2140, startMethod: 'auto', driverId: 'driver-a', target: true
  });
  for (let index = 1; index <= 6; index += 1) {
    seedStart(db, {
      index,
      raceDate: `2026-08-${String(index).padStart(2, '0')}`,
      scheduledAt: `2026-08-${String(index).padStart(2, '0')}T12:00:00Z`,
      trackId: 'track-b', distanceM: 1640, startMethod: 'volt', driverId: 'driver-b',
      placing: index === 1 ? 1 : index, prizeSek: index * 1000,
      gallop: index === 2, disqualified: index === 3,
      resultObservedAt: `2026-08-${String(index).padStart(2, '0')}T14:00:00Z`
    });
  }
  const map = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z', { maxRows: 2, recentRows: 1 });
  const result = map.get(target.entryId);
  assert.equal(result.counts.totalSafe, 6);
  assert.equal(result.counts.included, 2);
  assert.equal(result.counts.omitted, 4);
  assert.equal(result.fullHistoryAggregates.starts, 6);
  assert.equal(result.fullHistoryAggregates.prizeSekSum, 21000);
  assert.equal(result.fullHistoryAggregates.wins, 1);
  assert.equal(result.fullHistoryAggregates.gallops, 1);
  assert.equal(result.fullHistoryAggregates.disqualified, 1);
  assert.equal(result.fullHistoryAggregates.winRate, 1 / 6);
});

test('B2 excludes starts after the target cutoff and results not observed by the cutoff', async () => {
  const { db, env } = createTestEnv();
  const target = seedStart(db, {
    index: 100, raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z',
    trackId: 'track-a', distanceM: 2140, startMethod: 'auto', driverId: 'driver-a', target: true
  });
  const safe = seedStart(db, {
    index: 1, raceDate: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z',
    resultObservedAt: '2026-09-10T14:00:00Z'
  });
  seedStart(db, {
    index: 2, raceDate: '2026-09-11', scheduledAt: '2026-09-11T12:00:00Z',
    resultObservedAt: '2026-09-21T10:00:00Z'
  });
  seedStart(db, {
    index: 3, raceDate: '2026-09-21', scheduledAt: '2026-09-21T12:00:00Z',
    resultObservedAt: '2026-09-19T10:00:00Z'
  });
  const map = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const result = map.get(target.entryId);
  assert.equal(result.counts.totalSafe, 1);
  assert.equal(result.fullHistoryAggregates.starts, 1);
  assert.equal(result.relevantHistoryUnion[0].raceEntryId, safe.entryId);
});

test('B2 target start time caps requested as-of and prevents same-race-day ambiguity', async () => {
  const { db, env } = createTestEnv();
  const target = seedStart(db, {
    index: 100, raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z',
    trackId: 'track-a', distanceM: 2140, startMethod: 'auto', driverId: 'driver-a', target: true
  });
  seedStart(db, {
    index: 1, raceDate: '2026-09-20', scheduledAt: '2026-09-20T15:00:00Z',
    resultObservedAt: '2026-09-20T15:30:00Z'
  });
  const map = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-22T00:00:00Z');
  const result = map.get(target.entryId);
  assert.equal(result.targetCutoff, '2026-09-20T14:00:00.000Z');
  assert.equal(result.counts.totalSafe, 0);
});

test('B2 missing X-Labs stays missing and never fabricates a negative measurement', async () => {
  const { db, env } = createTestEnv();
  const target = seedStart(db, {
    index: 100, raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedStart(db, {
    index: 1, raceDate: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z',
    resultObservedAt: '2026-09-10T14:00:00Z'
  });
  const map = await buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  const result = map.get(target.entryId);
  assert.equal(result.fullHistoryAggregates.xlabsStarts, 0);
  assert.equal(result.relevantHistoryUnion[0].xlabs, null);
  assert.ok(!result.relevantHistoryUnion[0].inclusionReasons.includes('xlabs_representative'));
});

test('B2 validates bounded deterministic selection policy', async () => {
  const { db, env } = createTestEnv();
  const target = seedStart(db, {
    index: 100, raceDate: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  await assert.rejects(
    buildRelevantHistoryForEntries(env, [target.entryId], '2026-09-20T13:00:00Z', { maxRows: 3, recentRows: 4 }),
    /recentRows cannot exceed maxRows/
  );
});
