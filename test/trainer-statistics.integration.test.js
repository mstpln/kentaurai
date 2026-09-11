import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getTrainerDetailStatistics, getTrainerRankings, normalizeTrainerStatsFilters } from '../src/statistics/trainers.js';

function seedBase(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-a','Bana A'),('track-b','Bana B')").run();
  db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES ('track-a','official','A'),('track-b','official','B')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-a','Tränare A'),('trainer-b','Tränare B')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-a','Kusk A')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-a','Häst A','sto',2020,'varmblodig travare'),('horse-b','Häst B','valack',2019,'kallblodig travare')").run();
}
function race(db,id,date,{track='track-a',method='auto',distance=2140,number=1,firstPrize=50000,name='Vanligt lopp'}={}) {
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES (?,?,?,?,?,?,?,?, 'verified')").run(id,track,date,number,distance,method,firstPrize,name);
}
function entry(db,id,raceId,trainerId,{horse='horse-a',placing=4,prize=0,gallop=0,lane=1,handicap=0,actualDistance=2140,scratched=0}={}) {
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,handicap_m,actual_start_distance_m,scratched,data_quality) VALUES (?,?,?,?,?,1,?,?,?,?, 'verified')").run(id,raceId,horse,'driver-a',trainerId,lane,handicap,actualDistance,scratched);
  if (!scratched) db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,disqualified,result_status) VALUES (?,?,?,?,0,'official')").run(id,placing,prize,gallop);
}
function source(db,id,type='official_provider') { db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES (?,?, '2026-09-11T10:00:00Z','verified')").run(id,type); }
function trainerHome(db,trainerId,trackExternalId,sourceId) {
  source(db,sourceId);
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'trainer', ?, ?, '2026-09-11T10:00:00Z', ?, 'normalized_verified_subset')").run(`obs-${trainerId}`,trainerId,sourceId,JSON.stringify({homeTrackExternalId:trackExternalId,homeTrackName:trackExternalId==='A'?'Bana A':'Bana B'}));
}
function market(db,entryId,{percent=5,rank=1}={}) {
  source(db,`source-${entryId}`,'synthetic');
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at) VALUES (?, 'V85','2026-09-05','2026-09-05T12:00:00Z')").run(`round-${entryId}`);
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) SELECT ?,1,race_id FROM race_entries WHERE id=?").run(`round-${entryId}`,entryId);
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,1,?,'2026-09-05T11:59:00Z',?,?,?)").run(`market-${entryId}`,`round-${entryId}`,entryId,percent,rank,`source-${entryId}`);
}

test('trainer filter contract is fail closed', () => {
  assert.throws(()=>normalizeTrainerStatsFilters({period:'bad'}),/period must be/);
  assert.throws(()=>normalizeTrainerStatsFilters({sex:'other'}),/sex must be/);
  assert.throws(()=>normalizeTrainerStatsFilters({age:'1'}),/age must be/);
  assert.throws(()=>normalizeTrainerStatsFilters({voltLane:'bad'}),/volt_lane/);
  assert.throws(()=>normalizeTrainerStatsFilters({handicapM:'10'}),/handicap_m/);
});

test('trainer core rankings preserve denominators and minimum-start semantics', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'r1','2026-09-01');entry(db,'e1','r1','trainer-a',{placing:1,prize:10000,gallop:null});
  race(db,'r2','2026-09-02',{number:2});entry(db,'e2','r2','trainer-a',{placing:5,prize:null,gallop:1});
  race(db,'r3','2026-09-03',{number:3});entry(db,'e3','r3','trainer-b',{horse:'horse-b',placing:1,prize:20000});
  const data=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',minStarts:'3'});
  assert.equal(data.rankings.highestWinRate.length,0,'percentage rank requires the requested sample');
  assert.equal(data.rankings.mostWins.some((row)=>row.id==='trainer-a'),true,'volume rank must not use minimum-start filter');
  assert.equal(data.rankings.mostEarningsThisYear[0].id,'trainer-b','annual earnings must not use minimum-start filter');
  const all=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  const a=all.rankings.highestWinRate.find(x=>x.id==='trainer-a');
  assert.equal(a.starts,2);assert.equal(a.wins,1);assert.equal(a.losses,1);assert.equal(a.winRate,0.5);assert.equal(a.gallopVerifiedStarts,1);assert.equal(a.gallopRate,1);
});

