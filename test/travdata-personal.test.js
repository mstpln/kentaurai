import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getTravdataPersonal, syncTravdataPersonal } from '../src/travdata-personal.js';
import worker from '../src/worker-v079.js';
import { createAppSessionCookie } from '../src/app-auth.js';

async function seedRound(env) {
  await env.DB.prepare("INSERT INTO horses(id,canonical_name) VALUES ('horse-private','Test Horse')").run();
  await env.DB.prepare(
    "INSERT INTO game_rounds(id,game_type,round_date,status) VALUES ('V85_2026-11-14','V85','2026-11-14','scheduled')"
  ).run();
  for (let i=1;i<=8;i++) {
    await env.DB.prepare('INSERT INTO races(id,race_date,race_number) VALUES (?,?,?)')
      .bind('race-personal-'+i,'2026-11-14',i).run();
    await env.DB.prepare('INSERT INTO game_legs(game_round_id,leg_number,race_id) VALUES (?,?,?)')
      .bind('V85_2026-11-14',i,'race-personal-'+i).run();
  }
  await env.DB.prepare(
    "INSERT INTO race_entries(id,race_id,horse_id,start_number) VALUES ('entry-private','race-personal-1','horse-private',1)"
  ).run();
}
const at='2026-11-08T12:00:00.000Z';
const picks = [[1,2,3],[1],[1,2],[1],[1,2],[1],[1,2],[1,2]];
const note = {
  id:'note-private-1',horseId:'horse-private',raceEntryId:'entry-private',
  text:'Verifierad anteckning',createdAt:at,updatedAt:at
};
const system = {
  id:'system-private-1',roundId:'V85_2026-11-14',gameType:'V85',
  systemName:'Testsystem',legs:picks,createdAt:at,updatedAt:at
};

test('personal notes and arbitrary-spike manual systems persist idempotently in separate D1 tables', async () => {
  const {env}=createTestEnv();
  await seedRound(env);
  const result=await syncTravdataPersonal(env,{notes:[note],systems:[system],tombstones:[]});
  assert.equal(result.ok,true);
  await syncTravdataPersonal(env,{notes:[note],systems:[system]});
  const page=await getTravdataPersonal(env);
  assert.equal(page.notes.length,1);
  assert.equal(page.notes[0].raceEntryId,'entry-private');
  assert.equal(page.systems.length,1);
  assert.equal(page.systems[0].rowCount,3*1*2*1*2*1*2*2);
  assert.equal(page.systems[0].stakeSek,24);
  assert.equal(page.systems[0].settlementState,'pending');
  assert.equal(page.systems[0].payoutSek,null);
  assert.equal(page.systems[0].legs.filter(x=>x.length===1).length,3);
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM systems').first();
  assert.equal(count.n,0,'legacy AI systems must remain untouched');
});

test('manual V86 systems may contain zero spikes without using legacy three-spike validation', async () => {
  const {env}=createTestEnv();
  await seedRound(env);
  await env.DB.prepare("UPDATE game_rounds SET game_type='V86' WHERE id='V85_2026-11-14'").run();
  const allTwo={...system,gameType:'V86',legs:Array.from({length:8},()=>[1,2])};
  await syncTravdataPersonal(env,{systems:[allTwo]});
  const page=await getTravdataPersonal(env);
  assert.equal(page.systems[0].rowCount,256);
  assert.equal(page.systems[0].stakeSek,64);
});

test('revision-aware notes and tombstones prevent stale offline resurrection', async () => {
  const {env}=createTestEnv();
  await seedRound(env);
  await syncTravdataPersonal(env,{notes:[note],systems:[system]});
  const updated={...note,text:'Ny version',updatedAt:'2026-11-08T13:00:00.000Z'};
  await syncTravdataPersonal(env,{notes:[updated]});
  await syncTravdataPersonal(env,{notes:[note]});
  let page=await getTravdataPersonal(env);
  assert.equal(page.notes[0].text,'Ny version');
  const deletedAt='2026-11-08T14:00:00.000Z';
  await syncTravdataPersonal(env,{tombstones:[
    {kind:'note',id:note.id,deletedAt},
    {kind:'system',id:system.id,deletedAt}
  ]});
  await syncTravdataPersonal(env,{notes:[updated],systems:[system]});
  await syncTravdataPersonal(env,{notes:[{...updated,updatedAt:'2026-11-09T10:00:00.000Z'}]});
  page=await getTravdataPersonal(env);
  assert.equal(page.notes.length,0);
  assert.equal(page.systems.length,0);
  assert.equal(page.tombstones.length,2);
});

test('canonical ID, current-leg and race-reference validation fails before mutations', async () => {
  const {env}=createTestEnv();
  await seedRound(env);
  await assert.rejects(()=>syncTravdataPersonal(env,{notes:[{...note,horseId:'missing-horse'}]}),/unknown_horse_id/);
  await assert.rejects(()=>syncTravdataPersonal(env,{notes:[{...note,raceEntryId:'unknown-start'}]}),/invalid_race_entry_link/);
  await assert.rejects(()=>syncTravdataPersonal(env,{systems:[{...system,roundId:'missing-round'}]}),/invalid_canonical_round/);
  await assert.rejects(()=>syncTravdataPersonal(env,{systems:[{...system,legs:[[1],[1],[1],[1],[1],[1],[1],[]]}]}),/invalid_system_leg/);
  const page=await getTravdataPersonal(env);
  assert.equal(page.notes.length,0);
  assert.equal(page.systems.length,0);
});

test('personal API is session protected and synthetic preview cannot write production data', async () => {
  const {env}=createTestEnv();
  env.APP_PASSWORD='synthetic-test-app-password';
  await seedRound(env);
  const url='https://example.test/app/api/travdata/personal';
  const denied=await worker.fetch(new Request(url),env,{});
  assert.equal(denied.status,401);
  const cookie=(await createAppSessionCookie(env)).split(';')[0];
  const authorized=await worker.fetch(new Request(url,{headers:{cookie}}),env,{});
  assert.equal(authorized.status,200);
  const body=await authorized.json();
  assert.equal(body.notes.length,0);
  const validPost={method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({notes:[note]})};
  const post=await worker.fetch(new Request(url,validPost),env,{});
  assert.equal(post.status,200);
  env.PREVIEW_DATA_MODE='synthetic';
  const blocked=await worker.fetch(new Request(url,validPost),env,{});
  assert.equal(blocked.status,403);
  const preview=await worker.fetch(new Request(url,{headers:{cookie}}),env,{});
  assert.deepEqual((await preview.json()).notes,[]);
});
