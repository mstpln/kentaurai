import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getCalendarYearDetailForm,
  getCalendarYearDetailSpecialties,
  getCalendarYearDetailStatistics,
  getDriverCalendarYearDetailStatistics,
  getDriverCalendarYearForm,
  getHorseCalendarYearDetailStatistics,
  getHorseCalendarYearForm,
  getTrainerCalendarYearDetailStatistics,
  getTrainerCalendarYearForm
} from '../src/entity-detail-calendar-statistics.js';
import { getTrainerCalendarHomeTrackResults } from '../src/trainer-calendar-home-statistics.js';
import worker from '../src/worker-v065.js';

test('shared calendar statistics exports one implementation for all supported detail entities', () => {
  assert.equal(typeof getCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getCalendarYearDetailForm, 'function');
  assert.equal(typeof getCalendarYearDetailSpecialties, 'function');
  assert.equal(typeof getTrainerCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getDriverCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getHorseCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getHorseCalendarYearForm, 'function');
  assert.equal(typeof getDriverCalendarYearForm, 'function');
  assert.equal(typeof getTrainerCalendarYearForm, 'function');
  assert.equal(typeof getTrainerCalendarHomeTrackResults, 'function');
});

test('entity calendar configuration preserves entity-specific form and specialist behavior', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /trainers:\{table:'trainers',entryColumn:'trainer_id',entryIndex:'idx_entries_trainer',resultKey:'trainer',formLimit:30,market:true,rest:true,volt:true\}/);
  assert.match(source, /drivers:\{table:'drivers',entryColumn:'driver_id',entryIndex:'idx_entries_driver',resultKey:'driver',formLimit:30,market:true,rest:false,volt:true\}/);
  assert.match(source, /horses:\{table:'horses',entryColumn:'horse_id',entryIndex:'idx_entries_horse_race',resultKey:'horse',formLimit:5,market:false,rest:true,volt:false\}/);
  assert.match(source, /voltLaneGood:\[1,6,7\]/);
});

test('calendar filtering uses YTD for the current year and closed full-year windows for prior years', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /if\(filters\.year===currentYear\)\{conditions\.push\(`\$\{raceAlias\}\.race_date <= \?`\);bindings\.push\(filters\.asOfDate\);\}/);
  assert.match(source, /bindings\.push\(`\$\{filters\.year\+1\}-01-01`\)/);
});

test('distance table groups with the same standard buckets as the distance filter', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  for (const text of [
    "BETWEEN 540 AND 740 THEN '640'",
    "BETWEEN 1540 AND 1740 THEN '1640'",
    "BETWEEN 2040 AND 2240 THEN '2140'",
    "BETWEEN 2540 AND 2740 THEN '2640'",
    "BETWEEN 3040 AND 3240 THEN '3140'",
    "BETWEEN 3540 AND 3740 THEN '3640'",
    "BETWEEN 4040 AND 4240 THEN '4140'",
    "distance_m > 2640 THEN 'other-long'",
    "GROUP BY f.distance_group"
  ]) assert.ok(source.includes(text), 'missing grouped distance rule ' + text);
});

test('core calendar response skips all form work and expensive specialty calculations', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /includeSpecials/);
  assert.match(source, /loadSpecialties/);
  assert.match(source, /getCalendarYearDetailSpecialties/);
  const coreBody = source.slice(source.indexOf('export async function getCalendarYearDetailStatistics'), source.indexOf('export async function getCalendarYearDetailSpecialties'));
  assert.doesNotMatch(coreBody, /loadHorseForm|loadDriverForm|loadTrainerForm|loadLegacyForm/);
  assert.match(coreBody, /formLast:null/);
});

