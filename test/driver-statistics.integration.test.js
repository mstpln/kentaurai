import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getDriverDetailStatistics, getDriverRankings, normalizeDriverStatsFilters } from '../src/statistics/drivers.js';

function seedBase(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-a','Bana A'),('track-b','Bana B')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-a','Tränare A')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-a','Häst A','sto',2020,'varmblodig travare'),('horse-b','Häst B','valack',2019,'kallblodig travare')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-a','Kusk A'),('driver-b','Kusk B'),('driver-c','Kusk C')").run();
}

function race(db,id,date,{number=1,track='track-a',method='auto',distance=2140,firstPrize=50000,name='Vanligt lopp'}={}) {
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES (?,?,?,?,?,?,?,?, 'verified')").run(id,track,date,number,distance,method,firstPrize,name);
}

function entry(db,id,raceId,driverId,{horse='horse-a',placing=4,prize=0,gallop=0,scratched=0,lane=1,handicap=0,actualDistance=2140,backRow=0}={}) {
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,handicap_m,actual_start_distance_m,back_row,scratched,data_quality) VALUES (?,?,?,?,?,1,?,?,?,?,?,'verified')").run(id,raceId,horse,driverId,'trainer-a',lane,handicap,actualDistance,backRow,scratched);
  if (!scratched) db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,disqualified,result_status) VALUES (?,?,?,?,0,'official')").run(id,placing,prize,gallop);
}

function source(db,id='source-a') {
  db.prepare("INSERT OR IGNORE INTO source_records (id,source_type,fetched_at,quality_status) VALUES (?, 'synthetic', '2026-09-11T10:00:00Z', 'verified')").run(id);
}

function position(db,id,entryId,{leader=0,death=0,sourceId='source-a'}={}) {
  db.prepare("INSERT INTO race_positions (id,race_entry_id,observed_at_m,position,leader,death_seat,source_record_id) VALUES (?,?,1000,1,?,?,?)").run(id,entryId,leader,death,sourceId);
}

function marketRound(db,{round='round-a',raceId='race-market',stop='2026-09-05T12:00:00Z'}={}) {
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at) VALUES (?,'V85','2026-09-05',?)").run(round,stop);
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,1,?)").run(round,raceId);
}

function market(db,id,entryId,{round='round-a',captured='2026-09-05T11:50:00Z',percent=5,rank=1,sourceId='source-a'}={}) {
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,1,?,?,?,?,?)").run(id,round,entryId,captured,percent,rank,sourceId);
}

test('driver filter contract rejects unsupported values', () => {
  assert.throws(()=>normalizeDriverStatsFilters({period:'bad'}),/period must be/);
  assert.throws(()=>normalizeDriverStatsFilters({distanceGroup:'2000'}),/distance_group/);
  assert.throws(()=>normalizeDriverStatsFilters({sex:'unknown'}),/sex must be/);
  assert.throws(()=>normalizeDriverStatsFilters({age:'1'}),/age must be/);
  assert.throws(()=>normalizeDriverStatsFilters({voltLane:'inside'}),/volt_lane/);
  assert.throws(()=>normalizeDriverStatsFilters({handicapM:'10'}),/handicap_m/);
  assert.throws(()=>normalizeDriverStatsFilters({minStarts:'2'}),/min_starts/);
});

test('driver rankings use shared core denominators and deterministic ranking measures', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'r1','2026-09-01',{number:1});race(db,'r2','2026-09-02',{number:2});race(db,'r3','2026-09-03',{number:3});
  entry(db,'e1','r1','driver-a',{placing:1,prize:10000,gallop:null});
  entry(db,'e2','r2','driver-a',{placing:5,prize:null,gallop:1});
  entry(db,'e3','r3','driver-b',{placing:2,prize:2000,gallop:0,horse:'horse-b'});
  const data=await getDriverRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  const a=data.rankings.highestWinRate.find(x=>x.id==='driver-a');
  assert.equal(a.starts,2);assert.equal(a.wins,1);assert.equal(a.losses,1);assert.equal(a.winRate,0.5);
  assert.equal(a.gallopVerifiedStarts,1);assert.equal(a.gallopRate,1);
  assert.equal(a.prizeVerifiedStarts,1);assert.equal(a.prizeSek,10000);assert.equal(a.earningsPerVerifiedStart,10000);
  assert.equal(data.rankings.mostWins[0].id,'driver-a');
  assert.equal(data.rankings.bestFormLast30.find(x=>x.id==='driver-a').averagePlacing,3);
});

test('driver filters combine horse age and sex with volt lane, handicap and common filters', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'rv','2026-09-01',{track:'track-b',method:'volt',distance:2140,firstPrize:150000,name:'Montélopp'});
  entry(db,'ev','rv','driver-b',{horse:'horse-b',placing:1,lane:6,handicap:20,actualDistance:2160});
  race(db,'rv2','2026-09-02',{track:'track-b',method:'volt',distance:2140,firstPrize:150000,name:'Montélopp',number:2});
  entry(db,'ev2','rv2','driver-a',{placing:1,lane:2,handicap:20,actualDistance:2160});
  const data=await getDriverRankings(env,{period:'1y',asOfDate:'2026-09-11',trackId:'track-b',raceScope:'high_prize',raceType:'monte',breedType:'coldblood',sex:'gelding',age:'7',startMethod:'volt',distanceGroup:'2140',voltLane:'good',handicapM:'20'});
  assert.deepEqual(data.rankings.highestWinRate.map(x=>x.id),['driver-b']);
  assert.equal(data.filters.sex,'gelding');assert.equal(data.filters.age,7);
  assert.deepEqual(data.definitions.voltLaneGood,[1,6,7]);
});

