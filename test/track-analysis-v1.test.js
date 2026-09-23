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
      for (const [checkpointKey,checkpointM,rank] of [['100m',100,rank100],['200m',200,rank200],['500m',500,rank200]]) {
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

  for (let i=0;i<30;i+=1) addRace('track-a',2140,'auto','lane1');
  for (let i=0;i<5;i+=1) addRace('track-a',1640,'auto','lane2');
  for (let i=0;i<30;i+=1) addRace('track-b',2140,'auto','lane2');
  for (let i=0;i<5;i+=1) addRace('track-b',1640,'auto','lane1');
  for (let i=0;i<30;i+=1) addRace('track-no',2140,'auto','lane2');
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
  assert.equal(data.selected_sample.races,30);
  assert.equal(data.analysis_basis.sample_status,'normal');
  assert.equal(data.start_position_200m.sections.length,1);
  const lane1=data.start_position_200m.sections[0].rows.find(row=>row.lane===1);
  assert.equal(lane1.observations,30);
  assert.equal(lane1.lead_rate,1);
  assert.equal(lane1.baseline.observations,30);
  assert.equal(lane1.baseline.lead_rate,0);
  assert.equal(lane1.lead_delta_pp,100);
  assert.equal(data.start_position_100m.sections[0].rows.find(row=>row.lane===1).lead_rate,1);
  assert.equal(data.coverage.position_200m.observation_coverage,1);
  assert.equal(data.coverage.trip_scenario.winner_scenario_coverage,1);
  assert.equal(data.analysis_support,null);
  const summary=data.short_analysis.join(' ');
  assert.match(summary,/Högst observerad spetsfrekvens efter 200 m har spår 1 \(100 %\)/);
  assert.match(summary,/Jämfört med andra svenska banor/);
  assert.match(summary,/Högst observerad segerprocent har/);
  assert.match(summary,/Hästar som satt i ledningen 500 m efter start vann 100 % av loppen/);
  assert.doesNotMatch(summary,/Bland vinnarna där löpningsscenariot kan klassificeras/i);
  assert.doesNotMatch(summary,/baseline/i);
  assert.doesNotMatch(summary,/observationer/i);
  assert.equal(data.track_context.home_stretch_m.value,190);
  assert.equal(data.track_context.home_stretch_m.evidence_type,'verified');
  assert.equal(data.track_context.home_stretch_m.source_type,'measurement');
  assert.equal(data.track_context.home_stretch_m.verified_at,'2026-01-01T10:00:00Z');
  const leader=data.trip_scenario_500m_remaining.rows.find(row=>row.scenario_key==='leader');
  assert.equal(leader.measurement_point,'500m_after_start');
  assert.equal(leader.measurement_label,'500 m efter start');
  assert.equal(leader.wins,30);
  assert.equal(leader.win_rate,1);
  assert.equal(leader.baseline.wins,undefined);
  assert.equal(leader.baseline.winner_share,1);
});


test('track analysis coverage denominators expose missing 200m and winner-scenario evidence', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("DELETE FROM race_position_checkpoints WHERE id='cp-200m-entry-1'").run();
  db.prepare("DELETE FROM race_positions WHERE id='pos-entry-1'").run();
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  assert.equal(data.coverage.eligible.lane_starts,90);
  assert.equal(data.coverage.position_200m.observations,89);
  assert.equal(data.coverage.position_200m.observation_coverage,0.9889);
  assert.equal(data.coverage.eligible.winner_races,30);
  assert.equal(data.coverage.trip_scenario.winners_with_scenario,29);
  assert.equal(data.coverage.trip_scenario.winner_scenario_coverage,0.9667);
});

test('track analysis retains exact sparse metrics while broadening interpretation support', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'1640'});
  assert.equal(data.selected_sample.races,5);
  assert.equal(data.selected_sample.sample_status,'sparse');
  assert.equal(data.analysis_basis.backoff_level,'track_start_method');
  assert.equal(data.analysis_basis.distance_group,'all');
  assert.equal(data.analysis_basis.races,35);
  assert.ok(data.analysis_support);

  const exactLane2=data.start_position_200m.sections[0].rows.find(row=>row.lane===2);
  assert.equal(exactLane2.observations,5);
  assert.equal(exactLane2.lead_rate,1);

  const supportLane1=data.analysis_support.start_position_200m.sections[0].rows.find(row=>row.lane===1);
  assert.equal(supportLane1.observations,35);
  assert.ok(data.short_analysis.some((line)=>line.includes('Högst observerad')));
  assert.equal(data.coverage.trip_scenario.races_with_any_scenario,5);
  assert.equal(data.analysis_support.coverage.trip_scenario.races_with_any_scenario,35);
});

test('track analysis excludes incomplete-field ranks from early-position rates', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("UPDATE race_position_checkpoints SET field_coverage=0.8,longitudinal_confidence=0.8 WHERE id='cp-200m-entry-1'").run();
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const lane1=data.start_position_200m.sections[0].rows.find(row=>row.lane===1);
  assert.equal(lane1.observations,29);
  assert.equal(data.coverage.position_200m.observations,89);
  assert.equal(data.coverage.position_200m.observation_coverage,0.9889);
});

