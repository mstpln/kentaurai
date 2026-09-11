import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getHorseDetailStatistics, getHorseRankings, normalizeHorseStatsFilters } from '../src/statistics/horses.js';

function seedBase(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-a','Bana A'),('track-b','Bana B')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-a','Kusk A')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-a','Tränare A')").run();
}

function horse(db, id, name, { sex='sto', birthYear=2020, breed='varmblodig travare' }={}) {
  db.prepare('INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES (?,?,?,?,?)').run(id,name,sex,birthYear,breed);
}

function race(db, id, date, { track='track-a', method='auto', distance=2140, prize=50000, name='Vanligt lopp' }={}) {
  const n=Number(id.replace(/\D/g,'').slice(-3))||1;
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES (?,?,?,?,?,?,?,?, 'verified')").run(id,track,date,n,distance,method,prize,name);
}

function entry(db, id, raceId, horseId, { placing=4, prize=0, gallop=0, scratched=0 }={}) {
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched,data_quality) VALUES (?,?,?,?,?,1,?,'verified')").run(id,raceId,horseId,'driver-a','trainer-a',scratched);
  if (!scratched) db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,disqualified,result_status) VALUES (?,?,?,?,0,'official')").run(id,placing,prize,gallop);
}

function source(db, id, fetchedAt) {
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES (?, 'xlabs_race_json', ?, 'verified')").run(id,fetchedAt);
}

function xlabs(db, id, entryId, sourceId, first200, last400) {
  db.prepare("INSERT INTO xlabs_data (id,race_entry_id,first_200_time,last_400_time,quality_status,source_record_id) VALUES (?,?,?,?, 'xlabs-telemetry-v1', ?)").run(id,entryId,first200,last400,sourceId);
}

test('horse filter contract rejects unsupported values', () => {
  assert.throws(()=>normalizeHorseStatsFilters({period:'bad'}),/period must be/);
  assert.throws(()=>normalizeHorseStatsFilters({distanceGroup:'2000'}),/distance_group/);
  assert.throws(()=>normalizeHorseStatsFilters({sex:'unknown'}),/sex must be/);
  assert.throws(()=>normalizeHorseStatsFilters({age:'1'}),/age must be/);
  assert.throws(()=>normalizeHorseStatsFilters({minStarts:'2'}),/min_starts/);
});

test('horse rankings share null-safe core metrics, placements-only form and verified X-Labs observations', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  horse(db,'h-a','Häst A');horse(db,'h-b','Häst B',{sex:'valack',breed:'kallblodig travare'});
  for (const [id,date] of [['r1','2026-09-01'],['r2','2026-09-02'],['r3','2026-09-03'],['r4','2026-09-04']]) race(db,id,date);
  entry(db,'e1','r1','h-a',{placing:1,prize:10000,gallop:null});
  entry(db,'e2','r2','h-a',{placing:5,prize:null,gallop:1});
  entry(db,'e3','r3','h-b',{placing:2,prize:2000,gallop:0});
  entry(db,'e4','r4','h-b',{placing:null,prize:0,gallop:0});
  source(db,'s-old','2026-09-04T10:00:00Z');source(db,'s-new','2026-09-04T11:00:00Z');
  xlabs(db,'x-old','e1','s-old','1.20,0 min/km','1.15,0 min/km');
  xlabs(db,'x-new','e1','s-new','1.10,0 min/km','1.05,0 min/km');
  xlabs(db,'x-b','e3','s-new','1.12,0 min/km','1.07,0 min/km');

  const data=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  const win=data.rankings.highestWinRate.find(x=>x.id==='h-a');
  assert.equal(win.starts,2);assert.equal(win.wins,1);assert.equal(win.losses,1);assert.equal(win.winRate,0.5);
  assert.equal(win.gallopVerifiedStarts,1);assert.equal(win.gallopRate,1);
  assert.equal(win.prizeVerifiedStarts,1);assert.equal(win.prizeSek,10000);assert.equal(win.earningsPerVerifiedStart,10000);
  const formA=data.rankings.bestFormLast10.find(x=>x.id==='h-a');
  assert.equal(formA.usedStarts,2);assert.equal(formA.averagePlacing,3);
  const formB=data.rankings.bestFormLast10.find(x=>x.id==='h-b');
  assert.equal(formB.usedStarts,1,'missing placing is excluded from placements-only form');
  const speedA=data.rankings.fastestFirst200.find(x=>x.id==='h-a');
  assert.equal(speedA.measurements,1,'multiple verified telemetry observations for one start are deduplicated');
  assert.equal(speedA.averageSeconds,70);
  assert.equal(data.rankings.highestStartPoints,null);
  assert.equal(data.startPointsStatus,'unverified_official_semantics');
});

