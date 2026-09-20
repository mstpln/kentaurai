import test from 'node:test';
import assert from 'node:assert/strict';

import { getHorseTopSpeedProfile } from '../src/statistics/horse-top-speed.js';
import { XLABS_INTERVALS_V2_VERSION } from '../src/xlabs-intervals-v2.js';
import { createTestEnv } from './helpers/d1.js';

function source(db, id, fetchedAt) {
  db.prepare(`INSERT INTO source_records
    (id, source_type, fetched_at, quality_status)
    VALUES (?, 'xlabs_race_json', ?, 'normalized_verified_subset')`).run(id, fetchedAt);
}

function addIntervals(db, entryId, sourceId, msPer100) {
  for (let start = 0; start < 500; start += 100) {
    db.prepare(`INSERT INTO xlabs_intervals
      (id,race_entry_id,source_record_id,interval_start_m,interval_end_m,elapsed_ms,km_pace_ms,measured_distance_m,
       local_target_frame_count,local_window_frame_count,local_frame_coverage,start_endpoint_error_m,end_endpoint_error_m,
       eligibility_status,mapper_version)
      VALUES (?,?,?,?,?,?,?,?,10,10,1,0,0,'valid',?)`)
      .run(`${entryId}-${sourceId}-${start}`, entryId, sourceId, start, start + 100, msPer100, msPer100 * 10, 100, XLABS_INTERVALS_V2_VERSION);
  }
}

test('horse top speed uses fastest verified opening segments and whole-race closing measurements', async () => {
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('t','Test','SE')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('h','Testhäst')").run();

  for (const [raceId, entryId, date, number] of [
    ['r1','e1','2026-08-01',1],
    ['r2','e2','2026-08-10',2]
  ]) {
    db.prepare(`INSERT INTO races
      (id,track_id,race_date,race_number,distance_m,start_method,status)
      VALUES (?,'t',?,?,2140,'auto','results')`).run(raceId, date, number);
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_start_distance_m,scratched)
      VALUES (?,?, 'h',1,2140,0)`).run(entryId, raceId);
  }

  source(db, 'x1', '2026-08-01T20:00:00Z');
  source(db, 'x2', '2026-08-10T20:00:00Z');
  addIntervals(db, 'e1', 'x1', 7000);
  addIntervals(db, 'e2', 'x2', 6500);

  db.prepare(`INSERT INTO xlabs_data
    (id,race_entry_id,last_400_time,last_1000_time,quality_status,source_record_id)
    VALUES ('v1e1','e1','1.08,0 min/km','1.10,0 min/km','xlabs-telemetry-v1','x1')`).run();
  db.prepare(`INSERT INTO xlabs_data
    (id,race_entry_id,last_400_time,last_1000_time,quality_status,source_record_id)
    VALUES ('v1e2','e2','1.06,0 min/km','1.07,0 min/km','xlabs-telemetry-v1','x2')`).run();

  const profile = await getHorseTopSpeedProfile(env, 'h', '2026-09-01');
  assert.equal(profile.first100.bestSecondsPerKm, 65);
  assert.equal(profile.first200.bestSecondsPerKm, 65);
  assert.equal(profile.first500.bestSecondsPerKm, 65);
  assert.equal(profile.last400.bestSecondsPerKm, 66);
  assert.equal(profile.last1000.bestSecondsPerKm, 67);
  assert.equal(profile.first500.measurements, 2);
  assert.equal(profile.last1000.measurements, 2);
});

test('horse top speed ignores future X-Labs sources', async () => {
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('t','Test','SE')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('h','Testhäst')").run();
  db.prepare(`INSERT INTO races
    (id,track_id,race_date,race_number,distance_m,start_method,status)
    VALUES ('r','t','2026-08-01',1,2140,'auto','results')`).run();
  db.prepare(`INSERT INTO race_entries
    (id,race_id,horse_id,start_number,actual_start_distance_m,scratched)
    VALUES ('e','r','h',1,2140,0)`).run();

  source(db, 'old', '2026-08-01T20:00:00Z');
  source(db, 'future', '2026-10-01T20:00:00Z');
  addIntervals(db, 'e', 'old', 7000);
  addIntervals(db, 'e', 'future', 5000);

  const profile = await getHorseTopSpeedProfile(env, 'h', '2026-09-01');
  assert.equal(profile.first100.bestSecondsPerKm, 70);
  assert.equal(profile.first100.measurements, 1);
});