test('voltstart lane analysis uses only ground-distance tier entries', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES ('volt-a','track-a','2026-07-01',1,2140,'volte','results')").run();
  for (const row of [
    {entry:'volt-e1',horse:'volt-h1',lane:1,tier:1,handicap:0,rank:2,placing:1},
    {entry:'volt-e4-addon',horse:'volt-h4',lane:4,tier:2,handicap:20,rank:1,placing:2}
  ]) {
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(row.horse,row.horse);
    db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES (?,?,?,?,?,?,?,?,0)')
      .run(row.entry,'volt-a',row.horse,row.lane,row.lane,row.tier,row.handicap,2140+row.handicap);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id) VALUES (?,?,'official','src-result')")
      .run(row.entry,row.placing);
    for (const checkpoint of [100,200,500]) {
      db.prepare(`INSERT INTO race_position_checkpoints
        (id,race_entry_id,source_record_id,checkpoint_key,checkpoint_m,frame_index,observed_at,elapsed_ms,
         leader_progress_m,distance_to_finish_m,position_rank,meters_behind_leader,observed_field_count,
         active_field_size,field_coverage,local_target_coverage,longitudinal_confidence,reconstruction_version)
        VALUES (?,?,?,?,?,1,'2026-07-01T12:00:00Z',10000,?,1940,?,?,2,2,1,1,1,'xlabs-position-reconstruction-v1')`)
        .run(`volt-cp-${checkpoint}-${row.entry}`,row.entry,'src-x',`${checkpoint}m`,checkpoint,checkpoint,row.rank,row.rank===1?0:2);
    }
    const scenarioKey=row.rank===1?'leader':'death_seat';
    db.prepare(`INSERT INTO race_positions
      (id,race_entry_id,observed_at_m,leader,death_seat,event_json,source_record_id,evidence_type,confidence,classification_version)
      VALUES (?,?,500,?,?,?,'src-x','calculated_xlabs',0.95,'xlabs-trip-classification-v1')`)
      .run(`volt-pos-${row.entry}`,row.entry,scenarioKey==='leader'?1:0,scenarioKey==='death_seat'?1:0,JSON.stringify({scenario_key:scenarioKey}));
  }
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'volt',distanceGroup:'2140'});
  const section=data.start_position_200m.sections[0];
  assert.equal(section.label,'Voltstart · grunddistans');
  assert.equal(section.position_scope,'ground_distance_only');
  assert.equal(section.rows.find(row=>row.lane===1).observations,1);
  assert.equal(section.rows.find(row=>row.lane===4).observations,0);
  assert.equal(data.coverage.eligible.lane_starts,1);
  assert.doesNotMatch(data.short_analysis.join(' '), /når spets oftast/i);
  assert.doesNotMatch(data.short_analysis.join(' '), /tydligt oftare än snittet/i);
});

test('winner-scenario coverage uses winner entries so dead heats do not inflate coverage', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("UPDATE race_results SET placing=1 WHERE race_entry_id='entry-2'").run();
  db.prepare("DELETE FROM race_positions WHERE id='pos-entry-2'").run();
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  assert.equal(data.coverage.eligible.winner_races,30);
  assert.equal(data.coverage.eligible.winner_entries,31);
  assert.equal(data.coverage.trip_scenario.winners_with_scenario,30);
  assert.equal(data.coverage.trip_scenario.winner_scenario_coverage,0.9677);
});


test('scenario win rates use leader after 500m from start and other positions 500m before finish', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  // Deliberately make the late C4 leader flag disagree with the early 500 m checkpoint.
  db.prepare("UPDATE race_positions SET leader=0,death_seat=1,event_json=? WHERE id='pos-entry-1'")
    .run(JSON.stringify({scenario_key:'death_seat'}));
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const leader=data.trip_scenario_500m_remaining.rows.find(row=>row.scenario_key==='leader');
  const death=data.trip_scenario_500m_remaining.rows.find(row=>row.scenario_key==='death_seat');
  assert.equal(leader.measurement_point,'500m_after_start');
  assert.equal(leader.measurement_label,'500 m efter start');
  assert.equal(leader.starts,30);
  assert.equal(leader.wins,30);
  assert.equal(death.measurement_point,'500m_remaining');
  assert.equal(death.measurement_label,'500 m kvar');
  assert.equal(death.starts,31);
  assert.match(data.short_analysis.join(' '),/ledningen 500 m efter start/);
  assert.match(data.short_analysis.join(' '),/Med 500 m kvar/);
  assert.doesNotMatch(data.short_analysis.join(' '),/Bland vinnarna där löpningsscenariot kan klassificeras/i);
});


