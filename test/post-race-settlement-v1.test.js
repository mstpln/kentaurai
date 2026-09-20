import test from 'node:test';
import assert from 'node:assert/strict';

import { stableId } from '../src/ids.js';
import {
  ensurePostRaceSettlementJobs,
  getPostRaceSettlementJob,
  runNextPostRaceSettlement,
  runPostRaceSettlementBatch
} from '../src/post-race-settlement-v1.js';
import { createTestEnv } from './helpers/d1.js';
import worker from '../src/worker-pwa.js';

const DATE='2099-05-10';
const ROUND_ID='V85_2099-05-10_96_1';

function person(id, firstName, lastName) {
  return { id, firstName, lastName, homeTrack:{ id:96, name:'Synthetic Foreign Park' } };
}

function racePayload(raceNumber,{final=true,countryCode='NO'}={}) {
  const raceId=`${DATE}_96_${raceNumber}`;
  const horseExternalId=7000+raceNumber;
  const start={
    id:`${raceId}_1`,
    number:1,
    postPosition:1,
    distance:2140,
    horse:{
      id:horseExternalId,
      name:`Synthetic Winner ${raceNumber}`,
      trainer:person(9000+raceNumber,'Tina','Trainer')
    },
    driver:person(8000+raceNumber,'Dora','Driver')
  };
  if(final){
    start.result={
      place:1,
      finishOrder:1,
      kmTime:{minutes:1,seconds:12,tenths:raceNumber%10},
      prizeMoney:10000,
      finalOdds:2.5,
      startNumber:1
    };
  }
  return {
    id:raceId,
    name:'Synthetic post-race',
    date:DATE,
    number:raceNumber,
    distance:2140,
    startMethod:'auto',
    startTime:`${DATE}T1${raceNumber}:00:20Z`,
    scheduledStartTime:`${DATE}T1${raceNumber}:00:00Z`,
    status:final?'results':'ongoing',
    track:{id:96,name:'Synthetic Foreign Park',countryCode,sportSystemCode:'T'},
    starts:[start]
  };
}

function seedUnsettledRound(db,{countryCode='NO',liveEntryIds=false}={}) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track_settlement','Synthetic Foreign Park',?)").run(countryCode);
  db.prepare(`INSERT INTO game_rounds
    (id,game_type,round_date,scheduled_start_at,status)
    VALUES (?,'V85',?,'${DATE}T11:00:00Z','bettable')`).run(ROUND_ID,DATE);

  const systemId='system_settlement';
  db.prepare(`INSERT INTO systems
    (id,game_round_id,system_type,budget_sek,row_count,spike_count,created_at)
    VALUES (?,?,'main',200,1,3,'${DATE}T09:00:00Z')`).run(systemId,ROUND_ID);

  for(let leg=1;leg<=8;leg++){
    const raceId=`${DATE}_96_${leg}`;
    const horseId=stableId('horse','official',String(7000+leg));
    const sourceStartId=`${raceId}_1`;
    const entryId=liveEntryIds?stableId('entry','official',raceId,sourceStartId):stableId('entry',raceId,horseId);
    db.prepare(`INSERT INTO races
      (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status,source_quality)
      VALUES (?,'track_settlement',?,?,?,2140,'auto','scheduled','normalized_verified_subset')`)
      .run(raceId,DATE,leg,`${DATE}T1${leg}:00:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)`).run(ROUND_ID,leg,raceId);
    db.prepare(`INSERT INTO horses (id,canonical_name) VALUES (?,?)`).run(horseId,`Synthetic Winner ${leg}`);
    db.prepare(`INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)`).run(horseId,String(7000+leg));
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,source_start_id,start_number,actual_start_distance_m,scratched,data_quality)
      VALUES (?,?,?,?,1,2140,0,'official_declared_start_scratch_unverified')`).run(entryId,raceId,horseId,liveEntryIds?sourceStartId:null);
    db.prepare(`INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike)
      VALUES (?,?,?,?)`).run(systemId,leg,entryId,leg<=3?1:0);
  }
  return {systemId};
}

function response(payload){return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});}

test('post-race settlement creates recovery jobs for saved unresolved rounds, including foreign tracks', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db,{countryCode:'NO'});
  const created=await ensurePostRaceSettlementJobs(env,'2099-05-11T00:00:00Z');
  assert.equal(created.eligible,1);
  assert.equal(created.created,1);
  const job=await getPostRaceSettlementJob(env,ROUND_ID);
  assert.equal(job.status,'pending');
  assert.equal(job.settled_legs,0);
});

test('post-race settlement captures and normalizes exact known legs without relying on Swedish historical discovery', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db,{countryCode:'NO'});
  const requested=[];
  const fetchImpl=async(url)=>{
    const raceId=url.split('/').pop();
    requested.push(raceId);
    return response(racePayload(Number(raceId.split('_').pop())));
  };
  const result=await runNextPostRaceSettlement(env,{roundId:ROUND_ID,now:'2099-05-11T00:00:00Z',fetchImpl});
  assert.equal(result.status,'running');
  assert.equal(result.legNumber,1);
  assert.equal(result.settledLegs,1);
  assert.deepEqual(requested,[`${DATE}_96_1`]);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM race_results rr JOIN race_entries re ON re.id=rr.race_entry_id WHERE re.race_id=? AND rr.placing=1`).get(`${DATE}_96_1`).n,1);
});

