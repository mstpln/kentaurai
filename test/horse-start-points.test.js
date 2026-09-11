import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { syncHorseStartPointsFromSource, verifiedOfficialStartPoints } from '../src/import/official-start-points.js';
import { getHorseRankings, getHorseDetailStatistics } from '../src/statistics/horses-complete.js';

function putHorse(db, id='horse-a', externalId='100') {
  db.prepare('INSERT INTO horses (id, canonical_name, sex, birth_year, breed) VALUES (?, ?, ?, ?, ?)').run(id, id, 'sto', 2020, 'varmblodig travare');
  db.prepare("INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES (?, 'official', ?)").run(id, externalId);
}

function putHistory(db, horseId='horse-a') {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-a','Bana A')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-a','Kusk A')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-a','Tränare A')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,source_quality) VALUES ('race-a','track-a','2026-09-01',1,2140,'auto',50000,'Vanligt lopp','verified')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES ('entry-a','race-a',?,'driver-a','trainer-a',1,0)").run(horseId);
  db.prepare("INSERT INTO race_results (race_entry_id,placing,prize_sek,gallop,result_status) VALUES ('entry-a',1,10000,0,'official')").run();
}

function source(db, id, fetchedAt, key) {
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,raw_object_key,quality_status) VALUES (?, 'official_provider', ?, ?, ?, 'normalized_verified_subset')").run(id,`game:${id}`,fetchedAt,key);
}

function rawBucket(objects) {
  return {
    async get(key) {
      const value = objects[key];
      if (value == null) return null;
      return { async text() { return JSON.stringify(value); } };
    }
  };
}

function gamePayload(externalHorseId, points) {
  return { races: [{ starts: [{ horse: { id: externalHorseId, name: 'Synthetic Horse', statistics: { life: { startPoints: points } } } }] }] };
}

test('official startPoints field is fail-closed and exact', () => {
  assert.equal(verifiedOfficialStartPoints({statistics:{life:{startPoints:0}}}),0);
  assert.equal(verifiedOfficialStartPoints({statistics:{life:{}}}),null);
  assert.throws(()=>verifiedOfficialStartPoints({statistics:{life:{startPoints:-1}}}),/non-negative integer/);
  assert.throws(()=>verifiedOfficialStartPoints({statistics:{life:{startPoints:1.5}}}),/non-negative integer/);
  assert.throws(()=>verifiedOfficialStartPoints({statistics:{life:{startPoints:'10'}}}),/non-negative integer/);
});

test('source sync stores idempotent timeline observations and never lets an older fetch overwrite current cache', async () => {
  const {db,env}=createTestEnv();putHorse(db);env.RAW_BUCKET=rawBucket({new:gamePayload('100',1200),old:gamePayload('100',900)});
  source(db,'source-new','2026-09-11T10:00:00Z','new');
  source(db,'source-old','2026-09-10T10:00:00Z','old');
  let result=await syncHorseStartPointsFromSource(env,'source-new');assert.equal(result.horseObservationCount,1);
  result=await syncHorseStartPointsFromSource(env,'source-new');assert.equal(result.horseObservationCount,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_start_points').get().n,1,'same horse/source is idempotent');
  await syncHorseStartPointsFromSource(env,'source-old');
  const current=db.prepare('SELECT current_start_points,current_start_points_observed_at FROM horses WHERE id=?').get('horse-a');
  assert.equal(current.current_start_points,1200);assert.equal(current.current_start_points_observed_at,'2026-09-11T10:00:00Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_start_points').get().n,2,'older verified observation is preserved as history');
});

test('start-point statistics use latest verified observation at the selected as-of date', async () => {
  const {db,env}=createTestEnv();putHorse(db);putHistory(db);env.RAW_BUCKET=rawBucket({old:gamePayload('100',900),new:gamePayload('100',1200)});
  source(db,'source-old','2026-09-05T10:00:00Z','old');source(db,'source-new','2026-09-11T10:00:00Z','new');
  await syncHorseStartPointsFromSource(env,'source-old');await syncHorseStartPointsFromSource(env,'source-new');
  let data=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-10'});
  assert.equal(data.rankings.highestStartPoints[0].points,900);
  assert.equal(data.startPointsStatus,'verified_official_life_statistics');
  data=await getHorseRankings(env,{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(data.rankings.highestStartPoints[0].points,1200);
  const detail=await getHorseDetailStatistics(env,'horse-a',{period:'1y',asOfDate:'2026-09-11'});
  assert.equal(detail.currentStartPoints.points,1200);
  assert.deepEqual(detail.startPointHistory.map(x=>x.points),[1200,900]);
  assert.equal(detail.startPointHistory[0].sourceRecordId,'source-new');
});

test('source sync records schema failures without inventing a value', async () => {
  const {db,env}=createTestEnv();putHorse(db);env.RAW_BUCKET=rawBucket({bad:gamePayload('100','not-a-number')});source(db,'source-bad','2026-09-11T10:00:00Z','bad');
  await assert.rejects(()=>syncHorseStartPointsFromSource(env,'source-bad'),/non-negative integer/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horse_start_points').get().n,0);
  const sync=db.prepare('SELECT status,error_message FROM horse_start_point_source_sync WHERE source_record_id=?').get('source-bad');
  assert.equal(sync.status,'failed');assert.match(sync.error_message,/startPoints/);
});
