import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_PACK_V3_CONTRACT,
  assertAnalysisPackMarketBlind,
  buildAnalysisPackV3Files,
  createPreMarketAnalysisPackV3,
  createAnalysisPackV3Response,
  findAnalysisPackMarketLeaks
} from '../src/analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from '../src/analysis-pack-v3-asof-guard.js';
import { persistAnalysisFormSnapshots } from '../src/analysis-form-snapshot-v1.js';
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
  assert.deepEqual(first.manifest.source_freshness, { official_current: AS_OF });
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

  const leak = {
    nested: { bettingPercent: 12.4, betDistribution: { favorite: 42 }, streckPercent: 33 },
    deeper: [{ winnerOdds: 4.2 }, { recommended: true }],
    turnoverSek: 1000
  };
  const paths = findAnalysisPackMarketLeaks(leak);
  assert.ok(paths.some((path) => path.endsWith('.bettingPercent')));
  assert.ok(paths.some((path) => path.endsWith('.betDistribution')));
  assert.ok(paths.some((path) => path.endsWith('.streckPercent')));
  assert.ok(paths.some((path) => path.endsWith('.winnerOdds')));
  assert.ok(paths.some((path) => path.endsWith('.recommended')));
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
    const raceFields = JSON.stringify({ date: '2099-01-02', raceNumber: leg, distanceM: 2140, startMethod: 'auto', scheduledStartAt: `2099-01-02T12:${String(9 + leg).padStart(2, '0')}:00Z`, trackExternalId: String(100 + leg), status: 'upcoming' });
    const entryFields = JSON.stringify({ startNumber: leg, postPosition: leg, startTier: 1, handicapM: 0, actualStartDistanceM: 2140, scratched: false, scratchSemanticsVerified: true, horseExternalId: String(200 + leg), driverExternalId: String(300 + leg), trainerExternalId: String(400 + leg) });
    db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')`).run(`obs_race_${leg}`, race, raceFields);
    db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')`).run(`obs_entry_${leg}`, entry, entryFields);
  }
}

test('admin Step 1 pack response freezes Form snapshots for the exported pack', async () => {
  const { env, db } = createTestEnv();
  seedAsOfRound(db);
  const response = await createAnalysisPackV3Response(env,'round_d1',{asOf:'2099-01-02T11:30:00Z'});
  assert.equal(response.status,200);
  const manifest = await response.json();
  const rows = db.prepare('SELECT game_round_id,step1_pack_id,as_of,form_version,used_starts FROM analysis_entry_form_snapshots ORDER BY leg_number').all();
  assert.equal(rows.length,8);
  assert.equal(new Set(rows.map(row=>row.step1_pack_id)).size,1);
  assert.equal(rows[0].step1_pack_id,manifest.pack_id);
  assert.equal(rows[0].game_round_id,'round_d1');
  assert.equal(rows[0].as_of,manifest.as_of);
  assert.equal(rows[0].form_version,'horse-form-index-v1');
  assert.equal(rows[0].used_starts,0);
});

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


test('D1 Step 1 excludes editorial and interview signals entirely', async () => {
  const { env, db } = createTestEnv();
  seedAsOfRound(db);
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('editorial-step1','editorial_manual','synthetic','2099-01-02T11:10:00Z','manual_structured')").run();

  db.prepare("INSERT INTO editorial_items (id,race_entry_id,horse_id,speaker_name,speaker_role,published_at,source_name,rights_status,source_record_id) VALUES ('editorial-trainer','entry_1','horse_1','Synthetic Trainer','trainer','2099-01-02T11:05:00Z','Synthetic','structured_only','editorial-step1')").run();
  db.prepare("INSERT INTO editorial_signals (id,editorial_item_id,signal_type,value_text,polarity,fact_or_opinion,confidence) VALUES ('signal-trainer','editorial-trainer','tactics','offensive','positive','opinion',0.8)").run();

  const pack = await createPreMarketAnalysisPackV3(env,'round_d1',{asOf:'2099-01-02T11:30:00Z'});
  const leg1 = pack.files.find((file) => file.name === '01_leg_1.json').payload;
  const signals = leg1.entries.find((entry) => entry.race_entry_id === 'entry_1').current_signals;
  assert.deepEqual(signals, []);
  assert.equal(Object.hasOwn(pack.manifest.source_family_coverage, 'editorial_signals'), false);
  assert.equal(Object.hasOwn(pack.manifest.source_freshness, 'editorial'), false);
});


