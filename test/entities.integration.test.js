import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getEntityDetail, getEntitySummary, listEntities, searchEntities } from '../src/routes/entities.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_1','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_1','Ada Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainer_external_ids (trainer_id, source_type, external_id) VALUES ('trainer_1','official','tr_001')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name, country_code, home_track_id) VALUES ('driver_1','Bertil Driver','SE','track_1')`).run();
  db.prepare(`INSERT INTO driver_external_ids (driver_id, source_type, external_id) VALUES ('driver_1','official','dr_001')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name, sex, owner, current_trainer_id, home_track_id, country_code, career_earnings_sek) VALUES ('horse_1','Comet Horse','gelding','Synthetic Owner','trainer_1','track_1','SE',123456)`).run();
  db.prepare(`INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES ('horse_1','official','ho_001')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_1','track_1','2099-01-02',1,2140,'auto')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, actual_start_distance_m) VALUES ('entry_1','race_1','horse_1','driver_1','trainer_1',3,3,2140)`).run();
}

test('entity summary and search expose normalized read-only data', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const summary = await getEntitySummary(env);
  assert.deepEqual(summary.counts, { horses: 1, trainers: 1, drivers: 1, races: 1, entries: 1, results: 0 });
  assert.equal(summary.trends.available, false);

  const matches = await searchEntities(env, 'Trainer');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'trainer');
  assert.equal(matches[0].name, 'Ada Trainer');
});

test('entity search treats SQL wildcard and escape characters literally', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_2','Percent% Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_3','Under_score Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_4','Back\\slash Trainer','SE')`).run();

  assert.deepEqual((await searchEntities(env, '%')).map((row) => row.name), ['Percent% Trainer']);
  assert.deepEqual((await searchEntities(env, '_')).map((row) => row.name), ['Under_score Trainer']);
  assert.deepEqual((await searchEntities(env, '\\')).map((row) => row.name), ['Back\\slash Trainer']);
});

test('entity lists paginate without exposing internal source ids', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_2','Bea Trainer','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_3','Carl Trainer','SE')`).run();

  const first = await listEntities(env, 'trainers', { limit: 1, offset: 0 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].name, 'Ada Trainer');
  assert.equal(first.total, 3);
  assert.equal(first.limit, 1);
  assert.equal(first.offset, 0);
  assert.equal(first.hasMore, true);
  assert.equal('external_id' in first.items[0], false);

  const second = await listEntities(env, 'trainers', { limit: 1, offset: 1 });
  assert.equal(second.items[0].name, 'Bea Trainer');
  assert.equal(second.total, 3);
  assert.equal(second.offset, 1);
  assert.equal(second.hasMore, true);

  const last = await listEntities(env, 'trainers', { limit: 1, offset: 2 });
  assert.equal(last.items[0].name, 'Carl Trainer');
  assert.equal(last.hasMore, false);
});

test('entity pagination uses stable id tie-breakers for duplicate names', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_3','Same Name','SE')`).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name, country_code) VALUES ('trainer_2','Same Name','SE')`).run();

  const firstSame = await listEntities(env, 'trainers', { q: 'Same Name', limit: 1, offset: 0 });
  const secondSame = await listEntities(env, 'trainers', { q: 'Same Name', limit: 1, offset: 1 });
  assert.equal(firstSame.items[0].id, 'trainer_2');
  assert.equal(secondSame.items[0].id, 'trainer_3');
  assert.equal(firstSame.total, 2);
  assert.equal(firstSame.hasMore, true);
  assert.equal(secondSame.hasMore, false);
});

test('entity details preserve factual nulls and database activity stats', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const horses = await listEntities(env, 'horses');
  assert.equal(horses.items.length, 1);
  assert.equal(horses.items[0].id, 'horse_1');
  assert.equal(horses.items[0].name, 'Comet Horse');

  const horse = await getEntityDetail(env, 'horses', 'horse_1');
  assert.equal(horse.entity.name, 'Comet Horse');
  assert.equal(horse.entity.trainer_name, 'Ada Trainer');
  assert.equal(horse.entity.career_earnings_sek, 123456);
  assert.equal(horse.starts[0].placing, null);

  const trainer = await getEntityDetail(env, 'trainers', 'trainer_1');
  assert.equal(trainer.stats.databaseStarts, 1);
  assert.equal(trainer.stats.linkedHorses, 1);
  assert.equal(trainer.stats.resultStarts, 0);
  assert.equal(trainer.stats.winRate, null);
  assert.equal(trainer.starts[0].horse_name, 'Comet Horse');
});

