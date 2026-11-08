import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getCalendarYearDetailForm } from '../src/entity-detail-calendar-statistics.js';
import {
  distanceGroupForMeters,
  getUpcomingEntryFacts,
  getUpcomingGameLeg,
  getUpcomingLegHorseForms,
  listUpcomingGames
} from '../src/routes/upcoming-games.js';

function seedUpcoming(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track_a','Synthetic Park','SE')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver_1','Synthetic Driver')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer_1','Synthetic Trainer')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex) VALUES ('horse_1','Synthetic Horse','gelding')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,primary_track_id,scheduled_start_at,bet_stop_at,status) VALUES ('round_up','V85','2099-09-20','track_a','2099-09-20T16:20:00Z','2099-09-20T16:10:00Z','upcoming')").run();

  for (let leg=1; leg<=8; leg+=1) {
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,first_prize_sek,status) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(`race_${leg}`,'track_a','2099-09-20',leg,`2099-09-20T${String(15+leg).padStart(2,'0')}:00:00Z`,2140,'auto',80000,'upcoming');
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)").run('round_up',leg,`race_${leg}`);
    const horseId=leg===1?'horse_1':`horse_${leg}`;
    if (leg!==1) db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horseId,`Horse ${leg}`);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,scratched) VALUES (?,?,?,?,?,?,?,0)")
      .run(`entry_${leg}`,`race_${leg}`,horseId,leg===1?'driver_1':null,leg===1?'trainer_1':null,leg,leg);
  }

  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('src_current','official_provider','r1','2099-09-19T09:05:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES ('obs_current','race','race_1','src_current','2099-09-19T09:05:00Z','{}','normalized_verified_subset')").run();
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES ('bet_1','round_up',1,'entry_1','2099-09-19T08:50:00Z',21,1,'src_current')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,system_type,budget_sek,row_count,spike_count,created_at) VALUES ('system_up','round_up','main',200,100,3,'2099-09-19T09:00:00Z')").run();

  const history=[
    ['hist_auto_high','2099-06-01','auto',2140,120000,1,1,0,'1.12,8','1.06,8'],
    ['hist_auto_weekday','2099-05-01','auto',2100,30000,4,2,1,'1.13,4','1.07,2'],
    ['hist_volt_fast','2099-04-01','volt',2140,30000,6,1,0,'1.11,0','1.06,3']
  ];
  for (const [id,date,method,distance,prize,lane,placing,gallop,first200,last400] of history) {
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,first_prize_sek,status) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id,'track_a',date,1,`${date}T12:00:00Z`,distance,method,prize,'finished');
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,scratched) VALUES (?,?,?,?,?,?,?,0)")
      .run(`${id}_entry`,id,'horse_1','driver_1','trainer_1',1,lane);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status) VALUES (?,?,?,?,?)")
      .run(`${id}_entry`,placing,gallop,0,'final');
    const src=`src_${id}`;
    db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES (?,?,?,?,?)")
      .run(src,'xlabs_race_json',id,`${date}T13:00:00Z`,'normalized');
    db.prepare("INSERT INTO xlabs_data (id,race_entry_id,first_200_time,last_400_time,quality_status,source_record_id) VALUES (?,?,?,?,?,?)")
      .run(`xlabs_${id}`,`${id}_entry`,first200,last400,'xlabs-telemetry-v1',src);
  }
}

test('canonical distance grouping keeps nearby standard distances together', () => {
  assert.deepEqual(distanceGroupForMeters(2100), { key:'2140', label:'2140-gruppen', min:2040, max:2240 });
  assert.equal(distanceGroupForMeters(2140).key, '2140');
  assert.equal(distanceGroupForMeters(2640).key, '2640');
});

test('upcoming list exposes only factual round status, X-Labs coverage and fetch freshness', async () => {
  const { env, db } = createTestEnv();
  seedUpcoming(db);
  const data = await listUpcomingGames(env, { asOfDate:'2099-09-01' });
  assert.equal(data.items.length, 1);
  const round=data.items[0];
  assert.equal(round.gameType, 'V85');
  assert.equal(round.trackNames, 'Synthetic Park');
  assert.equal(round.systemRegistered, true);
  assert.deepEqual(round.xlabsCoverage, { covered:1, activeEntries:8 });
  assert.equal(round.latestFetchedAt, '2099-09-19T09:05:00Z');
  assert.equal('strength' in round, false);
  assert.equal('probability' in round, false);
});

