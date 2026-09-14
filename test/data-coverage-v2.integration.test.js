import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataCoverageReport } from '../src/data-coverage-v2.js';
import { createTestEnv } from './helpers/d1.js';

function seedContextualCoverage(db) {
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status)
    VALUES ('v2_source','xlabs_race_json','synthetic','2026-01-01T10:00:00Z','normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('v2_track','Synthetic Coverage Track','SE')`).run();
  db.prepare(`INSERT INTO horses (id,canonical_name) VALUES ('v2_horse_1','Synthetic One'),('v2_horse_2','Synthetic Two')`).run();
  db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,race_name,status)
    VALUES
      ('v2_volt','v2_track','2026-01-01',1,2140,'volt','Synthetic volt','completed'),
      ('v2_auto','v2_track','2026-01-01',2,1640,'auto','Synthetic auto','completed')`).run();
  db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_lane,start_tier,springspar,actual_start_distance_m,scratched,data_quality)
    VALUES
      ('v2_entry_volt','v2_volt','v2_horse_1',1,1,1,1,2140,0,'normalized_verified_subset'),
      ('v2_entry_auto','v2_auto','v2_horse_2',1,1,NULL,NULL,1640,0,'normalized_verified_subset')`).run();
  db.prepare(`UPDATE race_entries SET back_row=0 WHERE id='v2_entry_auto'`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id)
    VALUES ('v2_entry_volt',1,'official','v2_source'),('v2_entry_auto',1,'official','v2_source')`).run();
  db.prepare(`INSERT INTO xlabs_data
      (id,race_entry_id,actual_distance_m,extra_distance_m,segments_json,quality_status,source_record_id)
    VALUES ('v2_xlabs','v2_entry_volt',2142,2,'{"version":"xlabs-telemetry-v1"}','xlabs-telemetry-v1','v2_source')`).run();
}

test('coverage v2 uses contextual denominators and quantifies X-Labs selection bias', async () => {
  const { env, db } = createTestEnv();
  seedContextualCoverage(db);

  const report = await buildDataCoverageReport(env, '2026-01-02T10:00:00Z');
  const contextual = report.coverage.contextual_eligibility;
  assert.equal(report.contract_version, 'kentaurai-data-coverage-v2');
  assert.equal(contextual.populations.active_entries, 2);
  assert.equal(contextual.populations.volt_entries, 1);
  assert.equal(contextual.populations.auto_entries, 1);
  assert.equal(contextual.fields.start_tier.eligible, 1);
  assert.equal(contextual.fields.start_tier.percent, 100);
  assert.equal(contextual.fields.springspar.eligible, 1);
  assert.equal(contextual.fields.back_row.eligible, 1);
  assert.equal(contextual.fields.back_row.percent, 100);

  const byMethod = Object.fromEntries(report.coverage.xlabs_selection_bias.by_start_method.map((row) => [row.bucket, row]));
  assert.equal(byMethod.volt.percent, 100);
  assert.equal(byMethod.auto.percent, 0);
  assert.equal(report.coverage.xlabs_selection_bias.horse_measurement_depth.at_least_1_measured_start.percent, 50);
  assert.equal(report.coverage.xlabs_selection_bias.tracks.track_count, 1);
  assert.equal(report.coverage.xlabs_selection_bias.tracks.by_track_anonymous[0].track_bucket, 'anonymous_track_01');

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('v2_track'), false);
  assert.equal(serialized.includes('Synthetic Coverage Track'), false);
  assert.equal(serialized.includes('v2_horse_1'), false);
});

test('coverage v2 exposes classified failed-job diagnostics without mutating the cursor or raw error', async () => {
  const { env, db } = createTestEnv();
  const privateError = 'HTTP 503 from https://private.invalid/race/private-race-id';
  db.prepare(`INSERT INTO xlabs_backfill_jobs
    (id,scope,start_date,end_date,next_date,next_race_index,status,processed_dates,processed_races,reused_races,
     unavailable_dates,unavailable_races,consecutive_errors,last_error,last_run_at,retry_after)
    VALUES ('private-job-id','historical_all','2025-01-01','2025-12-31','2025-08-03',7,'failed',150,900,12,4,31,3,?,
      '2026-01-02T09:00:00Z','2026-01-02T10:00:00Z')`).run(privateError);

  const before = db.prepare(`SELECT next_date,next_race_index,status,consecutive_errors,last_error,retry_after
    FROM xlabs_backfill_jobs WHERE id='private-job-id'`).get();
  const report = await buildDataCoverageReport(env, '2026-01-02T10:00:00Z');
  const after = db.prepare(`SELECT next_date,next_race_index,status,consecutive_errors,last_error,retry_after
    FROM xlabs_backfill_jobs WHERE id='private-job-id'`).get();

  assert.deepEqual(after, before);
  const diagnostic = report.backfills.diagnostics.xlabs[0];
  assert.equal(diagnostic.status, 'failed');
  assert.equal(diagnostic.next_date, '2025-08-03');
  assert.equal(diagnostic.next_race_index, 7);
  assert.equal(diagnostic.last_error_category, 'source_transport_failure');
  assert.equal(report.backfills.diagnostics.failed_job_count, 1);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('private-job-id'), false);
  assert.equal(serialized.includes('private.invalid'), false);
  assert.equal(serialized.includes('private-race-id'), false);
});

test('coverage v2 skips a completed same-day round when a later round is still upcoming', async () => {
  const { env, db } = createTestEnv();
  seedContextualCoverage(db);
  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code)
    VALUES ('round_track','Synthetic Round Track','SE')`).run();
  db.prepare(`INSERT INTO horses (id,canonical_name)
    VALUES ('round_horse_done','Synthetic Done'),('round_horse_next','Synthetic Next')`).run();
  db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,race_name,status)
    VALUES
      ('round_race_done','round_track','2026-09-14',1,2140,'auto','Synthetic completed round race','completed'),
      ('round_race_next','round_track','2026-09-14',2,2140,'auto','Synthetic upcoming round race','scheduled')`).run();
  db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_start_distance_m,scratched,data_quality)
    VALUES
      ('round_entry_done','round_race_done','round_horse_done',1,2140,0,'normalized_verified_subset'),
      ('round_entry_next','round_race_next','round_horse_next',1,2140,0,'normalized_verified_subset')`).run();
  db.prepare(`INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id)
    VALUES ('round_entry_done',1,'official','v2_source')`).run();
  db.prepare(`INSERT INTO game_rounds
      (id,game_type,round_date,primary_track_id,scheduled_start_at,status)
    VALUES
      ('round_done','V85','2026-09-14','round_track','2026-09-14T08:00:00Z','completed'),
      ('round_next','V86','2026-09-14','round_track','2026-09-14T17:00:00Z','scheduled')`).run();
  db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id)
    VALUES ('round_done',1,'round_race_done'),('round_next',1,'round_race_next')`).run();

  const report = await buildDataCoverageReport(env, '2026-09-14T10:00:00Z');
  const current = report.coverage.current_round_participants;
  assert.equal(current.status, 'available');
  assert.equal(current.game_type, 'V86');
  assert.equal(current.round_date, '2026-09-14');
  assert.equal(current.leg_count, 1);
  assert.equal(current.active_entries, 1);
});
