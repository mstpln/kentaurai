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
  getHorseTrendForms,
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
  assert.equal(typeof getHorseTrendForms, 'function');
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

test('calendar filtering supports rolling Trend periods while retaining the year fallback contract', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /trendDateWindow\(options\.period,asOfDate\)/);
  assert.match(source, /if\(filters\.period\)\{/);
  assert.match(source, /bindings\.push\(filters\.periodStartDate,filters\.periodEndDate\)/);
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
  assert.match(source, /filters\.periodStartDate/);
  assert.match(source, /filters\.periodEndDate/);
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

test('rolling 1y detail period excludes older starts and keeps the selected race level', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('rp-track','Rolling','SE')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('rp-tr','Rolling Trainer')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('rp-h','Rolling Horse')").run();
  for (const [id,date,prize] of [['rp-old','2025-08-01',150000],['rp-low','2026-09-01',30000],['rp-high','2026-09-02',150000]]) {
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,status) VALUES (?,'rp-track',?,1,2140,'auto',?,'results')").run(id,date,prize);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,trainer_id,start_number,scratched) VALUES (?,?, 'rp-h','rp-tr',1,0)").run(id+'-e',id);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status) VALUES (?,1,0,0,'official')").run(id+'-e');
  }
  const data=await getTrainerCalendarYearDetailStatistics(env,'rp-tr',{period:'1y',raceScope:'high_prize',asOfDate:'2026-09-20',includeSpecials:false,includeStartPoints:false});
  assert.equal(data.summary.starts,1);
  assert.equal(data.summary.wins,1);
  assert.equal(data.filters.period,'1y');
  assert.equal(data.filters.raceScope,'high_prize');
});

test('batched horse Trend Form returns the existing deterministic Form contract for multiple horses', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('bt-track','Batch','SE')").run();
  for (const [id,name] of [['bt-a','Batch A'],['bt-b','Batch B']]) db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(id,name);
  for (let i=1;i<=3;i++) {
    const race='bt-r'+i;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,status) VALUES (?,'bt-track',?, ?,2140,'auto',150000,'results')").run(race,'2026-09-0'+i,i);
    for (const [horse,start,placing] of [['bt-a',1,i===1?1:2],['bt-b',2,i===3?1:3]]) {
      const entry=race+'-'+horse;
      db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_start_distance_m,scratched) VALUES (?,?,?,?,2140,0)").run(entry,race,horse,start);
      db.prepare("INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status) VALUES (?,?,0,0,'official')").run(entry,placing);
    }
  }
  const forms=await getHorseTrendForms(env,['bt-a','bt-b'],{period:'3m',raceScope:'high_prize',asOfDate:'2026-09-20'});
  assert.equal(forms.size,2);
  assert.ok(forms.get('bt-a').score>=1&&forms.get('bt-a').score<=100);
  assert.ok(forms.get('bt-b').score>=1&&forms.get('bt-b').score<=100);
  assert.deepEqual(forms.get('bt-a').recentResults,[2,2,1]);
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
  for (let i=1;i<=5;i++) db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run('h'+i,'Häst '+i);
  for (let i=1;i<=4;i++) {
    db.prepare(`INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status)
      VALUES (?, 'tf', ?, ?, 2140, 'auto', 'results')`).run('rf'+i,'2026-09-0'+i,i);
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_start_distance_m,scratched)
      VALUES (?, ?, ?, 'd', 'tr', 1, 2140, 0)`).run('ef'+i,'rf'+i,'h'+i);
    db.prepare(`INSERT INTO race_results
      (race_entry_id,placing,result_status,gallop,disqualified,prize_sek)
      VALUES (?,?,'official',0,0,1000)`).run('ef'+i,i===1?1:2);
    db.prepare(`INSERT INTO race_entries
      (id,race_id,horse_id,start_number,actual_start_distance_m,scratched)
      VALUES (?, ?, 'h5', 2, 2140, 0)`).run('of'+i,'rf'+i);
    db.prepare(`INSERT INTO race_results
      (race_entry_id,placing,result_status,gallop,disqualified,prize_sek)
      VALUES (?,?,'official',0,0,500)`).run('of'+i,i===1?2:1);
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


test('driver Form market component uses only the final source-backed snapshot at or before authoritative bet stop', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('fm-track','Form Market')").run();
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES ('fm-tr','Tränare')").run();
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('fm-driver','Kusk')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('fm-h1','H1'),('fm-h2','H2'),('fm-h3','H3'),('fm-h4','H4')").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('fm-source','synthetic','2026-09-04T10:00:00Z','verified')").run();

  for (let i=1;i<=3;i++) {
    const raceId='fm-r'+i, entryId='fm-e'+i, otherId='fm-o'+i, date='2026-09-0'+i, roundId='fm-round'+i;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES (?, 'fm-track', ?, ?, 2140, 'auto', 'results')").run(raceId,date,i);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES (?,?,'fm-h1','fm-driver','fm-tr',1,0)").run(entryId,raceId);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,'fm-h2',2,0)").run(otherId,raceId);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status) VALUES (?,1,0,0,'official')").run(entryId);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,gallop,disqualified,result_status) VALUES (?,2,0,0,'official')").run(otherId);
    db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at) VALUES (?,'V85',?,?)").run(roundId,date,date+'T12:00:00Z');
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,1,?)").run(roundId,raceId);
    db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,1,?,?,10,2,'fm-source')").run('fm-old'+i,roundId,entryId,date+'T11:40:00Z');
    db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,1,?,?,60,1,'fm-source')").run('fm-final'+i,roundId,entryId,date+'T11:59:00Z');
    db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,1,?,?,1,2,'fm-source')").run('fm-after'+i,roundId,entryId,date+'T12:01:00Z');
    db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank) VALUES (?,?,1,?,?,1,2)").run('fm-unprovenanced'+i,roundId,entryId,date+'T11:59:30Z');
  }

  const data = await getDriverCalendarYearForm(env,'fm-driver',{year:2026,asOfDate:'2026-09-20'});
  assert.equal(data.formLast.components.marketPerformance.usedStarts,3);
  assert.equal(data.formLast.starts.every(row=>row.marketRank===1),true,'post-stop and unprovenanced rank 2 rows must not leak into Form');
  assert.equal(data.formLast.starts.every(row=>String(row.marketCapturedAt).endsWith('11:59:00Z')),true);
  assert.equal(data.formLast.components.marketPerformance.marketBlind,false);
  assert.notEqual(data.formLast.score,null);
});
