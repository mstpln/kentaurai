import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { syncTravdataPersonal, getTravdataPersonal } from '../src/travdata-personal.js';
import { manualWinningRowCounts, evaluateManualPayout, settleNextTravdataManualSystems } from '../src/travdata-manual-settlement.js';

const legs=Array.from({length:8},()=>[1,2]);
const winners=Array.from({length:8},()=>1);
const payouts={
  '8':{payoutSek:1000},'7':{payoutSek:100},
  '6':{payoutSek:10},'5':{payoutSek:1}
};

async function seed(env,{scratched=false,payoutsValue=payouts}={}){
  await env.DB.prepare("INSERT INTO horses(id,canonical_name) VALUES ('horse-a','A'),('horse-b','B')").run();
  await env.DB.prepare(
    "INSERT INTO game_rounds(id,game_type,round_date,status) VALUES ('V85_2026-11-07','V85','2026-11-07','results')"
  ).run();
  for(let i=1;i<=8;i++){
    await env.DB.prepare('INSERT INTO races(id,race_date,race_number,status) VALUES (?,?,?,?)')
      .bind('settle-race-'+i,'2026-11-07',i,'results').run();
    await env.DB.prepare('INSERT INTO game_legs(game_round_id,leg_number,race_id) VALUES (?,?,?)')
      .bind('V85_2026-11-07',i,'settle-race-'+i).run();
    for(let number=1;number<=2;number++){
      await env.DB.prepare('INSERT INTO race_entries(id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,?,?)')
        .bind('settle-entry-'+i+'-'+number,'settle-race-'+i,
          number===1?'horse-a':'horse-b',number,Number(scratched&&i===1&&number===2)).run();
      if(number===1)await env.DB.prepare(
        "INSERT INTO race_results(race_entry_id,placing,result_status) VALUES (?,1,'official')"
      ).bind('settle-entry-'+i+'-'+number).run();
    }
  }
  await env.DB.prepare(
    "INSERT INTO source_records(id,source_type,fetched_at) VALUES ('final-source','official_provider','2026-11-07T17:00:00Z')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO game_round_final_results(game_round_id,game_type,source_record_id,captured_at,status,payouts_json) " +
    "VALUES ('V85_2026-11-07','V85','final-source','2026-11-07T17:00:00Z','results',?)"
  ).bind(JSON.stringify(payoutsValue)).run();
  await syncTravdataPersonal(env,{systems:[{
    id:'system-test',roundId:'V85_2026-11-07',gameType:'V85',
    systemName:'Matematiskt',legs,
    createdAt:'2026-11-07T12:00:00.000Z',updatedAt:'2026-11-07T12:00:00.000Z'
  }]});
}

test('the exact-row distribution includes lower-tier wins on covered systems', () => {
  const rows=manualWinningRowCounts(legs,winners);
  assert.deepEqual(rows.slice(5),[56,28,8,1]);
  assert.equal(rows.reduce((a,b)=>a+b,0),256);
  const result=evaluateManualPayout(legs,winners,'V85',payouts);
  assert.equal(result.state,'settled');
  assert.equal(result.payoutSek,2136);
  assert.equal(result.correctLegs,8);
  assert.deepEqual(result.winningLines,{'5':56,'6':28,'7':8,'8':1});
});

test('automatic manual-system settlement uses only official unique winners and verified payouts', async () => {
  const {env}=createTestEnv();
  await seed(env);
  const status=await settleNextTravdataManualSystems(env,{now:'2026-11-08T05:15:00Z'});
  assert.equal(status.processed,1);
  assert.equal(status.settled,1);
  const {systems}=await getTravdataPersonal(env);
  assert.equal(systems.length,1);
  assert.equal(systems[0].payoutSek,2136);
  assert.equal(systems[0].stakeSek,128);
  assert.equal(systems[0].netSek,2008);
  assert.equal(systems[0].correctLegs,8);
  assert.deepEqual(systems[0].winnerNumbers,winners);
  assert.equal((await settleNextTravdataManualSystems(env,{now:'2026-11-08T05:15:00Z'})).processed,0);
});

test('selected scratches are left for manual reserve review, never guessed',async()=>{
  const {env}=createTestEnv();
  await seed(env,{scratched:true});
  const status=await settleNextTravdataManualSystems(env,{now:'2026-11-08T05:15:00Z'});
  assert.equal(status.manualReview,1);
  const {systems}=await getTravdataPersonal(env);
  assert.equal(systems[0].settlementState,'manual_review');
  assert.equal(systems[0].payoutSek,null);
});

test('a missing paid tier is not converted to zero',async()=>{
  const {env}=createTestEnv();
  await seed(env,{payoutsValue:{...payouts,'6':{payoutSek:null}}});
  const status=await settleNextTravdataManualSystems(env,{now:'2026-11-08T05:15:00Z'});
  assert.equal(status.manualReview,1);
  const {systems}=await getTravdataPersonal(env);
  assert.equal(systems[0].payoutSek,null);
});

test('missing final results leave a due-state checkpoint rather than faking a winner',async()=>{
  const {env}=createTestEnv();
  await seed(env);
  await env.DB.prepare("DELETE FROM game_round_final_results WHERE game_round_id='V85_2026-11-07'").run();
  const status=await settleNextTravdataManualSystems(env,{now:'2026-11-08T05:15:00Z'});
  assert.equal(status.pending,1);
  const row=await env.DB.prepare(
    "SELECT settlement_state,next_check_at FROM travdata_manual_systems WHERE id='system-test'"
  ).first();
  assert.equal(row.settlement_state,'pending');
  assert.equal(row.next_check_at,'2026-11-08T17:15:00.000Z');
});
