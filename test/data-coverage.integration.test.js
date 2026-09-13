import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v065.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

async function sessionCookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

function seedCoverageData(db) {
  db.prepare(`
    INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES ('coverage_source', 'official_provider', 'race:coverage_race', '2026-09-13T10:00:00Z', 'verified')
  `).run();
  db.prepare(`
    INSERT INTO tracks (
      id, canonical_name, country_code, lap_length_m, home_stretch_m, surface,
      open_stretch_lanes, angled_mobile_wing
    ) VALUES ('coverage_track', 'Private Synthetic Track', 'SE', 1000, 200, 'synthetic', 1, 0)
  `).run();
  db.prepare(`INSERT INTO trainers (id, canonical_name) VALUES ('coverage_trainer','Private Trainer')`).run();
  db.prepare(`INSERT INTO drivers (id, canonical_name, home_track_id) VALUES ('coverage_driver','Private Driver','coverage_track')`).run();
  db.prepare(`
    INSERT INTO horses (id, canonical_name, sex, career_earnings_sek, current_start_points, current_start_points_observed_at, current_start_points_source_record_id)
    VALUES ('coverage_horse','Private Horse','mare',500000,1234,'2026-09-13T10:00:00Z','coverage_source')
  `).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('coverage_scratched_horse','Private Scratched Horse')`).run();
  db.prepare(`
    INSERT INTO races (
      id, track_id, race_date, race_number, distance_m, start_method, field_size, starters_declared,
      first_prize_sek, race_name, status
    ) VALUES ('coverage_race','coverage_track','2026-09-13',1,2140,'auto',2,2,100000,'Klass I - synthetic','completed')
  `).run();
  db.prepare(`
    INSERT INTO race_entries (
      id, race_id, horse_id, driver_id, trainer_id, source_start_id, start_number, actual_lane,
      actual_start_distance_m, scratched, data_quality
    ) VALUES (
      'coverage_entry','coverage_race','coverage_horse','coverage_driver','coverage_trainer','coverage_start',1,1,
      2140,0,'normalized_verified_subset'
    )
  `).run();
  db.prepare(`
    INSERT INTO race_entries (
      id, race_id, horse_id, source_start_id, start_number, scratched, data_quality
    ) VALUES (
      'coverage_scratched_entry','coverage_race','coverage_scratched_horse','coverage_scratched_start',2,1,'normalized_verified_subset'
    )
  `).run();
  db.prepare(`
    INSERT INTO race_results (
      race_entry_id, placing, km_time, prize_sek, gallop, disqualified, official_odds, result_status, source_record_id
    ) VALUES ('coverage_entry',1,'1.12,3',100000,0,0,2.5,'official','coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO equipment (
      id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear,
      sulky_type, change_from_previous_json, verification_status, source_record_id
    ) VALUES (
      'coverage_equipment','coverage_entry','shoes','shoes',0,0,'standard','{}','verified','coverage_source'
    )
  `).run();
  db.prepare(`
    INSERT INTO xlabs_data (
      id, race_entry_id, first_200_time, last_400_time, actual_distance_m, extra_distance_m,
      segments_json, quality_status, source_record_id
    ) VALUES (
      'coverage_xlabs','coverage_entry','00:15.0','00:28.0',2142,2,
      '[{"distanceM":100,"time":"00:07.5"}]','verified','coverage_source'
    )
  `).run();
  db.prepare(`
    INSERT INTO horse_start_points (id, horse_id, points, observed_at, race_entry_id, source_record_id)
    VALUES ('coverage_points','coverage_horse',1234,'2026-09-13T10:00:00Z','coverage_entry','coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO normalized_observations (
      id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status
    ) VALUES (
      'coverage_observation','race','coverage_race','coverage_source','2026-09-13T10:00:00Z',
      '{"prizeText":"Pris: 100.000-50.000","terms":["Synthetic term"]}','normalized_verified_subset'
    )
  `).run();
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, primary_track_id, bet_stop_at, status)
    VALUES ('coverage_round','V85','2026-09-13','coverage_track','2026-09-13T12:00:00Z','completed')
  `).run();
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES ('coverage_round',1,'coverage_race')`).run();
  db.prepare(`
    INSERT INTO betting_snapshots (
      id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id
    ) VALUES ('coverage_bet','coverage_round',1,'coverage_entry','2026-09-13T10:00:00Z',50,1,'coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO betting_snapshots (
      id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id
    ) VALUES ('coverage_scratched_bet','coverage_round',1,'coverage_scratched_entry','2026-09-13T10:00:00Z',10,2,'coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds, source_record_id)
    VALUES ('coverage_odds','coverage_entry','2026-09-13T10:00:00Z','win',2.5,'coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds, source_record_id)
    VALUES ('coverage_scratched_odds','coverage_scratched_entry','2026-09-13T10:00:00Z','win',9.9,'coverage_source')
  `).run();
  db.prepare(`
    INSERT INTO analysis_features (id, race_entry_id, feature_version, as_of, feature_name, numeric_value)
    VALUES ('coverage_feature','coverage_entry','form-v2','2026-09-13T09:00:00Z','synthetic_score',1)
  `).run();
  db.prepare(`
    INSERT INTO analysis_features (id, race_entry_id, feature_version, as_of, feature_name, numeric_value)
    VALUES ('coverage_scratched_feature','coverage_scratched_entry','form-v2','2026-09-13T09:00:00Z','synthetic_score',1)
  `).run();
}

test('data coverage export is private', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app/api/settings/data-coverage'), env);
  assert.equal(response.status, 401);
});

test('data coverage export reports aggregate coverage without row-level private data', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedCoverageData(db);
  const cookie = await sessionCookie(env);
  const response = await worker.fetch(new Request('https://example.test/app/api/settings/data-coverage', { headers: { cookie } }), env);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.match(response.headers.get('content-disposition'), /kentaurai-data-coverage_\d{4}-\d{2}-\d{2}\.json/);
  const text = await response.text();
  const report = JSON.parse(text);

  assert.equal(report.contract_version, 'kentaurai-data-coverage-v1');
  assert.equal(report.population.races, 1);
  assert.equal(report.population.completed_races, 1);
  assert.equal(report.population.non_scratched_entries, 1);
  assert.equal(report.coverage.races.distance_m.percent, 100);
  assert.equal(report.coverage.races.starters_declared.percent, 100);
  assert.equal(report.coverage.game_rounds.bet_stop_at.percent, 100);
  assert.equal(report.coverage.horses.career_earnings_sek.covered, 1);
  assert.equal(report.coverage.race_results.km_time.percent, 100);
  assert.equal(report.coverage.equipment.completed_entry_coverage.percent, 100);
  assert.equal(report.coverage.xlabs.completed_entry_coverage.percent, 100);
  assert.equal(report.coverage.xlabs.fields.segments_json_valid.percent, 100);
  assert.equal(report.coverage.start_points.horses_with_history.covered, 1);
  assert.equal(report.coverage.market.eligible_v85_v86_entries, 1);
  assert.equal(report.coverage.market.betting_snapshots.rows, 1);
  assert.equal(report.coverage.market.betting_snapshots.entry_coverage.percent, 100);
  assert.equal(report.coverage.market.odds_snapshots.rows, 1);
  assert.equal(report.coverage.market.odds_snapshots.entry_coverage.percent, 100);
  assert.equal(report.coverage.analysis_features.rows, 2);
  assert.equal(report.coverage.analysis_features.any_feature_entry_coverage.percent, 100);
  assert.equal(report.coverage.analysis_features.known_versions['form-v2'].percent, 100);
  assert.equal(report.coverage.classifications.stl_classification.percent, 100);
  assert.equal(report.coverage.normalized_observations.race_prize_text.percent, 100);
  assert.equal(report.coverage.normalized_observations.race_terms.percent, 100);

  for (const privateValue of [
    'Private Synthetic Track','Private Horse','Private Scratched Horse',
    'coverage_horse','coverage_scratched_horse','coverage_race','coverage_source'
  ]) assert.equal(text.includes(privateValue), false);
});
