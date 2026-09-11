import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { enhanceTrainerStatisticsHtml } from '../src/trainer-statistics-ui.js';

function seedTrainer(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-t','Synthetic Track')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-t','Synthetic Trainer')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-t','Synthetic Driver')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-t','Synthetic Horse','sto',2020,'varmblodig travare')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,status) VALUES ('race-t','track-t','2026-09-11',1,2140,'auto',50000,'Synthetic race','results')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES ('entry-t','race-t','horse-t','driver-t','trainer-t',1,0)").run();
  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,prize_sek) VALUES ('entry-t',1,'official',0,50000)").run();
}
async function cookie(env){return(await createAppSessionCookie(env)).split(';')[0];}

test('trainer statistics routes are private through actual Worker', async()=>{
  const {env,db}=createTestEnv();seedTrainer(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';
  const url='https://example.test/app/api/trainers/statistics?period=1y&race_scope=all&race_type=all&breed_type=all&sex=all&age=all&start_method=all&distance_group=all&volt_lane=all&handicap_m=all&min_starts=all';
  let response=await worker.fetch(new Request(url),env);assert.equal(response.status,401);
  const auth=await cookie(env);response=await worker.fetch(new Request(url,{headers:{cookie:auth}}),env);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.rankings.highestWinRate[0].id,'trainer-t');assert.equal(data.definitions.restDays,60);
  response=await worker.fetch(new Request('https://example.test/app/api/trainers/trainer-t/statistics?period=1y',{headers:{cookie:auth}}),env);assert.equal(response.status,200);
  const detail=await response.json();assert.equal(detail.trainer.id,'trainer-t');assert.equal(detail.summary.winRate,1);
});

test('trainer routes reject invalid filters and return 404 for unknown trainer', async()=>{
  const {env,db}=createTestEnv();seedTrainer(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const auth=await cookie(env);
  let response=await worker.fetch(new Request('https://example.test/app/api/trainers/statistics?age=1',{headers:{cookie:auth}}),env);assert.equal(response.status,400);
  response=await worker.fetch(new Request('https://example.test/app/api/trainers/missing/statistics',{headers:{cookie:auth}}),env);assert.equal(response.status,404);
});

test('actual Worker composes Build D after horse and driver statistics with responsive safeguards', async()=>{
  const {env}=createTestEnv();env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const auth=await cookie(env);
  const response=await worker.fetch(new Request('https://example.test/app/',{headers:{cookie:auth}}),env);assert.equal(response.status,200);const html=await response.text();
  for(const id of ['kentaurai-trend-build-a-script','kentaurai-horse-statistics-build-b-script','kentaurai-driver-statistics-build-c-script','kentaurai-trainer-statistics-build-d-script'])assert.match(html,new RegExp(id));
  assert.ok(html.indexOf('kentaurai-driver-statistics-build-c-script')<html.indexOf('kentaurai-trainer-statistics-build-d-script'));
  for(const text of ['Bäst på hemmabana','Bäst på övriga banor','Första starten efter vila','Andra starten efter vila','Bäst på tillägg','Bäst kort distans'])assert.match(html,new RegExp(text));
  assert.match(html,/@media\(max-width:430px\)/);assert.match(html,/@media\(max-width:320px\)/);
});

test('trainer UI enhancer preserves HTML and injects valid JavaScript',()=>{
  const html=enhanceTrainerStatisticsHtml('<html><head></head><body><main id="keep">keep</main></body></html>');assert.match(html,/id="keep">keep/);
  const match=html.match(/<script id="kentaurai-trainer-statistics-build-d-script">([\s\S]*?)<\/script>/);assert.ok(match);assert.doesNotThrow(()=>new vm.Script(match[1]));
});
