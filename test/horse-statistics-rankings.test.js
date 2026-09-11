import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getHorseRankings } from '../src/statistics/horses.js';

function base(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('a','A'),('b','B')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('d','D')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('t','T')").run();
}
function addHorse(db,id,{sex='sto',year=2020,breed='varmblodig travare'}={}){db.prepare('INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES (?,?,?,?,?)').run(id,id,sex,year,breed)}
function addRace(db,id,date,{track='a',method='auto',distance=2140,prize=50000,name='Vanligt lopp'}={}){db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES (?,?,?,?,?,?,?,?, 'verified')").run(id,track,date,Number(id.replace(/\D/g,''))||1,distance,method,prize,name)}
function addStart(db,id,raceId,horseId,placing=4){db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES (?,?,?,?,?,1,0)").run(id,raceId,horseId,'d','t');db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,result_status) VALUES (?,?,0,0,'official')").run(id,placing)}

function ids(data){return data.rankings.highestWinRate.map(x=>x.id)}

test('horse filters work individually and do not silently broaden the sample', async()=>{
  const {db,env}=createTestEnv();base(db);
  addHorse(db,'warm-mare',{sex:'sto',year:2020});
  addHorse(db,'cold-gelding',{sex:'valack',year:2019,breed:'kallblodig travare'});
  addHorse(db,'warm-stallion',{sex:'hingst',year:2018});
  addRace(db,'r1','2026-09-01',{track:'a',method:'auto',distance:2140,prize:50000});
  addRace(db,'r2','2026-08-01',{track:'b',method:'volt',distance:2640,prize:150000,name:'Montélopp'});
  addRace(db,'r3','2025-01-01',{track:'a',method:'auto',distance:3140,prize:50000});
  addStart(db,'e1','r1','warm-mare',1);addStart(db,'e2','r2','cold-gelding',1);addStart(db,'e3','r3','warm-stallion',1);
  const common={asOfDate:'2026-09-11'};
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'2w'})),['warm-mare']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',trackId:'b'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',startMethod:'volt'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',raceType:'monte'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',breedType:'coldblood'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',sex:'gelding'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',age:'7'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',distanceGroup:'2640'})),['cold-gelding']);
  assert.deepEqual(ids(await getHorseRankings(env,{...common,period:'all',raceScope:'high_prize'})),['cold-gelding']);
  assert.equal((await getHorseRankings(env,{...common,period:'all',raceScope:'weekday'})).rankings.highestWinRate.some(x=>x.id==='cold-gelding'),false);
});

test('horse win ranking is top 10 with deterministic win-rate, wins, starts and stable-ID tie-breaks', async()=>{
  const {db,env}=createTestEnv();base(db);
  for(let i=0;i<14;i++) addHorse(db,`h-${String(i).padStart(2,'0')}`);
  let raceNo=1;
  function startsFor(horseId,wins,starts){for(let i=0;i<starts;i++){const rid=`r${raceNo++}`;addRace(db,rid,'2026-09-01');addStart(db,`e-${horseId}-${i}`,rid,horseId,i<wins?1:4)}}
  startsFor('h-00',1,2);startsFor('h-01',2,4);startsFor('h-02',2,4);
  for(let i=3;i<14;i++) startsFor(`h-${String(i).padStart(2,'0')}`,0,1);
  const data=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.highestWinRate.length,10);
  assert.deepEqual(data.rankings.highestWinRate.slice(0,3).map(x=>x.id),['h-01','h-02','h-00']);
  assert.deepEqual(data.rankings.highestWinRate.slice(3).map(x=>x.id),['h-03','h-04','h-05','h-06','h-07','h-08','h-09']);
});