test('all start-method scope excludes unknown methods from Bananalys samples and denominators', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES ('unknown-method-race','track-a','2026-07-02',1,2140,'unknown','results')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('unknown-method-horse','Unknown Method Horse')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES ('unknown-method-entry','unknown-method-race','unknown-method-horse',1,1,1,0,2140,0)").run();
  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id) VALUES ('unknown-method-entry',1,'official','src-result')").run();
  for (const checkpoint of [100,200]) {
    db.prepare(`INSERT INTO race_position_checkpoints
      (id,race_entry_id,source_record_id,checkpoint_key,checkpoint_m,frame_index,observed_at,elapsed_ms,
       leader_progress_m,distance_to_finish_m,position_rank,meters_behind_leader,observed_field_count,
       active_field_size,field_coverage,local_target_coverage,longitudinal_confidence,reconstruction_version)
      VALUES (?,?,?,?,?,1,'2026-07-02T12:00:00Z',10000,?,1940,1,0,1,1,1,1,1,'xlabs-position-reconstruction-v1')`)
      .run(`unknown-method-cp-${checkpoint}`,'unknown-method-entry','src-x',`${checkpoint}m`,checkpoint,checkpoint);
  }
  db.prepare(`INSERT INTO race_positions
    (id,race_entry_id,observed_at_m,leader,event_json,source_record_id,evidence_type,confidence,classification_version)
    VALUES ('unknown-method-pos','unknown-method-entry',500,1,?,'src-x','calculated_xlabs',0.95,'xlabs-trip-classification-v1')`)
    .run(JSON.stringify({scenario_key:'leader'}));

  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'all',distanceGroup:'2140'});
  assert.equal(data.selected_sample.races,30);
  assert.equal(data.coverage.eligible.official_races,30);
  assert.equal(data.coverage.eligible.official_starts,90);
  assert.equal(data.coverage.position_200m.observations,90);
  assert.equal(data.coverage.trip_scenario.observations,90);
});

test('absolute lane short analysis suppresses flat numerical maxima', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  function flattenRace(firstEntryId, raceIndex) {
    const leaderLane=(raceIndex%3)+1;
    const otherLanes=[1,2,3].filter(lane=>lane!==leaderLane);
    const rankByLane=new Map([[leaderLane,1],[otherLanes[0],2],[otherLanes[1],3]]);
    for (let lane=1;lane<=3;lane+=1) {
      db.prepare("UPDATE race_position_checkpoints SET position_rank=? WHERE id=?")
        .run(rankByLane.get(lane),`cp-200m-entry-${firstEntryId+lane-1}`);
    }
  }
  for (let raceIndex=0;raceIndex<30;raceIndex+=1) {
    flattenRace((raceIndex*3)+1,raceIndex);
    flattenRace(106+(raceIndex*3),raceIndex);
  }
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const rows=data.start_position_200m.sections[0].rows.filter(row=>row.lane<=3);
  assert.ok(rows.every(row=>Math.abs(row.lead_rate-(1/3))<0.001));
  const summary=data.short_analysis.join(' ');
  assert.doesNotMatch(summary,/Spår \d+ når spets tydligt oftast/i);
  assert.doesNotMatch(summary,/Spår \d+ ligger tydligt oftast/i);
});


test('absolute lane short analysis needs at least two adequately sampled lanes', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  for (let raceIndex=0;raceIndex<6;raceIndex+=1) {
    db.prepare("DELETE FROM race_position_checkpoints WHERE id=?").run(`cp-200m-entry-${(raceIndex*3)+2}`);
    db.prepare("DELETE FROM race_position_checkpoints WHERE id=?").run(`cp-200m-entry-${(raceIndex*3)+3}`);
  }
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const section=data.start_position_200m.sections[0];
  assert.equal(section.rows.find(row=>row.lane===1).observations,30);
  assert.equal(section.rows.find(row=>row.lane===2).observations,24);
  assert.equal(section.rows.find(row=>row.lane===3).observations,24);
  assert.doesNotMatch(data.short_analysis.join(' '),/Spår 1 når spets tydligt oftast/i);
  assert.doesNotMatch(data.short_analysis.join(' '),/Spår 1 ligger tydligt oftast/i);
});


test('short analysis lists top three best and worst starting lanes by observed win rate', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const text=data.short_analysis.join(' ');
  assert.match(text,/Högst observerad segerprocent har spår 1 \(100 %\), spår 2 \(0 %\) och spår 3 \(0 %\)/);
  assert.match(text,/Lägst har spår 2 \(0 %\), spår 3 \(0 %\) och spår 1 \(100 %\)/);
});

test('short analysis keeps data-quality wording out of the user-facing conclusions', async () => {
  const {env,db}=createTestEnv();
  seedTrackAnalysis(db);
  const data=await getTrackAnalysisV1(env,'track-a',{startMethod:'auto',distanceGroup:'2140'});
  const text=data.short_analysis.join(' ');
  assert.doesNotMatch(text,/klassificer|underlag|observation|baseline|winner/i);
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
