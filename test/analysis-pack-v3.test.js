import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_PACK_V3_CONTRACT,
  assertAnalysisPackMarketBlind,
  buildAnalysisPackV3Files,
  findAnalysisPackMarketLeaks
} from '../src/analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from '../src/analysis-pack-v3-asof-guard.js';
import { createTestEnv } from './helpers/d1.js';

const AS_OF = '2099-01-02T11:00:00.000Z';
const GENERATED_AT = '2099-01-02T11:05:00.000Z';

function syntheticLegs({ entriesPerLeg = 2, padding = '' } = {}) {
  return Array.from({ length: 8 }, (_, legIndex) => ({
    leg_number: legIndex + 1,
    race: {
      race_id: `race_${legIndex + 1}`,
      track: { id: `track_${legIndex + 1}`, name: `Synthetic Track ${legIndex + 1}` },
      field: { total_entries: entriesPerLeg, analysis_eligible_entries: entriesPerLeg }
    },
    entries: Array.from({ length: entriesPerLeg }, (_, entryIndex) => ({
      race_entry_id: `entry_${legIndex + 1}_${entryIndex + 1}`,
      horse_id: `horse_${legIndex + 1}_${entryIndex + 1}`,
      current_facts: { analysis_eligible: true, scratched: false },
      features: { performance: { note: padding } },
      relevant_history: [],
      current_signals: []
    })),
    warnings: []
  }));
}

function packInput(legs = syntheticLegs()) {
  return {
    round: {
      round_id: 'V85_SYNTHETIC_D1',
      game_type: 'V85',
      round_date: '2099-01-02',
      pre_market_cutoff_at: '2099-01-02T12:00:00.000Z',
      pre_market_cutoff_source: 'bet_stop_at'
    },
    legs,
    asOf: AS_OF,
    generatedAt: GENERATED_AT,
    cutoffSource: 'bet_stop_at',
    warnings: [],
    sourceFamilyCoverage: { official_entry_observations: { observed: 16, eligible: 16, share: 1 } },
    sourceFreshness: { official_current: AS_OF },
    featureVersions: { capacity: 'capacity_v1' },
    parserVersions: { race_proposition: 'race-proposition-v1' },
    reconstructionVersions: { xlabs_position: 'xlabs-position-reconstruction-v1' }
  };
}

