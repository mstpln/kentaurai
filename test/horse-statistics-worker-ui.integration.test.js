import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { enhanceHorseStatisticsHtml } from '../src/horse-statistics-ui.js';

function seedHorse(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-h','Synthetic Track')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-h','Synthetic Trainer')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-h','Synthetic Driver')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-h','Synthetic Horse','sto',2020,'varmblodig travare')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,status) VALUES ('race-h','track-h','2026-09-11',1,2140,'auto',50000,'Synthetic race','results')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES ('entry-h','race-h','horse-h','driver-h','trainer-h',1,0)").run();
  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,prize_sek) VALUES ('entry-h',1,'official',0,50000)").run();
}

async function authenticatedCookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('horse statistics routes are private through actual Worker', async () => {
  const {env,db}=createTestEnv();seedHorse(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';
  const url='https://example.test/app/api/horses/statistics?period=1y&race_scope=all&race_type=all&breed_type=all&start_method=all&distance_group=all&sex=all&age=all&min_starts=all';
  let response=await worker.fetch(new Request(url),env);assert.equal(response.status,401);
  const cookie=await authenticatedCookie(env);
  response=await worker.fetch(new Request(url,{headers:{cookie}}),env);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.rankings.highestWinRate[0].id,'horse-h');assert.equal(data.startPointsStatus,'verified_official_life_statistics');
  response=await worker.fetch(new Request('https://example.test/app/api/horses/horse-h/statistics?period=1y',{headers:{cookie}}),env);assert.equal(response.status,200);
  const detail=await response.json();assert.equal(detail.summary.winRate,1);assert.equal(detail.startPointsStatus,'verified_official_life_statistics');assert.equal(detail.currentStartPoints,null);
});

test('horse statistics route returns 400 for invalid filters and 404 for missing horse', async () => {
  const {env,db}=createTestEnv();seedHorse(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const cookie=await authenticatedCookie(env);
  let response=await worker.fetch(new Request('https://example.test/app/api/horses/statistics?distance_group=bad',{headers:{cookie}}),env);assert.equal(response.status,400);
  response=await worker.fetch(new Request('https://example.test/app/api/horses/missing/statistics',{headers:{cookie}}),env);assert.equal(response.status,404);
});

test('actual Worker HTML contains horse Build B UI after Trend composition', async () => {
  const {env}=createTestEnv();env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const cookie=await authenticatedCookie(env);
  const response=await worker.fetch(new Request('https://example.test/app/',{headers:{cookie}}),env);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/id="kentaurai-trend-build-a-script"/);assert.match(html,/id="kentaurai-horse-statistics-build-b-script"/);
  assert.ok(html.indexOf('kentaurai-trend-build-a-script')<html.indexOf('kentaurai-horse-statistics-build-b-script'));
  for(const text of ['Högst segerprocent','Högst topp 3-procent','Bäst form – senaste 10','Startsnabbaste','Högst startpoäng','Starkaste avslutare','Första starten efter vila','Andra starten efter vila']) assert.match(html,new RegExp(text));
  assert.match(html,/@media\(max-width:430px\)/);assert.match(html,/@media\(max-width:320px\)/);assert.match(html,/Senast verifierade officiella observation/);
});

test('horse UI enhancer preserves HTML and injects syntactically valid JavaScript', () => {
  const html=enhanceHorseStatisticsHtml('<html><head></head><body><main id="keep">keep</main></body></html>');assert.match(html,/id="keep">keep/);
  const match=html.match(/<script id="kentaurai-horse-statistics-build-b-script">([\s\S]*?)<\/script>/);assert.ok(match);assert.doesNotThrow(()=>new vm.Script(match[1]));
});