test('trainer calendar detail preserves verified home-track and other-track summaries with active filters', async () => {
  const source = await readFile(new URL('../src/trainer-calendar-home-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /normalized_observations/);
  assert.match(source, /source_type='official_provider'/);
  assert.match(source, /homeTrackExternalId/);
  assert.match(source, /addFilters\(conditions, bindings, filters\)/);
  assert.match(source, /homeTrackResults/);
  assert.match(source, /otherTrackResults/);
  assert.match(source, /filters\.year === currentYear/);
  assert.match(source, /re\.actual_lane IN \(1,6,7\)/);
});

test('worker keeps expensive trainer specialties outside the core calendar response', async () => {
  const source = await readFile(new URL('../src/worker-v065.js', import.meta.url), 'utf8');
  assert.match(source, /getTrainerCalendarHomeTrackResults/);
  assert.match(source, /includeSpecials/);
  assert.match(source, /calendar-specialties/);
  assert.match(source, /searchParams\.get\('specials'\)/);
});

test('horse core calendar stays fast while Form 1-100 loads separately and distance rows stay grouped', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('t','Test','SE')").run();
  for (const [id,name] of [['h','Häst'],['o1','Motstånd 1'],['o2','Motstånd 2']]) {
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(id,name);
  }
  db.prepare(`INSERT INTO races
    (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,status)
    VALUES ('r','t','2026-09-01',1,2160,'auto',50000,'results')`).run();
  for (const [entry,horse,start,placing] of [['e','h',1,2],['e1','o1',2,1],['e2','o2',3,3]]) {
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_start_distance_m,scratched)
      VALUES (?,'r',?,?,2160,0)`).run(entry,horse,start);
    db.prepare(`INSERT INTO race_results
      (race_entry_id,placing,result_status,km_time,gallop,disqualified,prize_sek)
      VALUES (?,?,'official','1.14,0',0,0,10000)`).run(entry,placing);
  }

  const data = await getHorseCalendarYearDetailStatistics(env, 'h', {
    year: 2026,
    asOfDate: '2026-09-20',
    includeSpecials: false
  });
  assert.equal(data.formLast, null);
  const formData = await getHorseCalendarYearForm(env, 'h', { year:2026, asOfDate:'2026-09-20' });
  assert.equal(formData.formLast.usedStarts, 1);
  assert.ok(Number.isInteger(formData.formLast.score));
  assert.ok(formData.formLast.score >= 1 && formData.formLast.score <= 100);
  assert.equal(data.distances.length, 1);
  assert.equal(data.distances[0].label, '2140');
  assert.equal(data.distances[0].starts, 1);
});

test('new calendar detail routes remain private before touching D1', async () => {
  for (const page of ['trainers', 'drivers', 'horses']) {
    for (const route of ['calendar-statistics', 'calendar-specialties', 'calendar-form']) {
      const response = await worker.fetch(new Request(`https://example.test/app/api/${page}/example/${route}?year=2026`), {}, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'service_unavailable' });
    }
  }
});

test('v065 only adds detail routes and horse filter options while leaving track and game routing delegated', async () => {
  const source = await readFile(new URL('../src/worker-v065.js', import.meta.url), 'utf8');
  assert.match(source, /\(trainers\|drivers\|horses\)/);
  assert.match(source, /\/app\/api\/horses\/statistics\/filter-options/);
  assert.doesNotMatch(source, /calendarHandlers\s*=\s*\{[^}]*tracks/s);
  assert.doesNotMatch(source, /calendarHandlers\s*=\s*\{[^}]*games/s);
});


test('person Form 1-100 endpoints stay separate from core and preserve market blindness metadata', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('tf','Formbana','SE')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('d','Kusk')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('tr','Tränare')").run();
  for (let i=1;i<=4;i++) db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run('h'+i,'Häst '+i);
  for (let i=1;i<=4;i++) {
    db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status)
      VALUES (?, 'tf', ?, ?, 2140, 'auto', 'results')`).run('rf'+i,'2026-09-0'+i,i);
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_start_distance_m,scratched)
      VALUES (?, ?, ?, 'd', 'tr', 1, 2140, 0)`).run('ef'+i,'rf'+i,'h'+i);
    db.prepare(`INSERT INTO race_results
      (race_entry_id,placing,result_status,gallop,disqualified,prize_sek)
      VALUES (?,?,'official',0,0,1000)`).run('ef'+i,i===1?1:2);
  }
  const driverCore = await getDriverCalendarYearDetailStatistics(env,'d',{year:2026,asOfDate:'2026-09-20',includeSpecials:false});
  const trainerCore = await getTrainerCalendarYearDetailStatistics(env,'tr',{year:2026,asOfDate:'2026-09-20',includeSpecials:false});
  assert.equal(driverCore.formLast,null);
  assert.equal(trainerCore.formLast,null);

  const driverForm = await getDriverCalendarYearForm(env,'d',{year:2026,asOfDate:'2026-09-20'});
  const trainerForm = await getTrainerCalendarYearForm(env,'tr',{year:2026,asOfDate:'2026-09-20'});
  assert.ok(driverForm.formLast.score >= 1 && driverForm.formLast.score <= 100);
  assert.equal(driverForm.formLast.marketBlindScore, driverForm.formLast.score);
  assert.equal(driverForm.formLast.components.marketPerformance.score, null);
  assert.equal(driverForm.formLast.components.marketPerformance.marketBlind, false);
  assert.ok(trainerForm.formLast.score >= 1 && trainerForm.formLast.score <= 100);
  assert.equal(trainerForm.formLast.marketBlindScore, trainerForm.formLast.score);
  assert.equal(Object.hasOwn(trainerForm.formLast.components,'marketPerformance'),false);
});

test('trainer form prior-start lookup stays below D1 bind limits and driver market lookup is target-scoped', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /target_entries AS MATERIALIZED/);
  assert.match(source, /betting_snapshots bs INDEXED BY idx_betting_snapshots_entry_time/);
  assert.match(source, /race_entries re INDEXED BY \$\{config\.entryIndex\}/);
});