test('upcoming leg uses fastest first 200 from matching start method and fastest last 400 overall', async () => {
  const { env, db } = createTestEnv();
  seedUpcoming(db);
  const data = await getUpcomingGameLeg(env, 'round_up', 1);
  const horse=data.entries[0];
  assert.equal(horse.fastestFirst200.value, '1.12,8');
  assert.equal(horse.fastestFirst200.observationCount, 2);
  assert.equal(horse.fastestLast400.value, '1.06,3');
  assert.equal(horse.fastestLast400.observationCount, 3);
  assert.equal(horse.betPercent, 21);
});

test('expanded facts use rolling 12 months, canonical distance group, lane type and canonical prize scopes', async () => {
  const { env, db } = createTestEnv();
  seedUpcoming(db);
  const data = await getUpcomingEntryFacts(env, 'round_up', 1, 'entry_1', { asOfDate:'2099-09-19' });
  assert.equal(data.metrics.rolling12Months.starts, 3);
  assert.equal(data.metrics.rolling12Months.wins, 2);
  assert.equal(data.metrics.gallop.starts, 3);
  assert.equal(data.metrics.gallop.gallops, 1);
  assert.equal(data.metrics.currentDriver.starts, 3);
  assert.equal(data.metrics.currentTrack.starts, 3);
  assert.equal(data.metrics.sameStartMethod.starts, 2);
  assert.equal(data.metrics.sameDistanceGroup.key, '2140');
  assert.equal(data.metrics.sameDistanceGroup.starts, 3);
  assert.equal(data.metrics.laneType.key, 'auto_front');
  assert.equal(data.metrics.laneType.starts, 2);
  assert.equal(data.metrics.highPrize.starts, 1);
  assert.equal(data.metrics.weekday.starts, 2);
  assert.match(data.metrics.laneType.explanation, /framspår 1–8/);
});


test('upcoming round treats null scratch state as active until an official scratch is verified', async () => {
  const { env, db } = createTestEnv();
  seedUpcoming(db);
  db.prepare("UPDATE race_entries SET scratched=NULL WHERE id='entry_1'").run();
  const data = await listUpcomingGames(env, { asOfDate:'2099-09-01', asOfNow:'2099-09-01T00:00:00Z' });
  assert.equal(data.items[0].xlabsCoverage.activeEntries, 8);
});

function countedEnv(base) {
  let prepared = 0;
  const db = new Proxy(base.DB, {
    get(target, property) {
      if (property === 'prepare') return (sql) => {
        prepared += 1;
        return target.prepare(sql);
      };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return { env:{ ...base, DB:db }, count:() => prepared };
}

test('upcoming horse forms use a single batch, preserve existing scoring and include every verified start', async () => {
  const { env, db } = createTestEnv();
  seedUpcoming(db);
  for (let number = 2; number <= 12; number++) {
    const horseId = 'leg1_horse_' + number;
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?,?)')
      .run(horseId, 'Synthetic ' + number);
    db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,?,0)')
      .run('leg1_entry_' + number, 'race_1',horseId,number);
    const date = '2099-03-' + String(number).padStart(2, '0');
    db.prepare('INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status) VALUES (?,?,?,?,?,?)')
      .run('leg1_old_race_' + number,'track_a',date,1,date+'T12:00:00Z','finished');
    db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,?,0)')
      .run('leg1_old_entry_' + number,'leg1_old_race_'+number,horseId,1);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status) VALUES (?,?,'official')")
      .run('leg1_old_entry_'+number,number%3+1);
  }
  const batch = countedEnv(env);
  const result = await getUpcomingLegHorseForms(batch.env, 'round_up', 1, { asOfDate:'2099-09-19' });
  assert.equal(result.forms.length,12);
  const countAfterBatch = batch.count();
  const legacy = countedEnv(env);
  const opts = {asOfDate:'2099-09-19',year:2099,raceScope:'all',startMethod:'all',distanceGroup:'all'};
  for (const item of result.forms) {
    const single = await getCalendarYearDetailForm(legacy.env,'horses',item.horseId,opts);
    assert.equal(item.score,single?.formLast?.score ?? null,item.horseId);
    assert.equal(item.usedStarts,single?.formLast?.usedStarts ?? 0,item.horseId);
  }
  assert.ok(countAfterBatch*2 < legacy.count(),
    'batch form lookups must use less than half the individual query preparations');
});

test('upcoming form batch retains the null/zero convention for horses with no result history', async () => {
  const {env,db} = createTestEnv();
  seedUpcoming(db);
  const result = await getUpcomingLegHorseForms(env,'round_up',2,{asOfDate:'2099-09-19'});
  assert.equal(result.forms.length,1);
  assert.equal(result.forms[0].score,null);
  assert.equal(result.forms[0].usedStarts,0);
});

