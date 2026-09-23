import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTrackAnalysisV1,
  normalizeTrackAnalysisDistanceGroup,
  normalizeTrackAnalysisStartMethod,
  TRACK_ANALYSIS_CONTRACT
} from '../src/track-analysis-v1.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrackAnalysis(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track-a','Synthetic A','SE')").run();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track-b','Synthetic B','SE')").run();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track-no','Synthetic NO','NO')").run();

  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('src-result','official_provider','synthetic:result','2026-08-31T12:00:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('src-x','xlabs_race_json','synthetic:xlabs','2026-08-31T12:30:00Z','normalized_verified_subset')").run();

  db.prepare(`INSERT INTO track_profile_fact_observations
    (id,track_id,fact_type,numeric_value,evidence_type,source_type,source_url,verified_at,layout_effective_from,status)
    VALUES ('fact-stretch','track-a','home_stretch_m',190,'verified','measurement','https://example.test/track','2026-01-01T10:00:00Z','2026-01-01','active')`).run();

  let horseCounter = 0;
  let raceCounter = 0;
  function addRace(trackId, distance, method, pattern) {
    raceCounter += 1;
    const raceId = `race-${raceCounter}`;
    const day = String((raceCounter % 27) + 1).padStart(2, '0');
    db.prepare('INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES (?,?,?,?,?,?,?)')
      .run(raceId,trackId,`2026-06-${day}`,raceCounter,distance,method,'results');
    for (let lane = 1; lane <= 3; lane += 1) {
      horseCounter += 1;
      const horseId = `horse-${horseCounter}`;
      const entryId = `entry-${horseCounter}`;
      db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(horseId,`Synthetic Horse ${horseCounter}`);
      db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,scratched) VALUES (?,?,?,?,?,0)')
        .run(entryId,raceId,horseId,lane,lane);
      const placing = pattern === 'lane1' ? lane : pattern === 'lane2' ? (lane === 2 ? 1 : lane === 1 ? 2 : 3) : lane;
      db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id) VALUES (?,?,'official','src-result')")
        .run(entryId,placing);

      const rank200 = pattern === 'lane2' ? (lane === 2 ? 1 : lane === 1 ? 2 : 3) : lane;
      const rank100 = lane;
      for (const [checkpointKey,checkpointM,rank] of [['100m',100,rank100],['200m',200,rank200]]) {
        db.prepare(`INSERT INTO race_position_checkpoints
          (id,race_entry_id,source_record_id,checkpoint_key,checkpoint_m,frame_index,observed_at,elapsed_ms,
           leader_progress_m,distance_to_finish_m,position_rank,meters_behind_leader,observed_field_count,
           active_field_size,field_coverage,local_target_coverage,longitudinal_confidence,reconstruction_version)
          VALUES (?,?,?,?,?,1,'2026-06-01T12:00:00Z',10000,?,1940,?,?,3,3,1,1,1,'xlabs-position-reconstruction-v1')`)
          .run(`cp-${checkpointKey}-${entryId}`,entryId,'src-x',checkpointKey,checkpointM,checkpointM,rank,rank === 1 ? 0 : rank * 2);
      }

      const scenarioKey = pattern === 'lane1'
        ? (lane === 1 ? 'leader' : lane === 2 ? 'death_seat' : 'back')
        : (lane === 2 ? 'death_seat' : lane === 1 ? 'leader' : 'back');
      const leader = scenarioKey === 'leader' ? 1 : 0;
      db.prepare(`INSERT INTO race_positions
        (id,race_entry_id,observed_at_m,leader,death_seat,event_json,source_record_id,evidence_type,confidence,classification_version)
        VALUES (?,?,500,?,?,?,'src-x','calculated_xlabs',0.95,'xlabs-trip-classification-v1')`)
        .run(`pos-${entryId}`,entryId,leader,scenarioKey === 'death_seat' ? 1 : 0,JSON.stringify({scenario_key:scenarioKey}));
    }
  }

  for (let i=0;i<12;i+=1) addRace('track-a',2140,'auto','lane1');
  for (let i=0;i<5;i+=1) addRace('track-a',1640,'auto','lane2');
  for (let i=0;i<12;i+=1) addRace('track-b',2140,'auto','lane2');
  for (let i=0;i<5;i+=1) addRace('track-b',1640,'auto','lane1');
  for (let i=0;i<12;i+=1) addRace('track-no',2140,'auto','lane2');
}

