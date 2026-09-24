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
  getHorseCalendarYearTripScenarios,
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
  assert.equal(typeof getHorseCalendarYearTripScenarios, 'function');
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
    for (const route of ['calendar-statistics', 'calendar-specialties', 'calendar-form', ...(page === 'horses' ? ['calendar-trip-scenarios'] : [])]) {
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


test('horse trip scenario endpoint data is isolated and honors the UI default high-prize scope', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('trip-track','Trip','SE')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('trip-horse','Trip Häst')").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('trip-src','xlabs_race_json','2026-09-10T15:00:00Z','normalized_verified_subset')").run();

  for (const [suffix,date,firstPrize,placing,leader] of [
    ['high','2026-09-01',100000,1,1],
    ['low','2026-09-02',50000,2,0]
  ]) {
    const raceId='trip-r-'+suffix, entryId='trip-e-'+suffix;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,first_prize_sek,status) VALUES (?,'trip-track',?,1,2140,'auto',?,'results')").run(raceId,date,firstPrize);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,'trip-horse',1,0)").run(entryId,raceId);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified) VALUES (?,?,'official',0,0)").run(entryId,placing);
    db.prepare(`INSERT INTO race_positions
      (id,race_entry_id,observed_at_m,position,leader,pocket,death_seat,second_over,third_over,event_json,source_record_id,evidence_type,confidence,classification_version)
      VALUES (?,?,500,1,?,0,0,0,0,?,'trip-src','calculated_xlabs',0.95,'xlabs-trip-classification-v1')`).run(
      'trip-p-'+suffix,entryId,leader,leader?'{}':'{"scenario_key":"back"}'
    );
  }

  const data=await getHorseCalendarYearTripScenarios(env,'trip-horse',{
    year:2026,asOfDate:'2026-09-20',raceScope:'high_prize'
  });
  assert.equal(data.entityType,'horses');
  assert.equal(data.filters.raceScope,'high_prize');
  assert.deepEqual(data.tripScenarioResults.map(row=>[row.scenario,row.starts,row.wins]),[['leader',1,1]]);
});

test('horse specialties aggregate verified C4 race scenarios with active calendar filters', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('scenario-track','Scenario','SE')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('scenario-horse','Scenario Häst')").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('scenario-src','xlabs_race_json','2026-09-10T15:00:00Z','normalized_verified_subset')").run();

  const scenarios = [
    ['s1','2026-09-01',1,1,'leader'],
    ['s2','2026-09-02',1,2,'leader'],
    ['s3','2026-09-03',2,3,'death_seat'],
    ['s4','2026-09-04',1,1,'second_over']
  ];
  for (const [id,date,raceNo,placing,scenario] of scenarios) {
    const raceId='r-'+id, entryId='e-'+id;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES (?,'scenario-track',?,?,2140,'auto','results')").run(raceId,date,raceNo);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,'scenario-horse',1,0)").run(entryId,raceId);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified) VALUES (?,?,'official',0,0)").run(entryId,placing);
    const flags={leader:0,pocket:0,death_seat:0,second_over:0,third_over:0};
    if (scenario!=='back') flags[scenario]=1;
    db.prepare(`INSERT INTO race_positions
      (id,race_entry_id,observed_at_m,position,leader,pocket,death_seat,second_over,third_over,traffic_event,source_record_id,evidence_type,confidence,classification_version)
      VALUES (?,?,500,2,?,?,?,?,?,?,?,?,0.95,'xlabs-trip-classification-v1')`).run(
      'p-'+id,entryId,flags.leader,flags.pocket,flags.death_seat,flags.second_over,flags.third_over,
      scenario==='back'?'bakifrån':null,'scenario-src','calculated_xlabs'
    );
  }

  const data=await getCalendarYearDetailSpecialties(env,'horses','scenario-horse',{year:2026,asOfDate:'2026-09-20'});
  const leader=data.tripScenarioResults.find(row=>row.scenario==='leader');
  const death=data.tripScenarioResults.find(row=>row.scenario==='death_seat');
  const second=data.tripScenarioResults.find(row=>row.scenario==='second_over');
  assert.deepEqual({starts:leader.starts,wins:leader.wins,top3:leader.top3,winRate:leader.winRate},{starts:2,wins:1,top3:2,winRate:0.5});
  assert.deepEqual({starts:death.starts,wins:death.wins,top3:death.top3},{starts:1,wins:0,top3:1});
  assert.deepEqual({starts:second.starts,wins:second.wins,top3:second.top3},{starts:1,wins:1,top3:1});
});

test('horse Form exact as-of cutoff excludes later same-day results', async () => {
  const { createTestEnv } = await import('./helpers/d1.js');
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('cut-track','Cutoff','SE')").run();
  for (const [id,name] of [['cut-h','Cutoff Horse'],['cut-o1','Opponent 1'],['cut-o2','Opponent 2']]) {
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(id,name);
  }
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('cut-src-early','official_provider','race:cut-early','2026-09-20T10:30:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('cut-src-late','official_provider','race:cut-late','2026-09-20T20:30:00Z','normalized_verified_subset')").run();
  for (const [suffix,time,opponent] of [['early','10:00:00','cut-o1'],['late','11:00:00','cut-o2']]) {
    const raceId='cut-'+suffix;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,first_prize_sek,status) VALUES (?,'cut-track','2026-09-20',?, ?,2140,'auto',50000,'results')")
      .run(raceId,suffix==='early'?1:2,'2026-09-20T'+time+'Z');
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?, 'cut-h',1,0)").run('cut-e-'+suffix,raceId);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?, ?,2,0)").run('cut-o-'+suffix,raceId,opponent);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time,source_record_id) VALUES (?,1,'official',0,0,'1.12,0',?)").run('cut-e-'+suffix,'cut-src-'+suffix);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time,source_record_id) VALUES (?,2,'official',0,0,'1.13,0',?)").run('cut-o-'+suffix,'cut-src-'+suffix);
  }
  const form=await getHorseCalendarYearForm(env,'cut-h',{
    year:2026,
    asOfDate:'2026-09-20',
    asOfInstant:'2026-09-20T12:00:00Z'
  });
  assert.equal(form.formLast.usedStarts,1);
  assert.equal(form.formLast.starts[0].raceId,'cut-early');
});