test('scratched declarations are not counted as starts or performance opportunities', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_2','track_1','2099-01-03',2,2140,'auto')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, scratched, actual_start_distance_m) VALUES ('entry_2','race_2','horse_1','driver_1','trainer_1',4,1,2140)`).run();
  db.prepare(`INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank) VALUES ('bet_scratched','round_missing',1,'entry_2','2099-01-03T10:00:00Z',0.2,2)`).run();

  const detail = await getEntityDetail(env, 'trainers', 'trainer_1');
  assert.equal(detail.stats.databaseStarts, 1);
  assert.equal(detail.stats.scratchedEntries, 1);
  assert.equal(detail.coverage.starts, 1);
  assert.equal(detail.coverage.startsWithMarket, 0);
  assert.equal(detail.breakdowns.startMethods.reduce((sum, row) => sum + row.starts, 0), 1);
});

test('entity detail exposes each existing measurement family with histories and coverage', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  db.prepare(`INSERT INTO source_records (id, source_type, fetched_at, quality_status) VALUES ('src_1','synthetic','2099-01-01T10:00:00Z','verified')`).run();
  db.prepare(`INSERT INTO source_records (id, source_type, fetched_at, quality_status) VALUES ('src_2','synthetic','2099-01-01T11:00:00Z','verified')`).run();
  db.prepare(`INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs_h','horse','horse_1','src_2','2099-01-01T11:00:00Z','{"ageYears":5,"homeTrackName":"Synthetic Track"}','verified')`).run();
  db.prepare(`UPDATE races SET field_size=10, starters_declared=10, first_prize_sek=100000, race_name='Synthetic Cup', main_class='Class A', class_flags_json='{"final":true}', status='finished', source_quality='verified' WHERE id='race_1'`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_1','V85','2099-01-02','finished')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('round_1',1,'race_1')`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, finish_time, km_time, prize_sek, gallop, disqualified, distance_behind_winner_m, official_odds, result_status) VALUES ('entry_1',1,'1','1:14.0','14,0',100000,0,0,0,2.5,'official')`).run();
  db.prepare(`INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank) VALUES ('bet_1','round_1',1,'entry_1','2099-01-01T10:00:00Z',0.30,2)`).run();
  db.prepare(`INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank) VALUES ('bet_2','round_1',1,'entry_1','2099-01-01T11:00:00Z',0.35,1)`).run();
  db.prepare(`INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds) VALUES ('odds_1','entry_1','2099-01-01T10:00:00Z','vinnare',3.0)`).run();
  db.prepare(`INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds) VALUES ('odds_2','entry_1','2099-01-01T11:00:00Z','vinnare',2.5)`).run();
  db.prepare(`INSERT INTO equipment (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear, sulky_type, exact_sulky, change_from_previous_json, verification_status, source_record_id) VALUES ('eq_1','entry_1','shod','shod',0,0,'standard','S1','{"sulkyTypeChanged":false}','reported','src_1')`).run();
  db.prepare(`INSERT INTO equipment (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear, sulky_type, exact_sulky, change_from_previous_json, verification_status, source_record_id) VALUES ('eq_2','entry_1','barefoot','shod',1,0,'bike','B1','{"shoesFrontChanged":true,"sulkyTypeChanged":true}','reported','src_2')`).run();
  db.prepare(`INSERT INTO xlabs_data (id, race_entry_id, last_200_time, last_800_time, actual_distance_m, extra_distance_m, converted_km_time, slipstream_m, segments_json, quality_status, source_record_id) VALUES ('xl_1','entry_1','10.5','44.0',2150,10,'13,9',900,'{"segment":"synthetic"}','verified','src_2')`).run();
  db.prepare(`INSERT INTO race_positions (id, race_entry_id, observed_at_m, position, lane, leader, pocket, death_seat, second_over, third_over, wide_trip, uncovered_move, traffic_event, event_json) VALUES ('pos_1','entry_1',500,1,1,1,0,0,0,0,0,0,'clear','{"tempo":"synthetic"}')`).run();
  db.prepare(`INSERT INTO race_conditions (race_id, track_status, temperature_c, wind_mps, wind_direction, precipitation_mm, weather_text, day_profile_json) VALUES ('race_1','fast',12,3,'W',0,'clear','{"profile":"synthetic"}')`).run();
  db.prepare(`INSERT INTO analysis_features (id, race_entry_id, feature_version, as_of, feature_name, numeric_value, uncertainty_low, uncertainty_high, data_quality, provenance_json) VALUES ('feat_1','entry_1','fv1','2099-01-01T11:00:00Z','synthetic_feature',0.75,0.7,0.8,'verified','{"internal":"synthetic"}')`).run();
  db.prepare(`INSERT INTO model_versions (id, created_at, feature_version, prompt_version, ai_provider, ai_model) VALUES ('mv_1','2099-01-01T11:00:00Z','fv1','pv1','synthetic','synthetic-model')`).run();
  db.prepare(`INSERT INTO ai_race_analyses (id, race_id, model_version_id, data_snapshot_at, market_blind, race_shape_summary, conclusion, data_quality, created_at) VALUES ('analysis_1','race_1','mv_1','2099-01-01T11:00:00Z',1,'Synthetic shape','Synthetic conclusion','verified','2099-01-01T11:00:00Z')`).run();
  db.prepare(`INSERT INTO ai_horse_predictions (id, ai_race_analysis_id, race_entry_id, win_probability, uncertainty_low, uncertainty_high, raw_rank, abcd_group, value_ratio, scenario_robustness, reasoning_json) VALUES ('pred_1','analysis_1','entry_1',0.35,0.30,0.40,1,'A',1.1,0.8,'{"reason":"synthetic"}')`).run();
  db.prepare(`INSERT INTO editorial_items (id, race_entry_id, horse_id, published_at, source_name, summary_text) VALUES ('ed_1','entry_1','horse_1','2099-01-01T09:00:00Z','premium_editorial','Synthetic structured summary')`).run();
  db.prepare(`INSERT INTO editorial_signals (id, editorial_item_id, signal_type, value_text, polarity, strength, fact_or_opinion, confidence, evidence_excerpt) VALUES ('sig_1','ed_1','form','positive','positive',0.8,'opinion',0.7,'Synthetic excerpt')`).run();

  const detail = await getEntityDetail(env, 'horses', 'horse_1');
  assert.equal(detail.latestObservation.fields.ageYears, 5);
  assert.equal(detail.stats.wins, 1);
  assert.equal(detail.stats.v85Starts, 1);
  assert.equal(detail.breakdowns.startMethods[0].wins, 1);
  assert.equal(detail.coverage.startsWithMarket, 1);
  assert.equal(detail.coverage.startsWithOdds, 1);
  assert.equal(detail.coverage.startsWithEquipment, 1);
  assert.equal(detail.coverage.startsWithXLabs, 1);
  assert.equal(detail.coverage.startsWithPositions, 1);
  assert.equal(detail.coverage.startsWithFeatures, 1);
  assert.equal(detail.coverage.startsWithAi, 1);
  assert.equal(detail.coverage.startsWithEditorial, 1);
  assert.equal(detail.coverage.startsWithConditions, 1);

  const start = detail.starts[0];
  assert.equal(start.race_name, 'Synthetic Cup');
  assert.deepEqual(start.class_flags, { final: true });
  assert.equal(start.betting.betPercent, 0.35);
  assert.equal(start.bettingHistory.length, 2);
  assert.equal(start.odds[0].odds, 2.5);
  assert.equal(start.oddsHistory.length, 2);
  assert.equal(start.equipment.sulkyType, 'bike');
  assert.equal(start.equipmentHistory.length, 2);
  assert.deepEqual(start.xlabs.segments, { segment: 'synthetic' });
  assert.equal(start.positions[0].leader, true);
  assert.deepEqual(start.positions[0].event, { tempo: 'synthetic' });
  assert.equal(start.features[0].name, 'synthetic_feature');
  assert.equal(start.aiAnalyses[0].abcdGroup, 'A');
  assert.equal(start.editorialSignals[0].signalType, 'form');
  assert.deepEqual(start.day_profile, { profile: 'synthetic' });
});