test('track analysis filter normalizers accept only agreed public values', () => {
  assert.equal(normalizeTrackAnalysisStartMethod('autostart'),'auto');
  assert.equal(normalizeTrackAnalysisStartMethod('voltstart'),'volt');
  assert.equal(normalizeTrackAnalysisStartMethod('all'),'all');
  assert.equal(normalizeTrackAnalysisDistanceGroup(2148),'2140');
  assert.equal(normalizeTrackAnalysisDistanceGroup('all'),'all');
  assert.throws(() => normalizeTrackAnalysisStartMethod('unknown'));
});

test('track analysis uses 200m lanes and same-country exact-context baseline', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  assert.equal(data.contract_version,TRACK_ANALYSIS_CONTRACT);
  assert.equal(data.analysis_basis.backoff_level,'exact');
  assert.equal(data.selected_sample.races,12);
  assert.equal(data.analysis_basis.sample_status,'limited');
  assert.equal(data.start_position_200m.sections.length,1);
  const lane1=data.start_position_200m.sections[0].rows.find(row=>row.lane===1);
  assert.equal(lane1.observations,12);
  assert.equal(lane1.lead_rate,1);
  assert.equal(lane1.baseline.observations,12);
  assert.equal(lane1.baseline.lead_rate,0);
  assert.equal(lane1.lead_delta_pp,100);
  assert.equal(data.start_position_100m.sections[0].rows.find(row=>row.lane===1).lead_rate,1);
  assert.equal(data.coverage.position_200m.observation_coverage,1);
  assert.equal(data.coverage.trip_scenario.winner_scenario_coverage,1);
  assert.equal(data.analysis_support,null);
  assert.equal(data.track_context.home_stretch_m.value,190);
  const leader=data.trip_scenario_500m_remaining.rows.find(row=>row.scenario_key==='leader');
  assert.equal(leader.wins,12);
  assert.equal(leader.baseline.wins,undefined);
  assert.equal(leader.baseline.winner_share,0);
});


test('track analysis coverage denominators expose missing 200m and winner-scenario evidence', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("DELETE FROM race_position_checkpoints WHERE id='cp-200m-entry-1'").run();
  db.prepare("DELETE FROM race_positions WHERE id='pos-entry-1'").run();
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  assert.equal(data.coverage.eligible.lane_starts,36);
  assert.equal(data.coverage.position_200m.observations,35);
  assert.equal(data.coverage.position_200m.observation_coverage,0.9722);
  assert.equal(data.coverage.eligible.winner_races,12);
  assert.equal(data.coverage.trip_scenario.winners_with_scenario,11);
  assert.equal(data.coverage.trip_scenario.winner_scenario_coverage,0.9167);
});

test('track analysis retains exact sparse metrics while broadening interpretation support', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'1640'});
  assert.equal(data.selected_sample.races,5);
  assert.equal(data.selected_sample.sample_status,'sparse');
  assert.equal(data.analysis_basis.backoff_level,'track_start_method');
  assert.equal(data.analysis_basis.distance_group,'all');
  assert.equal(data.analysis_basis.races,17);
  assert.ok(data.analysis_support);

  const exactLane2=data.start_position_200m.sections[0].rows.find(row=>row.lane===2);
  assert.equal(exactLane2.observations,5);
  assert.equal(exactLane2.lead_rate,1);

  const supportLane1=data.analysis_support.start_position_200m.sections[0].rows.find(row=>row.lane===1);
  assert.equal(supportLane1.observations,17);
  assert.ok(data.short_analysis[0].includes('breddad'));
  assert.equal(data.coverage.trip_scenario.races_with_any_scenario,5);
  assert.equal(data.analysis_support.coverage.trip_scenario.races_with_any_scenario,17);
});

test('track analysis as-of excludes sources that were not available before cutoff', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("UPDATE source_records SET fetched_at='2026-10-01T12:00:00Z' WHERE id='src-x'").run();
  const data=await getTrackAnalysisV1(env,'track-a',{
    startMethod:'auto',
    distanceGroup:'2140',
    asOf:'2026-09-01T10:00:00Z'
  });
  assert.equal(data.selected_sample.races,0);
  assert.equal(data.start_position_200m.sections[0].rows.find(row=>row.lane===1).observations,0);
  assert.equal(data.trip_scenario_500m_remaining.rows.find(row=>row.scenario_key==='leader').starts,0);
});
