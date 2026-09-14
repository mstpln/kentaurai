import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { seedPersonStart,seedPersonSnapshot,seedPersonXlabs } from './helpers/person-context.js';
import { PERSON_CONTEXT_CONTRACT_VERSION,PERSON_CONTEXT_FEATURE_VERSION,buildPersonContextV1ForEntries,getPersonContextVersionRegistry } from '../src/person-context-v1.js';

test('B5 registry exposes person context v1',()=>{
  const registry=getPersonContextVersionRegistry();assert.equal(registry.length,1);assert.equal(registry[0].family,'person_context');assert.equal(registry[0].version,PERSON_CONTEXT_FEATURE_VERSION);
});

test('B5 exposes relative person form, guarded segments and correct driver-horse denominator',async()=>{
  const {db,env}=createTestEnv();
  const target=seedPersonStart(db,{key:'target',date:'2026-09-20',target:true});
  const starts=[
    ['a1','2026-09-15','driver-a',1,false],['a2','2026-09-10','driver-a',2,false],['a3','2026-08-20','driver-a',4,true],
    ['b1','2026-08-01','driver-b',5,false],['b2','2026-07-15','driver-b',3,false]
  ];
  for(const [key,date,driver,placing,gallop] of starts){const start=seedPersonStart(db,{key,date,driver,placing,gallop});if(driver==='driver-a')seedPersonXlabs(db,start.entryId,key,`${date}T15:00:00Z`,'1.10,0 min/km');}
  seedPersonStart(db,{key:'other-horse',date:'2026-09-12',horse:'horse-b',driver:'driver-a',placing:1});
  seedPersonStart(db,{key:'trainer-other',date:'2026-09-05',horse:'horse-b',driver:'driver-b',trainer:'trainer-a',placing:2});
  const result=(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z')).get(target.entryId);
  assert.equal(result.contractVersion,PERSON_CONTEXT_CONTRACT_VERSION);
  assert.equal(result.driver.availability,'own_history');assert.equal(result.trainer.availability,'own_history');
  assert.equal(result.driver.windows['14'].starts,3);assert.equal(result.driver.windows['365'].starts,4);
  assert.notEqual(result.driver.windows['14'].top3_rate_delta_vs_365d.value,null);
  assert.equal(result.driverHorse.together_starts,3);assert.equal(result.driverHorse.other_driver_starts,2);
  assert.equal(result.driverHorse.together_top3_rate.value,2/3);assert.equal(result.driverHorse.other_driver_top3_rate.value,1/2);
  assert.equal(result.driverHorse.together_xlabs_first200_km_seconds.value,70);
  assert.equal(result.trainer.equipment_change_context.feature_owner,'equipment_response_v1');assert.equal(result.trainer.equipment_change_context.duplicated,false);
  assert.equal('favoriteResults' in result.driver,false);assert.equal('longshotResults' in result.driver,false);assert.equal('score' in result,false);
});

test('B5 provider annual stats are fallback and missing remains unavailable',async()=>{
  const {db,env}=createTestEnv();
  const target=seedPersonStart(db,{key:'target',date:'2026-09-20',target:true});
  seedPersonSnapshot(db,{type:'driver',id:'driver-a',starts:100,wins:20,seconds:15,thirds:10});
  const result=(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z')).get(target.entryId);
  assert.equal(result.driver.availability,'provider_fallback');assert.equal(result.driver.provider_annual_fallback.win_rate.value,0.2);
  assert.equal(result.driver.provider_annual_fallback.win_rate.sample_size,0);assert.equal(result.driver.provider_annual_fallback.win_rate.evidence_level,'C');
  assert.deepEqual(result.driver.provider_annual_fallback.completeness,{known_fields:4,total_fields:4,coverage:1});
  assert.deepEqual(result.driver.provider_annual_fallback.ranking,{status:'unavailable_in_normalized_source',value:null});
  assert.equal(result.trainer.availability,'unavailable');assert.equal(result.trainer.provider_annual_fallback.win_rate.value,null);
  assert.equal(result.trainer.provider_annual_fallback.completeness.coverage,0);
});

test('B5 suppresses sparse segment rates instead of presenting tiny-N signal',async()=>{
  const {db,env}=createTestEnv();const target=seedPersonStart(db,{key:'target',date:'2026-09-20',target:true});
  seedPersonStart(db,{key:'one',date:'2026-09-10',placing:1});seedPersonStart(db,{key:'two',date:'2026-09-01',placing:2,track:'track-b'});
  const result=(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z')).get(target.entryId);
  assert.equal(result.driver.segments.same_track.status,'insufficient_sample');assert.equal(result.driver.segments.same_track.starts,1);assert.equal(result.driver.segments.same_track.win_rate.value,null);
  assert.equal(result.driver.segments.same_start_method.status,'insufficient_sample');assert.equal(result.driver.segments.same_start_method.top3_rate.value,null);
});

test('B5 keeps a stable driver layout when the target driver is unknown',async()=>{
  const {db,env}=createTestEnv();
  const target=seedPersonStart(db,{key:'target',date:'2026-09-20',driver:null,target:true});
  seedPersonStart(db,{key:'history',date:'2026-09-10',driver:'driver-b',placing:2});
  const result=(await buildPersonContextV1ForEntries(env,[target.entryId],'2026-09-20T11:00:00Z')).get(target.entryId);
  assert.equal(result.driverId,null);assert.equal(result.driver.availability,'unavailable');
  assert.deepEqual(Object.keys(result.driver.windows),['14','30','90','365']);
  assert.equal(result.driver.windows['14'].win_rate.value,null);
  assert.equal(result.driver.provider_annual_fallback.ranking.value,null);
  assert.equal(result.driverHorse.status,'unavailable');assert.equal(result.driverHorse.together_starts,0);
});