test('upcoming card API retains verified age, sex, trainer, scratch and handicap facts',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 db.prepare("UPDATE horses SET birth_year=2095 WHERE id='horse_1'").run();
 db.prepare("UPDATE race_entries SET scratched=1,handicap_m=20 WHERE id='entry_1'").run();
 const e=(await getUpcomingGameLeg(env,'round_up',1)).entries[0];
 assert.equal(e.sex,'gelding');assert.equal(e.ageYears,4);
 assert.equal(e.trainerName,'Synthetic Trainer');
 assert.equal(e.handicapM,20);assert.equal(e.scratched,true);
 assert.deepEqual(e.equipment,{front:null,rear:null,cart:null,frontChanged:false,rearChanged:false,cartChanged:false});
});

test('upcoming equipment displays verified state and only flags comparison against immediately previous start',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,exact_sulky,verification_status,source_record_id) VALUES ('eq_today','entry_1','barefoot','barefoot',1,1,'Amerikansk','A','reported','src_current')").run();
 const noPrior=(await getUpcomingGameLeg(env,'round_up',1)).entries[0].equipment;
 assert.deepEqual(noPrior,{front:'barefoot',rear:'barefoot',cart:'Am.',frontChanged:false,rearChanged:false,cartChanged:false});
 db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,exact_sulky,verification_status,source_record_id) VALUES ('eq_prior','hist_auto_high_entry','shod','shod',0,0,'Vanlig','S','reported','src_hist_auto_high')").run();
 const changed=(await getUpcomingGameLeg(env,'round_up',1)).entries[0].equipment;
 assert.deepEqual(changed,{front:'barefoot',rear:'barefoot',cart:'Am.',frontChanged:true,rearChanged:true,cartChanged:true});
 db.prepare("UPDATE equipment SET verification_status='unknown' WHERE id='eq_prior'").run();
 const unknown=(await getUpcomingGameLeg(env,'round_up',1)).entries[0].equipment;
 assert.equal(unknown.frontChanged,false);assert.equal(unknown.rearChanged,false);assert.equal(unknown.cartChanged,false);
});

test('latest verified equipment snapshot wins without guessing missing dimensions',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,barefoot_front,sulky_type,exact_sulky,verification_status,source_record_id) VALUES ('eq_today','entry_1','shod',0,'Vanlig','S','reported','src_current')").run();
 const e=(await getUpcomingGameLeg(env,'round_up',1)).entries[0].equipment;
 assert.equal(e.front,'shod');assert.equal(e.rear,null);assert.equal(e.cart,'Va.');
 assert.equal(e.rearChanged,false);
});

test('age uses official same-year age observation without inferring birth year',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?,?,?,?,?,?,?)")
  .run('horse_age','horse','horse_1','src_current','2099-09-19T09:05:00Z',JSON.stringify({ageYears:6}),'normalized_verified_subset');
 const e=(await getUpcomingGameLeg(env,'round_up',1)).entries[0];
 assert.equal(e.birthYear,null);assert.equal(e.ageYears,6);
});
test('age refuses observation from a different calendar year',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?,?,?,?,?,?,?)")
  .run('old_age','horse','horse_1','src_current','2098-09-19T09:05:00Z',JSON.stringify({ageYears:6}),'normalized_verified_subset');
 const e=(await getUpcomingGameLeg(env,'round_up',1)).entries[0];
 assert.equal(e.ageYears,null);
});

test('an older equipped start must not substitute for the immediately preceding unknown start',async()=>{
 const {env,db}=createTestEnv();seedUpcoming(db);
 const rows=[
   ['eq_today','entry_1','barefoot','barefoot',1,1,'Amerikansk','A','src_current'],
   ['eq_older','hist_auto_weekday_entry','shod','shod',0,0,'Vanlig','S','src_hist_auto_weekday']
 ];
 for(const row of rows){
   db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,exact_sulky,verification_status,source_record_id) VALUES (?,?,?,?,?,?,?,?, 'reported',?)").run(...row);
 }
 const eq=(await getUpcomingGameLeg(env,'round_up',1)).entries[0].equipment;
 assert.equal(eq.front,'barefoot');assert.equal(eq.cart,'Am.');
 assert.equal(eq.frontChanged,false);assert.equal(eq.rearChanged,false);assert.equal(eq.cartChanged,false);
});