function seedWideStep1Round(db) {
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('wide_track','Wide Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('wide_round','V85','2099-02-01','2099-02-01T13:00:00Z','2099-02-01T12:55:00Z','upcoming')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('wide_official','official_provider','game:wide_round','2099-02-01T11:00:00Z','wide-hash','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('wide_official_future','official_provider','game:wide_round:future','2099-02-01T12:00:00Z','wide-future-hash','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('wide_editorial','editorial_manual','wide-editorial','2099-02-01T11:05:00Z','wide-editorial-hash','manual_structured')`).run();

  const counts = [16,16,16,16,16,16,16,16];
  let serial = 0;
  for (let leg = 1; leg <= 8; leg += 1) {
    const race = `wide_race_${leg}`;
    db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?,'wide_track','2099-02-01',?, ?,2140,'auto','upcoming')`)
      .run(race, leg, `2099-02-01T13:${String(leg).padStart(2,'0')}:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('wide_round',?,?)`).run(leg,race);
    const raceFields = JSON.stringify({ date:'2099-02-01', raceNumber:leg, distanceM:2140, startMethod:'auto', scheduledStartAt:`2099-02-01T13:${String(leg).padStart(2,'0')}:00Z`, status:'upcoming' });
    db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'wide_official','2099-02-01T11:00:00Z',?,'normalized_verified_subset')`)
      .run(`wide_obs_race_${leg}`,race,raceFields);

    for (let start = 1; start <= counts[leg - 1]; start += 1) {
      serial += 1;
      const horse = `wide_horse_${serial}`;
      const driver = `wide_driver_${serial}`;
      const trainer = `wide_trainer_${serial}`;
      const entry = `wide_entry_${serial}`;
      db.prepare(`INSERT INTO horses (id,canonical_name) VALUES (?,?)`).run(horse,`Wide Horse ${serial}`);
      db.prepare(`INSERT INTO drivers (id,canonical_name) VALUES (?,?)`).run(driver,`Wide Driver ${serial}`);
      db.prepare(`INSERT INTO trainers (id,canonical_name) VALUES (?,?)`).run(trainer,`Wide Trainer ${serial}`);
      db.prepare(`INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES (?,?,?,?,?,?,?,1,0,2140,0)`)
        .run(entry,race,horse,driver,trainer,start,start);
      const entryFields = JSON.stringify({ startNumber:start, postPosition:start, startTier:1, handicapM:0, actualStartDistanceM:2140, scratched:false, scratchSemanticsVerified:true, horseName:`Wide Horse ${serial}`, driverName:`Wide Driver ${serial}`, trainerName:`Wide Trainer ${serial}` });
      db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'wide_official','2099-02-01T11:00:00Z',?,'normalized_verified_subset')`)
        .run(`wide_obs_entry_${serial}`,entry,entryFields);
      db.prepare(`INSERT INTO editorial_items (id,race_entry_id,horse_id,speaker_name,speaker_role,published_at,source_name,rights_status,source_record_id) VALUES (?,?,?,?, 'trainer','2099-02-01T11:02:00Z','Synthetic','structured_only','wide_editorial')`)
        .run(`wide_editorial_item_${serial}`,entry,horse,`Trainer ${serial}`);
      db.prepare(`INSERT INTO editorial_signals (id,editorial_item_id,signal_type,value_text,polarity,fact_or_opinion,confidence) VALUES (?,?, 'tactics','normal','neutral','fact',0.7)`)
        .run(`wide_editorial_signal_${serial}`,`wide_editorial_item_${serial}`);
    }
  }
  for (let leg = 1; leg <= 8; leg += 1) {
    const historyRace = `wide_history_race_${leg}`;
    const officialSource = `wide_history_official_${leg}`;
    const xlabsSource = `wide_history_xlabs_${leg}`;
    db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES (?,'official_provider',?,'2099-01-20T15:00:00Z',?,'normalized_verified_subset')`)
      .run(officialSource,`history:${leg}`,`history-official-hash-${leg}`);
    db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES (?,'xlabs_race_json',?,'2099-01-20T15:05:00Z',?,'normalized_verified_subset')`)
      .run(xlabsSource,`history-xlabs:${leg}`,`history-xlabs-hash-${leg}`);
    db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,field_size,race_name,main_class,status,source_quality) VALUES (?,'wide_track','2099-01-20',? ,?,2140,'auto',16,'Synthetic history','Klass I','result','normalized_verified_subset')`)
      .run(historyRace,leg,`2099-01-20T13:${String(leg).padStart(2,'0')}:00Z`);

    for (let start = 1; start <= 16; start += 1) {
      const index = (leg - 1) * 16 + start;
      const historyEntry = `wide_history_entry_${index}`;
      db.prepare(`INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched,data_quality) VALUES (?,?,?,?,?,?,?,?,?,?,0,'synthetic')`)
        .run(historyEntry,historyRace,`wide_horse_${index}`,`wide_driver_${index}`,`wide_trainer_${index}`,start,start,1,0,2140);
      db.prepare(`INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status,source_record_id) VALUES (?,?,?,?, 'official',?)`)
        .run(historyEntry,start,start % 13 === 0 ? 1 : 0,0,officialSource);
      db.prepare(`INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,verification_status,source_record_id) VALUES (?,?, 'shod','shod',0,0,'standard','reported',?)`)
        .run(`wide_history_equipment_${index}`,historyEntry,officialSource);
      db.prepare(`INSERT INTO xlabs_intervals
        (id,race_entry_id,source_record_id,interval_start_m,interval_end_m,elapsed_ms,km_pace_ms,
         measured_distance_m,local_target_frame_count,local_window_frame_count,local_frame_coverage,
         eligibility_status,mapper_version)
        VALUES (?,?,?,0,100,7200,72000,100,11,11,1,'valid','xlabs-intervals-v2')`)
        .run(`wide_history_interval_${index}`,historyEntry,xlabsSource);
      db.prepare(`INSERT INTO xlabs_data (id,race_entry_id,first_200_time,last_400_time,actual_distance_m,extra_distance_m,quality_status,source_record_id)
        VALUES (?,?,'1.12,0 min/km','1.11,0 min/km',2160,20,'xlabs-telemetry-v1',?)`)
        .run(`wide_history_xlabs_data_${index}`,historyEntry,xlabsSource);
      db.prepare(`INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,verification_status,source_record_id) VALUES (?,?, 'shod','shod',0,0,'standard','reported','wide_official')`)
        .run(`wide_current_equipment_${index}`,`wide_entry_${index}`);
    }
  }

  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('wide_xlabs_future','xlabs_race_json','wide-future-xlabs','2099-02-01T12:00:00Z','wide-future-xlabs-hash','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,verification_status,source_record_id)
    VALUES ('wide_future_equipment','wide_history_entry_1','barefoot','barefoot',1,1,'american','reported','wide_official_future')`).run();
  db.prepare(`INSERT INTO xlabs_intervals
    (id,race_entry_id,source_record_id,interval_start_m,interval_end_m,elapsed_ms,km_pace_ms,
     measured_distance_m,local_target_frame_count,local_window_frame_count,local_frame_coverage,
     eligibility_status,mapper_version)
    VALUES ('wide_future_interval','wide_history_entry_1','wide_xlabs_future',0,100,6000,60000,100,11,11,1,'valid','xlabs-intervals-v2')`).run();

  db.prepare(`INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES ('wide_obs_entry_future', 'race_entry', 'wide_entry_1', 'wide_official_future','2099-02-01T12:00:00Z',?,'normalized_verified_subset')`)
    .run(JSON.stringify({ startNumber:1, postPosition:99, startTier:1, handicapM:0, actualStartDistanceM:2140, scratched:false, scratchSemanticsVerified:true }));
  assert.equal(serial,128);
}

test('D1 Step 1 handles a full 128-entry round without truncation, market leakage or post-as-of leakage', async () => {
  const { env, db, d1Metrics } = createTestEnv();
  seedWideStep1Round(db);
  db.prepare(`INSERT INTO race_positions
    (id,race_entry_id,observed_at_m,leader,event_json,source_record_id,evidence_type,confidence,classification_version)
    VALUES ('wide_trip_1','wide_history_entry_1',500,1,?,'wide_history_xlabs_1','calculated_xlabs',0.95,'xlabs-trip-classification-v1')`)
    .run(JSON.stringify({ scenario_key:'leader', scenario_label:'Spets' }));

  const pack = await createPreMarketAnalysisPackV3(env,'wide_round',{asOf:'2099-02-01T11:30:00Z'});
  await persistAnalysisFormSnapshots(env,pack);
  assert.ok(
    d1Metrics.statements < 600,
    `production-sized Step 1 export exceeded D1 statement budget: ${d1Metrics.statements}`
  );
  const legFiles = pack.files.filter((file) => /^\d{2}_leg_\d/.test(file.name));
  const entries = legFiles.flatMap((file) => file.payload.entries || []);

  assert.equal(legFiles.length,8);
  assert.equal(entries.length,128);
  assert.equal(new Set(entries.map((entry) => entry.race_entry_id)).size,128);
  assert.equal(new Set(entries.map((entry) => entry.current_facts.driver.id)).size,128);
  assert.equal(new Set(entries.map((entry) => entry.current_facts.trainer.id)).size,128);
  assert.equal(entries.filter((entry) => (entry.current_signals || []).length > 0).length,0);
  assert.equal(entries.find((entry) => entry.race_entry_id === 'wide_entry_1').current_facts.actual_lane,1);
  assert.equal(entries.filter((entry) => entry.history_selection?.counts?.totalSafe === 1).length,128);
  assert.equal(entries.filter((entry) => entry.relevant_history?.length === 1).length,128);
  assert.equal(entries.find((entry) => entry.race_entry_id === 'wide_entry_1').relevant_history[0].trip_scenario_500m_remaining.scenario_key,'leader');
  assert.ok(legFiles.every((file) => file.payload.track_analysis?.contract_version === 'kentaurai-track-analysis-v1'));
  assert.equal(pack.manifest.source_family_coverage.trip_scenario_selected_history.observed,1);
  assert.equal(entries.filter((entry) => entry.xlabs?.evidence_profile?.features?.opening_100_km_pace_ms?.measurement_depth?.measured_starts === 1).length,128);
  assert.equal(entries.filter((entry) => entry.features?.person_context?.driver?.baseline_365d?.starts === 1).length,128);
  assert.equal(entries.filter((entry) => entry.features?.race_priors?.priors?.race_outcome?.win_rate?.sample_size > 0).length,128);
  assert.equal(pack.manifest.source_family_coverage.relevant_history.observed,128);
  assert.equal(pack.manifest.source_family_coverage.xlabs_measured_history.observed,128);
  assert.equal(Object.hasOwn(pack.manifest.source_family_coverage,'editorial_signals'),false);
  assert.equal(pack.manifest.contains_current_market,false);
  assert.equal(pack.files.some((file) => file.content.includes('wide_official_future')),false);
  assert.equal(pack.files.some((file) => file.content.includes('wide_xlabs_future')),false);
  for (const file of pack.files) assert.equal(findAnalysisPackMarketLeaks(file.payload).length,0);
});