test('minimum starts applies to percentage rankings but not volume or earnings rankings', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  race(db,'m1','2026-09-01',{number:1});entry(db,'me1','m1','driver-a',{placing:1,prize:50000});
  for(let i=2;i<=4;i++){race(db,`m${i}`,`2026-09-0${i}`,{number:i});entry(db,`me${i}`,`m${i}`,'driver-b',{placing:i===2?1:4,prize:1000});}
  const data=await getDriverRankings(env,{period:'1y',asOfDate:'2026-09-11',minStarts:'3'});
  assert.equal(data.rankings.highestWinRate.some(x=>x.id==='driver-a'),false,'one-start percentage must be filtered');
  assert.equal(data.rankings.mostWins.some(x=>x.id==='driver-a'),true,'volume ranking must not inherit percentage threshold');
  assert.equal(data.rankings.mostEarningsThisYear[0].id,'driver-a','annual earnings must not inherit percentage threshold');
});

test('form last 30 is placements-only, latest-first and capped at 30 starts', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  for(let i=1;i<=31;i++){
    const date=`2026-08-${String(i).padStart(2,'0')}`;
    race(db,`rf${i}`,date,{number:i});
    entry(db,`ef${i}`,`rf${i}`,'driver-a',{placing:i===1?99:1});
  }
  const detail=await getDriverDetailStatistics(env,'driver-a',{period:'all',asOfDate:'2026-09-11'});
  assert.equal(detail.formLast30.usedStarts,30);
  assert.equal(detail.formLast30.averagePlacing,1,'oldest 31st result must be excluded');
});

test('favorite and longshot use the final source-backed pre-stop snapshot and fail closed without a stop', async () => {
  const {db,env}=createTestEnv();seedBase(db);source(db);
  race(db,'race-market','2026-09-05',{number:1});entry(db,'entry-market','race-market','driver-a',{placing:1,prize:25000});marketRound(db,{});
  market(db,'m-old','entry-market',{captured:'2026-09-05T11:40:00Z',percent:4.9,rank:2});
  market(db,'m-final','entry-market',{captured:'2026-09-05T11:58:00Z',percent:5,rank:1});
  market(db,'m-unprovenanced','entry-market',{captured:'2026-09-05T11:59:00Z',percent:40,rank:3,sourceId:null});
  market(db,'m-after','entry-market',{captured:'2026-09-05T12:01:00Z',percent:40,rank:3});
  race(db,'race-no-stop','2026-09-06',{number:2});entry(db,'entry-no-stop','race-no-stop','driver-b',{placing:1});
  marketRound(db,{round:'round-no-stop',raceId:'race-no-stop',stop:null});market(db,'m-no-stop','entry-no-stop',{round:'round-no-stop',captured:'2026-09-06T11:00:00Z',percent:1,rank:1});
  const data=await getDriverRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.favoriteResults[0].id,'driver-a');
  assert.equal(data.rankings.longshotResults[0].id,'driver-a');
  assert.equal(data.rankings.favoriteResults.some(x=>x.id==='driver-b'),false);
  assert.equal(data.rankings.longshotResults.some(x=>x.id==='driver-b'),false);
  assert.equal(data.definitions.longshotPercentMax,5);
  const detail=await getDriverDetailStatistics(env,'driver-a',{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(detail.favoriteResults.starts,1);assert.equal(detail.favoriteResults.wins,1);
  assert.equal(detail.longshotResults.starts,1);assert.equal(detail.longshotResults.winRate,1);
});

test('position rankings require source-backed verified flags and annual earnings use calendar year', async () => {
  const {db,env}=createTestEnv();seedBase(db);source(db);
  race(db,'rp1','2026-09-01',{number:1});entry(db,'ep1','rp1','driver-a',{placing:1,prize:10000});position(db,'p1','ep1',{leader:1});
  race(db,'rp2','2026-09-02',{number:2});entry(db,'ep2','rp2','driver-b',{placing:1,prize:20000});position(db,'p2','ep2',{death:1,sourceId:null});
  race(db,'rp-old','2025-12-31',{number:3});entry(db,'ep-old','rp-old','driver-c',{placing:1,prize:999999});
  const data=await getDriverRankings(env,{period:'2w',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.bestFromLead[0].id,'driver-a');
  assert.equal(data.rankings.bestFromDeathSeat.some(x=>x.id==='driver-b'),false,'unprovenanced position flag must not qualify');
  assert.equal(data.rankings.mostEarningsThisYear.some(x=>x.id==='driver-c'),false,'prior calendar year must not count');
});