test('trainer common filters include horse sex and age plus verified volt lane and handicap', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'rv','2026-09-01',{track:'track-b',method:'volt',distance:2140,firstPrize:150000,name:'Montélopp'});
  entry(db,'ev','rv','trainer-b',{horse:'horse-b',placing:1,lane:6,handicap:20,actualDistance:2160});
  race(db,'rv2','2026-09-02',{track:'track-b',method:'volt',distance:2140,number:2,firstPrize:150000,name:'Montélopp'});
  entry(db,'ev2','rv2','trainer-a',{placing:1,lane:2,handicap:20,actualDistance:2160});
  const data=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11',trackId:'track-b',raceScope:'high_prize',raceType:'monte',breedType:'coldblood',sex:'gelding',age:'7',startMethod:'volt',distanceGroup:'2140',voltLane:'good',handicapM:'20'});
  assert.deepEqual(data.rankings.highestWinRate.map(x=>x.id),['trainer-b']);
});

test('trainer home and away rankings require latest verified official home-track evidence', async () => {
  const {db,env}=createTestEnv();seedBase(db);trainerHome(db,'trainer-a','A','home-a');
  race(db,'rh','2026-09-01',{track:'track-a'});entry(db,'eh','rh','trainer-a',{placing:1});
  race(db,'ra','2026-09-02',{track:'track-b',number:2});entry(db,'ea','ra','trainer-a',{placing:2});
  race(db,'ru','2026-09-03',{track:'track-a',number:3});entry(db,'eu','ru','trainer-b',{placing:1});
  const data=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.bestHomeTrack[0].id,'trainer-a');
  assert.equal(data.rankings.bestOtherTracks[0].id,'trainer-a');
  assert.equal(data.rankings.bestHomeTrack.some(x=>x.id==='trainer-b'),false,'unknown home track must not be inferred');
  const detail=await getTrainerDetailStatistics(env,'trainer-a',{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(detail.homeTrackResults.starts,1);assert.equal(detail.homeTrackResults.wins,1);assert.equal(detail.otherTrackResults.starts,1);
});

test('trainer favorite/longshot and rest blocks use factual source-backed samples', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'r0','2026-05-01');entry(db,'e0','r0','trainer-a',{placing:4});
  race(db,'r1','2026-07-01',{number:2});entry(db,'e1','r1','trainer-a',{placing:1});
  race(db,'r2','2026-07-10',{number:3});entry(db,'e2','r2','trainer-a',{placing:2});
  race(db,'race-market','2026-09-05',{number:4});entry(db,'entry-market','race-market','trainer-a',{placing:1,prize:25000});market(db,'entry-market',{percent:5,rank:1});
  const data=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.favoriteResults[0].id,'trainer-a');assert.equal(data.rankings.longshotResults[0].id,'trainer-a');
  assert.equal(data.rankings.firstAfterRest[0].id,'trainer-a');assert.equal(data.rankings.secondAfterRest[0].id,'trainer-a');
  const detail=await getTrainerDetailStatistics(env,'trainer-a',{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(detail.firstAfterRest.starts,1);assert.equal(detail.secondAfterRest.starts,1);assert.equal(detail.favoriteResults.starts,1);
});

test('trainer distance profiles use canonical short/medium/long groups', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'rs','2026-09-01',{distance:1640});entry(db,'es','rs','trainer-a',{placing:1,actualDistance:1640});
  race(db,'rm','2026-09-02',{distance:2140,number:2});entry(db,'em','rm','trainer-b',{placing:1,actualDistance:2140});
  race(db,'rl','2026-09-03',{distance:2640,number:3});entry(db,'el','rl','trainer-a',{placing:1,actualDistance:2640});
  const data=await getTrainerRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.bestShortDistance[0].id,'trainer-a');assert.equal(data.rankings.bestMediumDistance[0].id,'trainer-b');assert.equal(data.rankings.bestLongDistance[0].id,'trainer-a');
  assert.equal(data.definitions.distanceProfile,'canonical-distance-profile-v1');
});
