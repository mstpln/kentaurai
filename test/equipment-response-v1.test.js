import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  EQUIPMENT_CHANGE_VERSION,
  EQUIPMENT_RESPONSE_CONTRACT_VERSION,
  EQUIPMENT_RESPONSE_FEATURE_VERSION,
  EQUIPMENT_STATE_VERSION,
  buildEquipmentResponseV1ForEntries,
  getEquipmentResponseVersionRegistry
} from '../src/equipment-response-v1.js';

function seedTrack(db, id = 'track-a') {
  db.prepare('INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, `Track ${id}`);
}
function seedHorse(db, id) {
  db.prepare('INSERT OR IGNORE INTO horses (id, canonical_name) VALUES (?, ?)').run(id, `Horse ${id}`);
}
function seedTrainer(db, id) {
  if (id) db.prepare('INSERT OR IGNORE INTO trainers (id, canonical_name) VALUES (?, ?)').run(id, `Trainer ${id}`);
}
function seedSource(db, id, fetchedAt, sourceType = 'official_provider', qualityStatus = 'normalized_verified_subset') {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status) VALUES (?, ?, ?, ?, ?)`)
    .run(id, sourceType, id, fetchedAt, qualityStatus);
}

function seedRaceEntry(db, {
  key, horseId, trainerId = 'trainer-a', date, scheduledAt, target = false,
  placing = 4, gallop = false, resultObservedAt = null
}) {
  seedTrack(db); seedHorse(db, horseId); seedTrainer(db, trainerId);
  const raceId = `race-${key}`;
  const entryId = `entry-${key}`;
  db.prepare(`
    INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status, source_quality)
    VALUES (?, 'track-a', ?, ?, ?, 2140, 'auto', 'scheduled', 'normalized_verified_subset')
  `).run(raceId, date, Number(String(key).replace(/\D/g, '').slice(-3)) || 1, scheduledAt);
  db.prepare(`
    INSERT INTO race_entries (id, race_id, horse_id, trainer_id, start_number, actual_lane, handicap_m, actual_start_distance_m, scratched, data_quality)
    VALUES (?, ?, ?, ?, 1, 1, 0, 2140, 0, 'synthetic')
  `).run(entryId, raceId, horseId, trainerId);
  if (!target) {
    const sourceId = `result-source-${key}`;
    seedSource(db, sourceId, resultObservedAt || scheduledAt);
    db.prepare(`
      INSERT INTO race_results (race_entry_id, placing, gallop, disqualified, result_status, source_record_id)
      VALUES (?, ?, ?, 0, 'official', ?)
    `).run(entryId, placing, Number(gallop), sourceId);
  }
  return { raceId, entryId };
}

function seedEquipment(db, entryId, key, observedAt, {
  front = 'shod', rear = 'shod', barefootFront = false, barefootRear = false,
  sulkyType = 'standard', exactSulky = null, verificationStatus = 'reported', change = null
} = {}) {
  const sourceId = `equipment-source-${key}`;
  seedSource(db, sourceId, observedAt);
  db.prepare(`
    INSERT INTO equipment
      (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear,
       sulky_type, exact_sulky, change_from_previous_json, verification_status, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `equipment-${key}`, entryId, front, rear,
    barefootFront == null ? null : Number(barefootFront),
    barefootRear == null ? null : Number(barefootRear),
    sulkyType, exactSulky, change == null ? null : JSON.stringify(change), verificationStatus, sourceId
  );
}

function seedXlabs(db, entryId, key, observedAt, { first200 = '1.12,0 min/km', last400 = '1.11,0 min/km' } = {}) {
  const sourceId = `xlabs-source-${key}`;
  seedSource(db, sourceId, observedAt, 'xlabs_race_json');
  db.prepare(`
    INSERT INTO xlabs_data (id, race_entry_id, first_200_time, last_400_time, quality_status, source_record_id)
    VALUES (?, ?, ?, ?, 'xlabs-telemetry-v1', ?)
  `).run(`xlabs-${key}`, entryId, first200, last400, sourceId);
}

const SHOE_CHANGE = Object.freeze({
  shoesFrontChanged: true,
  shoesRearChanged: false,
  sulkyTypeChanged: false,
  sulkyColourChanged: false
});

