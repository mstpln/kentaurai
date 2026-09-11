import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { enhanceDriverStatisticsHtml } from '../src/driver-statistics-ui.js';

function seedDriver(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-d','Synthetic Track')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('trainer-d','Synthetic Trainer')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('driver-d','Synthetic Driver')").run();
  db.prepare("INSERT INTO horses (id,canonical_name,sex,birth_year,breed) VALUES ('horse-d','Synthetic Horse','sto',2020,'varmblodig travare')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,race_name,status) VALUES ('race-d','track-d','2026-09-11',1,2140,'auto',50000,'Synthetic race','results')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES ('entry-d','race-d','horse-d','driver-d','trainer-d',1,0)").run();
  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,prize_sek) VALUES ('entry-d',1,'official',0,50000)").run();
}

async function authenticatedCookie(env) { return (await createAppSessionCookie(env)).split(';')[0]; }

test('driver statistics routes are private through actual Worker', async () => {
  const {env,db}=createTestEnv();seedDriver(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';
  const url='https://example.test/app/api/drivers/statistics?period=1y&race_scope=all&race_type=all&breed_type=warmblood&sex=mare&age=6&start_method=all&distance_group=all&volt_lane=all&handicap_m=all&min_starts=all';
  let response=await worker.fetch(new Request(url),env);assert.equal(response.status,401);
  const cookie=await authenticatedCookie(env);
  response=await worker.fetch(new Request(url,{headers:{cookie}}),env);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.rankings.highestWinRate[0].id,'driver-d');assert.equal(data.filters.sex,'mare');assert.equal(data.filters.age,6);assert.equal(data.definitions.longshotPercentMax,5);
  response=await worker.fetch(new Request('https://example.test/app/api/drivers/driver-d/statistics?period=1y&sex=mare&age=6',{headers:{cookie}}),env);assert.equal(response.status,200);
  const detail=await response.json();assert.equal(detail.summary.winRate,1);assert.equal(detail.driver.id,'driver-d');assert.equal(detail.filters.age,6);
});

test('driver statistics returns 400 for invalid filters and 404 for missing driver', async () => {
  const {env,db}=createTestEnv();seedDriver(db);env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const cookie=await authenticatedCookie(env);
  let response=await worker.fetch(new Request('https://example.test/app/api/drivers/statistics?volt_lane=bad',{headers:{cookie}}),env);assert.equal(response.status,400);
  response=await worker.fetch(new Request('https://example.test/app/api/drivers/statistics?age=1',{headers:{cookie}}),env);assert.equal(response.status,400);
  response=await worker.fetch(new Request('https://example.test/app/api/drivers/missing/statistics',{headers:{cookie}}),env);assert.equal(response.status,404);
});

test('actual Worker HTML composes driver Build C after Trend and horse statistics', async () => {
  const {env}=createTestEnv();env.APP_PASSWORD='synthetic-app-password-with-high-entropy';const cookie=await authenticatedCookie(env);
  const response=await worker.fetch(new Request('https://example.test/app/',{headers:{cookie}}),env);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/id="kentaurai-trend-build-a-script"/);assert.match(html,/id="kentaurai-horse-statistics-build-b-script"/);assert.match(html,/id="kentaurai-driver-statistics-build-c-script"/);
  assert.ok(html.indexOf('kentaurai-horse-statistics-build-b-script')<html.indexOf('kentaurai-driver-statistics-build-c-script'));
  for(const text of ['Flest segrar','Bäst form – senaste 30','Mest inkört i år','Bäst från spets','Bäst från dödens','Bäst med bakspår','Resultat som favorit','Resultat som skräll','Bra spår (1/6/7)',"dField('Kön','sex',SEXES)","dField('Ålder','age',dAgeRows())"]) assert.match(html,new RegExp(text.replace(/[()]/g,'\\$&')));
  assert.match(html,/sex:f\.sex/);assert.match(html,/age:f\.age/);
  assert.match(html,/@media\(max-width:430px\)/);assert.match(html,/@media\(max-width:320px\)/);
});

test('driver UI enhancer preserves HTML and injects syntactically valid JavaScript', () => {
  const html=enhanceDriverStatisticsHtml('<html><head></head><body><main id="keep">keep</main></body></html>');assert.match(html,/id="keep">keep/);
  const match=html.match(/<script id="kentaurai-driver-statistics-build-c-script">([\s\S]*?)<\/script>/);assert.ok(match);assert.doesNotThrow(()=>new vm.Script(match[1]));
});
