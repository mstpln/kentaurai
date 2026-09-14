import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { seedPersonStart,seedPersonSnapshot,seedPersonXlabs } from './helpers/person-context.js';
import { buildPersonContextV1ForEntries } from '../src/person-context-v1.js';

test('B5 is deterministic, market blind and ignores post-cutoff facts',async()=>{
  const {db,env}=createTestEnv();const target=seedPersonStart(db,{key:'target',date:'2026-09-20',target:true});
  const historical=seedPersonStart(db,{key:'history',date:'2026-09-10',placing:2,resultObserved:'2026-09-10T14:00:00Z'});seedPersonXlabs(db,historical.entryId,'history','2026-09-10T15:00:00Z');
  const before=await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z');
  db.prepare("INSERT INTO game_rounds(id,game_type,round_date,status) VALUES('g','V85','2026-09-20','scheduled')").run();db.prepare("INSERT INTO game_legs(game_round_id,leg_number,race_id) VALUES('g',1,?)").run(target.raceId);db.prepare("INSERT INTO betting_snapshots(id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank) VALUES('b','g',1,?,'2026-09-20T10:00:00Z',99,1)").run(target.entryId);db.prepare("INSERT INTO odds_snapshots(id,race_entry_id,captured_at,market_type,odds) VALUES('o',?,'2026-09-20T10:00:00Z','winner',1.01)").run(target.entryId);
  seedPersonSnapshot(db,{type:'driver',id:'driver-a',observed:'2026-09-20T12:00:00Z',starts:999,wins:999,key:'late-driver'});
  seedPersonStart(db,{key:'late-result',date:'2026-09-19',placing:1,resultObserved:'2026-09-20T12:00:00Z'});
  const after=await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z');
  assert.deepEqual(after,before);assert.deepEqual(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z'),before);
});

test('B5 provenance includes result, provider and used X-Labs observations',async()=>{
  const {db,env}=createTestEnv();const target=seedPersonStart(db,{key:'target',date:'2026-09-20',target:true});const start=seedPersonStart(db,{key:'history',date:'2026-09-10',placing:1});seedPersonXlabs(db,start.entryId,'history','2026-09-10T15:00:00Z');seedPersonSnapshot(db,{type:'driver',id:'driver-a',key:'driver'});
  const result=(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z')).get(target.entryId);const ids=new Set(result.provenance.source_refs.map((ref)=>ref.source_record_id));
  assert.ok(ids.has('result-history'));assert.ok(ids.has('xlabs-history'));assert.ok(ids.has('person-source-driver'));assert.equal(result.provenance.contract_version,'kentaurai-feature-provenance-v1');
});