function seedHorseScenario(db) {
  const target = seedRaceEntry(db, {
    key: 'target', horseId: 'horse-a', date: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedEquipment(db, target.entryId, 'target', '2026-09-20T10:00:00Z', {
    front: 'barefoot', rear: 'shod', barefootFront: true, barefootRear: false, sulkyType: 'bike', change: SHOE_CHANGE
  });

  const rows = [
    ['h1','2026-09-12',1,false,true],
    ['h2','2026-09-05',2,false,true],
    ['h3','2026-08-28',5,true,false],
    ['h4','2026-08-20',3,false,false],
    ['h5','2026-08-12',4,false,false],
    ['h6','2026-08-04',2,false,false],
    ['h7','2026-07-27',6,true,false],
    ['h8','2026-07-19',1,false,false]
  ];
  for (const [key, date, placing, gallop, sameState] of rows) {
    const start = seedRaceEntry(db, {
      key, horseId: 'horse-a', date, scheduledAt: `${date}T12:00:00Z`, placing, gallop, resultObservedAt: `${date}T14:00:00Z`
    });
    seedEquipment(db, start.entryId, key, `${date}T11:00:00Z`, sameState ? {
      front: 'barefoot', rear: 'shod', barefootFront: true, barefootRear: false, sulkyType: 'bike', change: key === 'h1' ? SHOE_CHANGE : null
    } : {
      front: 'shod', rear: 'shod', barefootFront: false, barefootRear: false, sulkyType: 'standard', change: null
    });
    if (sameState) seedXlabs(db, start.entryId, key, `${date}T14:30:00Z`);
  }
  return target;
}

function seedTrainerFallback(db) {
  for (let index = 1; index <= 10; index += 1) {
    const day = String(index).padStart(2, '0');
    const start = seedRaceEntry(db, {
      key: `trainer-${index}`, horseId: `trainer-horse-${index}`, trainerId: 'trainer-a',
      date: `2026-08-${day}`, scheduledAt: `2026-08-${day}T12:00:00Z`,
      placing: index <= 4 ? 2 : 5, gallop: index === 10, resultObservedAt: `2026-08-${day}T14:00:00Z`
    });
    seedEquipment(db, start.entryId, `trainer-${index}`, `2026-08-${day}T11:00:00Z`, {
      front: 'barefoot', rear: 'shod', barefootFront: true, barefootRear: false, sulkyType: 'bike', change: SHOE_CHANGE
    });
  }
}

test('B4 registry exposes equipment response v1', () => {
  const registry = getEquipmentResponseVersionRegistry();
  assert.equal(registry.length, 1);
  assert.equal(registry[0].family, 'equipment_response');
  assert.equal(registry[0].version, EQUIPMENT_RESPONSE_FEATURE_VERSION);
});

test('B4 returns current equipment separately from response metrics and sample confidence', async () => {
  const { db, env } = createTestEnv();
  const target = seedHorseScenario(db);
  seedTrainerFallback(db);
  const result = (await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);

  assert.equal(result.contractVersion, EQUIPMENT_RESPONSE_CONTRACT_VERSION);
  assert.equal(result.currentEquipment.state_version, EQUIPMENT_STATE_VERSION);
  assert.equal(result.currentEquipment.change.version, EQUIPMENT_CHANGE_VERSION);
  assert.equal(result.currentEquipment.state.shoes_front, 'barefoot');
  assert.equal(result.currentEquipment.state.sulky_type, 'bike');
  assert.equal(result.currentEquipment.change.status, 'changed');
  assert.equal(result.currentEquipment.change.type, 'shoes_front');
  assert.equal(result.currentEquipment.history_status, 'observed');
  assert.equal(typeof result.currentEquipment.state_hash, 'string');
  assert.equal(result.currentEquipment.state_hash.length, 64);

  assert.equal(result.samples.safeHorseStarts, 8);
  assert.equal(result.samples.sameStateStarts, 2);
  assert.equal(result.samples.sameChangeTypeStarts, 1);
  assert.equal(result.metrics.same_state_top3_rate.value, 1);
  assert.equal(result.metrics.same_state_top3_rate.sample_size, 2);
  assert.ok(result.metrics.same_state_top3_rate.confidence < 1);
  assert.equal(result.metrics.same_change_type_top3_rate.value, 1);
  assert.equal(result.metrics.change_top3_association_delta_vs_horse_baseline.value, 1 - (4 / 7));
  assert.equal(result.estimates.shrunk_change_top3_association_delta.backoff_level, 'no_change_prior');
  assert.equal(result.metrics.trainer_same_change_type_top3_rate.value, 0.4);
  assert.equal(result.metrics.trainer_same_change_type_top3_rate.evidence_level, 'C');
  assert.equal(result.provenance.contract_version, 'kentaurai-feature-provenance-v1');
  assert.equal('score' in result, false);
});

test('B4 unknown equipment is not treated as standard equipment', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: 'target', horseId: 'horse-a', date: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  const history = seedRaceEntry(db, {
    key: 'history', horseId: 'horse-a', date: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z', placing: 1, resultObservedAt: '2026-09-10T14:00:00Z'
  });
  seedEquipment(db, history.entryId, 'history', '2026-09-10T11:00:00Z', {
    front: 'shod', rear: 'shod', barefootFront: false, barefootRear: false, sulkyType: 'standard'
  });
  seedEquipment(db, target.entryId, 'target', '2026-09-20T10:00:00Z', {
    front: null, rear: null, barefootFront: null, barefootRear: null, sulkyType: null, verificationStatus: 'unknown'
  });

  const result = (await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(result.currentEquipment.state, null);
  assert.equal(result.currentEquipment.history_status, 'unknown_current');
  assert.equal(result.samples.sameStateStarts, 0);
  assert.equal(result.metrics.same_state_win_rate.value, null);
  assert.equal(result.metrics.same_state_top3_rate.value, null);
});

test('B4 evaluates state match and change type independently', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: 'target', horseId: 'horse-a', date: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedEquipment(db, target.entryId, 'target', '2026-09-20T10:00:00Z', {
    front: 'barefoot', rear: 'shod', barefootFront: true, barefootRear: false, sulkyType: 'bike', change: SHOE_CHANGE
  });
  const sameStateNoChange = seedRaceEntry(db, {
    key: 'same-state', horseId: 'horse-a', date: '2026-09-10', scheduledAt: '2026-09-10T12:00:00Z', placing: 2, resultObservedAt: '2026-09-10T14:00:00Z'
  });
  seedEquipment(db, sameStateNoChange.entryId, 'same-state', '2026-09-10T11:00:00Z', {
    front: 'barefoot', rear: 'shod', barefootFront: true, barefootRear: false, sulkyType: 'bike', change: {
      shoesFrontChanged: false, shoesRearChanged: false, sulkyTypeChanged: false, sulkyColourChanged: false
    }
  });
  const differentStateSameChange = seedRaceEntry(db, {
    key: 'same-change', horseId: 'horse-a', date: '2026-09-01', scheduledAt: '2026-09-01T12:00:00Z', placing: 1, resultObservedAt: '2026-09-01T14:00:00Z'
  });
  seedEquipment(db, differentStateSameChange.entryId, 'same-change', '2026-09-01T11:00:00Z', {
    front: 'barefoot', rear: 'barefoot', barefootFront: true, barefootRear: true, sulkyType: 'standard', change: SHOE_CHANGE
  });

  const result = (await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(result.samples.sameStateStarts, 1);
  assert.equal(result.samples.sameChangeTypeStarts, 1);
  assert.equal(result.metrics.same_state_top3_rate.value, 1);
  assert.equal(result.metrics.same_change_type_top3_rate.value, 1);
});

test('B4 first-seen state exposes uncertainty instead of an invented effect', async () => {
  const { db, env } = createTestEnv();
  const target = seedRaceEntry(db, {
    key: 'target', horseId: 'horse-a', date: '2026-09-20', scheduledAt: '2026-09-20T14:00:00Z', target: true
  });
  seedEquipment(db, target.entryId, 'target', '2026-09-20T10:00:00Z', {
    front: 'barefoot', rear: 'barefoot', barefootFront: true, barefootRear: true, sulkyType: 'bike', change: SHOE_CHANGE
  });
  for (let index = 1; index <= 3; index += 1) {
    const date = `2026-09-0${index}`;
    const start = seedRaceEntry(db, {
      key: `h${index}`, horseId: 'horse-a', date, scheduledAt: `${date}T12:00:00Z`, placing: index, resultObservedAt: `${date}T14:00:00Z`
    });
    seedEquipment(db, start.entryId, `h${index}`, `${date}T11:00:00Z`, {
      front: 'shod', rear: 'shod', barefootFront: false, barefootRear: false, sulkyType: 'standard'
    });
  }
  const result = (await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z')).get(target.entryId);
  assert.equal(result.currentEquipment.history_status, 'first_seen');
  assert.equal(result.samples.sameStateStarts, 0);
  assert.equal(result.metrics.same_state_win_rate.value, null);
  assert.equal(result.estimates.shrunk_same_state_win_rate.evidence_source, 'unknown');
});

test('B4 is as-of safe, deterministic, market blind and ignores later equipment snapshots', async () => {
  const { db, env } = createTestEnv();
  const target = seedHorseScenario(db);
  const before = await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');

  seedEquipment(db, target.entryId, 'late', '2026-09-20T15:00:00Z', {
    front: 'shod', rear: 'shod', barefootFront: false, barefootRear: false, sulkyType: 'standard'
  });
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round-market','V85','2026-09-20','scheduled')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round-market',1,?)`).run(target.raceId);
  db.prepare(`INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank) VALUES ('m','round-market',1,?,'2026-09-20T12:30:00Z',99.9,1)`).run(target.entryId);
  db.prepare(`INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds) VALUES ('o',?,'2026-09-20T12:30:00Z','winner',1.01)`).run(target.entryId);

  const after = await buildEquipmentResponseV1ForEntries(env, [target.entryId], '2026-09-20T13:00:00Z');
  assert.deepEqual(after, before);
  const result = after.get(target.entryId);
  assert.equal(result.currentEquipment.state.shoes_front, 'barefoot');
  assert.equal(result.effectiveAsOf, '2026-09-20T13:00:00.000Z');
});