test('minimum starts and horse filters combine with AND semantics', async () => {
  const {db,env}=createTestEnv();seedBase(db);horse(db,'h-a','Häst A');horse(db,'h-b','Häst B',{sex:'valack',birthYear:2019,breed:'kallblodig travare'});
  race(db,'r1','2026-09-01',{track:'track-a',method:'auto',distance:2140});
  race(db,'r2','2026-09-02',{track:'track-a',method:'auto',distance:2140});
  race(db,'r3','2026-09-03',{track:'track-b',method:'volt',distance:2640,name:'Montélopp',prize:150000});
  entry(db,'e1','r1','h-a',{placing:1});entry(db,'e2','r2','h-a',{placing:4});entry(db,'e3','r3','h-b',{placing:1});
  const min=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-11',minStarts:'3'});
  assert.equal(min.rankings.highestWinRate.length,0);
  const combined=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-11',trackId:'track-b',startMethod:'volt',raceType:'monte',breedType:'coldblood',sex:'gelding',age:'7',distanceGroup:'2640',raceScope:'high_prize'});
  assert.deepEqual(combined.rankings.highestWinRate.map(x=>x.id),['h-b']);
});

test('60-day rest sequence uses actual starts: 59 no, 60 yes, scratched declarations do not break rest, and second start resets on new rest', async () => {
  const {db,env}=createTestEnv();seedBase(db);horse(db,'h-a','Häst A');
  race(db,'r1','2026-01-01');entry(db,'e1','r1','h-a',{placing:4});
  race(db,'r-s','2026-02-01');entry(db,'e-s','r-s','h-a',{scratched:1});
  race(db,'r2','2026-03-02');entry(db,'e2','r2','h-a',{placing:1}); // exactly 60 days after Jan 1
  race(db,'r3','2026-04-30');entry(db,'e3','r3','h-a',{placing:2}); // 59 days later: second after rest
  race(db,'r4','2026-06-29');entry(db,'e4','r4','h-a',{placing:3}); // 60 days: new first after rest, not second
  race(db,'r5','2026-08-29');entry(db,'e5','r5','h-a',{placing:1}); // 61 days: another first after rest

  const detail=await getHorseDetailStatistics(env,'h-a',{period:'all',asOfDate:'2026-09-11'});
  assert.deepEqual(detail.firstAfterRest.placements.map(x=>x.raceEntryId),['e2','e4','e5']);
  assert.deepEqual(detail.firstAfterRest.placements.map(x=>x.daysSincePrevious),[60,60,61]);
  assert.deepEqual(detail.secondAfterRest.placements.map(x=>x.raceEntryId),['e3']);
  assert.equal(detail.firstAfterRest.starts,3);assert.equal(detail.secondAfterRest.starts,1);
});

test('first stored actual start has unknown rest status and form detail is not limited by global top ten', async () => {
  const {db,env}=createTestEnv();seedBase(db);
  for(let h=0;h<12;h++){horse(db,`h-${h}`,`Häst ${h}`);race(db,`r${h+1}`,'2026-09-01');entry(db,`e${h+1}`,`r${h+1}`,`h-${h}`,{placing:h+1});}
  const detail=await getHorseDetailStatistics(env,'h-11',{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(detail.firstAfterRest.starts,0);assert.equal(detail.secondAfterRest.starts,0);
  assert.equal(detail.formLast10.usedStarts,1);assert.equal(detail.formLast10.averagePlacing,12);
  assert.equal(detail.currentStartPoints,null);assert.deepEqual(detail.startPointHistory,[]);
});