test('post-race settlement waits and retries when official results are not final, without writing guessed results', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db);
  const result=await runNextPostRaceSettlement(env,{
    roundId:ROUND_ID,
    now:'2099-05-11T00:00:00Z',
    fetchImpl:async()=>response(racePayload(1,{final:false}))
  });
  assert.equal(result.status,'waiting');
  assert.equal(result.reason,'results_not_final');
  assert.equal(result.settledLegs,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_results').get().n,0);
  const job=await getPostRaceSettlementJob(env,ROUND_ID);
  assert.equal(job.status,'waiting');
  assert.ok(job.next_check_at>'2099-05-11T00:00:00Z');
});

test('bounded settlement batch settles three legs per invocation and completes idempotently with X-Labs date job', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db);
  const fetchImpl=async(url)=>{
    const raceId=url.split('/').pop();
    return response(racePayload(Number(raceId.split('_').pop())));
  };
  let result=await runPostRaceSettlementBatch(env,{roundId:ROUND_ID,now:'2099-05-11T00:00:00Z',fetchImpl});
  assert.equal(result.stepCount,3);
  assert.equal(result.settledLegs,3);
  result=await runPostRaceSettlementBatch(env,{roundId:ROUND_ID,now:'2099-05-11T00:01:00Z',fetchImpl});
  assert.equal(result.settledLegs,6);
  result=await runPostRaceSettlementBatch(env,{roundId:ROUND_ID,now:'2099-05-11T00:02:00Z',fetchImpl});
  assert.equal(result.status,'completed');
  assert.equal(result.settledLegs,8);

  const job=await getPostRaceSettlementJob(env,ROUND_ID);
  assert.equal(job.status,'completed');
  assert.equal(job.settled_legs,8);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM xlabs_backfill_jobs WHERE scope='daily_v85_v86' AND start_date=? AND end_date=?`).get(DATE,DATE).n,1);

  const again=await runNextPostRaceSettlement(env,{roundId:ROUND_ID,now:'2099-05-11T00:03:00Z',fetchImpl:async()=>{throw new Error('must not refetch');}});
  assert.equal(again.status,'completed');
  assert.equal(again.reused,true);
});

test('same-day settlement starts only after the latest known race start plus safety delay', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db);
  let created=await ensurePostRaceSettlementJobs(env,`${DATE}T18:30:00Z`);
  assert.equal(created.created,0);
  created=await ensurePostRaceSettlementJobs(env,`${DATE}T18:46:00Z`);
  assert.equal(created.created,1);
});


test('post-race settlement operational routes remain behind ADMIN_TOKEN', async()=>{
  const {env}=createTestEnv();
  env.ADMIN_TOKEN='synthetic-admin';
  const denied=await worker.fetch(new Request('https://example.test/v1/post-race/settle-next',{method:'POST'}),env);
  assert.equal(denied.status,401);
  const allowed=await worker.fetch(new Request('https://example.test/v1/post-race/settle-next',{
    method:'POST',
    headers:{authorization:'Bearer synthetic-admin'}
  }),env);
  assert.equal(allowed.status,200);
  assert.equal((await allowed.json()).status,'idle');

  const statusDenied=await worker.fetch(new Request('https://example.test/v1/post-race/settlement/missing'),env);
  assert.equal(statusDenied.status,401);
});


test('post-race settlement preserves existing live race-entry identity when ordinary-race results are normalized', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db,{liveEntryIds:true});
  const raceId=`${DATE}_96_1`;
  const sourceStartId=`${raceId}_1`;
  const expectedEntryId=stableId('entry','official',raceId,sourceStartId);
  const result=await runNextPostRaceSettlement(env,{
    roundId:ROUND_ID,
    now:'2099-05-11T00:00:00Z',
    fetchImpl:async()=>response(racePayload(1))
  });
  assert.equal(result.status,'running');
  assert.equal(db.prepare('SELECT id FROM race_entries WHERE race_id=?').get(raceId).id,expectedEntryId);
  assert.equal(db.prepare('SELECT race_entry_id FROM race_results WHERE race_entry_id=?').get(expectedEntryId).race_entry_id,expectedEntryId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_entries WHERE race_id=?').get(raceId).n,1);
});

test('final official results without exactly one winner fail closed for manual review', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db);
  const payload=racePayload(1);
  payload.starts[0].result={place:null,finishOrder:null,disqualified:true,galloped:false,prizeMoney:0,finalOdds:9};
  const result=await runNextPostRaceSettlement(env,{
    roundId:ROUND_ID,
    now:'2099-05-11T00:00:00Z',
    fetchImpl:async()=>response(payload)
  });
  assert.equal(result.status,'manual_review');
  assert.equal(result.reason,'missing_unique_winner');
  assert.equal(result.legNumber,1);
  const job=await getPostRaceSettlementJob(env,ROUND_ID);
  assert.equal(job.status,'manual_review');
  assert.match(job.last_error,/final official results but no unique factual winner/);
});


test('post-race settlement safely binds final results to an existing start when horse identity is missing', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db,{liveEntryIds:true});
  const raceId=`${DATE}_96_1`;
  const sourceStartId=`${raceId}_1`;
  const entryId=stableId('entry','official',raceId,sourceStartId);

  db.prepare('UPDATE race_entries SET horse_id=NULL, declared_horse_name=? WHERE id=?')
    .run('Synthetic Winner 1',entryId);

  const payload=racePayload(1);
  payload.starts[0].horse={};

  const result=await runNextPostRaceSettlement(env,{
    roundId:ROUND_ID,
    now:'2099-05-11T00:00:00Z',
    fetchImpl:async()=>response(payload)
  });

  assert.equal(result.status,'running');
  assert.equal(result.settledLegs,1);
  const stored=db.prepare('SELECT id,horse_id,declared_horse_name FROM race_entries WHERE race_id=? AND start_number=1').get(raceId);
  assert.equal(stored.id,entryId);
  assert.equal(stored.horse_id,null);
  assert.equal(stored.declared_horse_name,'Synthetic Winner 1');
  assert.equal(db.prepare('SELECT placing FROM race_results WHERE race_entry_id=?').get(entryId).placing,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_entries WHERE race_id=?').get(raceId).n,1);
});

test('post-race settlement fails closed when missing horse identity cannot be matched uniquely', async()=>{
  const {env,db}=createTestEnv();
  seedUnsettledRound(db,{liveEntryIds:true});
  const raceId=`${DATE}_96_1`;
  const payload=racePayload(1);
  payload.starts[0].id='unknown_source_start';
  payload.starts[0].number=99;
  payload.starts[0].horse={ name:'Unknown horse' };
  delete payload.starts[0].horse.id;

  await assert.rejects(
    ()=>runNextPostRaceSettlement(env,{
      roundId:ROUND_ID,
      now:'2099-05-11T00:00:00Z',
      fetchImpl:async()=>response(payload)
    }),
    /missing horse identity/
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_results').get().n,0);
});