test('D1 pack produces exact eight-leg deterministic manifest, files, hashes and fingerprint', async () => {
  const first = await buildAnalysisPackV3Files(packInput());
  const second = await buildAnalysisPackV3Files(packInput());

  assert.equal(first.contractVersion, ANALYSIS_PACK_V3_CONTRACT);
  assert.equal(first.manifest.contains_current_market, false);
  assert.equal(first.manifest.round_id, 'V85_SYNTHETIC_D1');
  assert.equal(first.manifest.expected_files.length, 9);
  assert.deepEqual(first.manifest.expected_files, second.manifest.expected_files);
  assert.equal(first.factsFingerprint, second.factsFingerprint);
  assert.equal(first.packId, second.packId);
  assert.equal(first.manifestContent, second.manifestContent);
  assert.deepEqual(first.files.map((file) => file.name), [
    '00_round_pre_market.json',
    '01_leg_1.json', '02_leg_2.json', '03_leg_3.json', '04_leg_4.json',
    '05_leg_5.json', '06_leg_6.json', '07_leg_7.json', '08_leg_8.json'
  ]);
  for (const file of first.files) {
    const metadata = first.manifest.expected_files.find((item) => item.name === file.name);
    assert.ok(metadata);
    assert.equal(metadata.bytes, new TextEncoder().encode(file.content).byteLength);
    assert.match(metadata.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(findAnalysisPackMarketLeaks(file.payload).length, 0);
  }
});

test('D1 pack rejects missing/duplicate leg contract and denied current-market fields', async () => {
  await assert.rejects(() => buildAnalysisPackV3Files(packInput(syntheticLegs().slice(0, 7))), /exactly eight legs/);
  const duplicate = syntheticLegs();
  duplicate[7].leg_number = 7;
  await assert.rejects(() => buildAnalysisPackV3Files(packInput(duplicate)), /numbered 1 through 8/);

  const leak = { nested: { bettingPercent: 12.4 }, deeper: [{ winnerOdds: 4.2 }], turnoverSek: 1000 };
  const paths = findAnalysisPackMarketLeaks(leak);
  assert.ok(paths.some((path) => path.endsWith('.bettingPercent')));
  assert.ok(paths.some((path) => path.endsWith('.winnerOdds')));
  assert.ok(paths.some((path) => path.endsWith('.turnoverSek')));
  assert.throws(() => assertAnalysisPackMarketBlind(leak), /denied current-market fields/);

  const contaminated = syntheticLegs();
  contaminated[0].entries[0].market_rank = 1;
  await assert.rejects(() => buildAnalysisPackV3Files(packInput(contaminated)), /denied current-market fields/);
});

test('D1 large leg files split deterministically without truncating entries', async () => {
  const limit = 3500;
  const input = packInput(syntheticLegs({ entriesPerLeg: 4, padding: 'x'.repeat(900) }));
  const first = await buildAnalysisPackV3Files(input, { maxFileBytes: limit });
  const second = await buildAnalysisPackV3Files(input, { maxFileBytes: limit });
  assert.deepEqual(first.manifest.expected_files, second.manifest.expected_files);
  assert.ok(first.files.some((file) => file.name.includes('_part_')));
  assert.ok(first.files.every((file) => file.bytes <= limit));

  const legFiles = first.files.filter((file) => /^\d{2}_leg_\d/.test(file.name));
  const ids = legFiles.flatMap((file) => file.payload.entries.map((entry) => entry.race_entry_id));
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
  assert.deepEqual(ids.sort(), syntheticLegs({ entriesPerLeg: 4 }).flatMap((leg) => leg.entries.map((entry) => entry.race_entry_id)).sort());
});

function seedAsOfRound(db) {
  db.prepare(`INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('round_d1','V85','2099-01-02','2099-01-02T12:10:00Z','2099-01-02T12:00:00Z','upcoming')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('official_before','official_provider','game:round_d1','2099-01-02T11:00:00Z','hash-before','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('official_after','official_provider','game:round_d1','2099-01-02T12:05:00Z','hash-after','normalized_verified_subset')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const track = `track_${leg}`;
    const race = `race_${leg}`;
    const horse = `horse_${leg}`;
    const driver = `driver_${leg}`;
    const trainer = `trainer_${leg}`;
    const entry = `entry_${leg}`;
    db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES (?,?,'SE')`).run(track, `Synthetic Track ${leg}`);
    db.prepare(`INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES (?,'official',?)`).run(track, String(100 + leg));
    db.prepare(`INSERT INTO horses (id,canonical_name) VALUES (?,?)`).run(horse, `Synthetic Horse ${leg}`);
    db.prepare(`INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)`).run(horse, String(200 + leg));
    db.prepare(`INSERT INTO drivers (id,canonical_name) VALUES (?,?)`).run(driver, `Synthetic Driver ${leg}`);
    db.prepare(`INSERT INTO driver_external_ids (driver_id,source_type,external_id) VALUES (?,'official',?)`).run(driver, String(300 + leg));
    db.prepare(`INSERT INTO trainers (id,canonical_name) VALUES (?,?)`).run(trainer, `Synthetic Trainer ${leg}`);
    db.prepare(`INSERT INTO trainer_external_ids (trainer_id,source_type,external_id) VALUES (?,'official',?)`).run(trainer, String(400 + leg));
    db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?,?, '2099-01-02', ?, ?,2140,'auto','upcoming')`).run(race, track, leg, `2099-01-02T12:${String(9 + leg).padStart(2, '0')}:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round_d1',?,?)`).run(leg, race);
    db.prepare(`INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES (?,?,?,?,?,?,?,1,0,2140,0)`).run(entry, race, horse, driver, trainer, leg, leg);
    const raceFields = JSON.stringify({ raceNumber: leg, distanceM: 2140, startMethod: 'auto', scheduledStartAt: `2099-01-02T12:${String(9 + leg).padStart(2, '0')}:00Z`, trackExternalId: String(100 + leg), status: 'upcoming' });
    const entryFields = JSON.stringify({ startNumber: leg, postPosition: leg, startTier: 1, handicapM: 0, actualStartDistanceM: 2140, scratched: false, scratchSemanticsVerified: true, horseExternalId: String(200 + leg), driverExternalId: String(300 + leg), trainerExternalId: String(400 + leg) });
    db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')`).run(`obs_race_${leg}`, race, raceFields);
    db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')`).run(`obs_entry_${leg}`, entry, entryFields);
  }
}

test('D1 as-of guard passes current target state and rejects later-state leakage into replay', async () => {
  const { env, db } = createTestEnv();
  seedAsOfRound(db);
  const clean = await assertAnalysisPackReplaySafe(env, 'round_d1', '2099-01-02T11:30:00Z');
  assert.equal(clean.checked_entries, 8);
  assert.equal(clean.checked_races, 8);
  assert.equal(clean.as_of, '2099-01-02T11:30:00.000Z');

  db.prepare(`UPDATE race_entries SET actual_lane=9 WHERE id='entry_1'`).run();
  db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES ('obs_entry_1_after','race_entry','entry_1','official_after','2099-01-02T12:05:00Z',?,'normalized_verified_subset')`).run(JSON.stringify({ startNumber: 1, postPosition: 9, startTier: 1, handicapM: 0, actualStartDistanceM: 2140, scratched: false, scratchSemanticsVerified: true, horseExternalId: '201', driverExternalId: '301', trainerExternalId: '401' }));

  await assert.rejects(
    () => assertAnalysisPackReplaySafe(env, 'round_d1', '2099-01-02T12:10:00Z'),
    /refusing a potentially contaminated replay.*actual_lane/
  );
});
