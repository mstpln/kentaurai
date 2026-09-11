import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getTrainerRankings } from '../src/statistics/trainers.js';

function seed(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-r','Rest Track')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-r','Rest Trainer')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-r','Rest Driver')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-r','Rest Horse','sto',2020,'varmblodig travare')").run();
}
function addRace(db,id,date,{method='auto',lane=1,handicap=0,actual=2140,placing=1,monte=false}={}) {
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES (?, 'track-r', ?, 1, 2140, ?, 50000, 'Rest race', 'verified')").run(id,date,method);
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,handicap_m,actual_start_distance_m,scratched,data_quality) VALUES (?,?,'horse-r','driver-r','trainer-r',1,?,?,?,0,'verified')").run(`entry-${id}`,id,lane,handicap,actual);
  db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,disqualified,result_status) VALUES (?,?,1000,0,0,'official')").run(`entry-${id}`,placing);
  if (monte) db.prepare("INSERT INTO race_type_classifications (race_id,race_type) VALUES (?, 'monte')").run(id);
}

// These assertions protect the Build D rule that filters describe the comeback start,
// while the >=60-day sequence itself is always derived from the horse's full actual-start history.
test('trainer rest rankings apply race type and start method to the comeback start itself', async () => {
  const { db, env } = createTestEnv(); seed(db);
  addRace(db,'old','2026-01-01',{method:'auto'});
  addRace(db,'comeback','2026-04-01',{method:'volt',lane:6,handicap:20,actual:2160,monte:true});
  const matching = await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',raceType:'monte',startMethod:'volt'});
  assert.equal(matching.rankings.firstAfterRest[0]?.id,'trainer-r');
  const wrongType = await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',raceType:'sulky',startMethod:'volt'});
  assert.equal(wrongType.rankings.firstAfterRest.length,0);
  const wrongMethod = await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',raceType:'monte',startMethod:'auto'});
  assert.equal(wrongMethod.rankings.firstAfterRest.length,0);
});

test('trainer rest volt-lane and handicap filters fail closed on non-volt starts', async () => {
  const { db, env } = createTestEnv(); seed(db);
  addRace(db,'old','2026-01-01',{method:'volt'});
  addRace(db,'fake-auto','2026-04-01',{method:'auto',lane:6,handicap:20,actual:2160});
  let data = await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',voltLane:'good'});
  assert.equal(data.rankings.firstAfterRest.length,0,'good lane alone must not make an autostart a volt sample');
  data = await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',handicapM:'20'});
  assert.equal(data.rankings.firstAfterRest.length,0,'distance arithmetic alone must not make an autostart a handicap sample');
});
