import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
  buildExternalEvidenceImportContext,
  importExternalEvidence
} from '../src/external-evidence-model-v1.js';
import {
  buildStep3Context,
  getHorseExternalStatistics,
  getExternalInterviews,
  getStep3Prompt,
  getExternalEvidenceImportPrompt
} from '../src/external-evidence-context-v1.js';

function seedRound(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track_x','Synthetic Track','SE')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('round_x','V85','2099-03-01','2099-03-01T13:00:00Z','2099-03-01T12:55:00Z','upcoming')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('official_x','official_provider','round_x','2099-03-01T10:00:00Z','normalized_verified_subset')").run();
  for (let leg=1;leg<=8;leg+=1) {
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?,'track_x','2099-03-01',?,'2099-03-01T13:00:00Z',2140,'auto','upcoming')").run('race_'+leg,leg);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round_x',?,?)").run(leg,'race_'+leg);
    db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run('horse_'+leg,'Horse '+leg);
    db.prepare("INSERT INTO trainers (id,canonical_name) VALUES (?,?)").run('trainer_'+leg,'Trainer '+leg);
    db.prepare("INSERT INTO drivers (id,canonical_name) VALUES (?,?)").run('driver_'+leg,'Driver '+leg);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,scratched) VALUES (?,?,?,?,?,?,0)").run('entry_'+leg,'race_'+leg,'horse_'+leg,'driver_'+leg,'trainer_'+leg,leg);
  }
  db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,source_record_id) VALUES ('eq_1','entry_1','barefoot','barefoot',1,1,'american','official_x')").run();
}

function payload(generatedAt='2099-03-01T12:00:00Z') {
  return {
    contract_version:EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
    submission_id:'synthetic-evidence-1',
    round_id:'round_x',
    generated_at:generatedAt,
    producer:{provider:'openai',model:'synthetic'},
    statistics:[
      {race_entry_id:'entry_1',context_type:'all_starts',starts:12,wins:4,seconds:1,thirds:2,win_percent:33,roi_percent:133,observed_at:'2099-03-01T11:50:00Z'},
      {race_entry_id:'entry_1',context_type:'current_track',starts:3,wins:1,seconds:0,thirds:1,win_percent:33,roi_percent:75,observed_at:'2099-03-01T11:50:00Z'},
      {race_entry_id:'entry_1',context_type:'current_balance',starts:3,wins:2,seconds:0,thirds:0,win_percent:67,roi_percent:246,observed_at:'2099-03-01T11:50:00Z'},
      {race_entry_id:'entry_1',context_type:'current_wagon',starts:2,wins:0,seconds:0,thirds:0,win_percent:0,roi_percent:0,observed_at:'2099-03-01T11:50:00Z'}
    ],
    interviews:[{
      race_entry_id:'entry_1',
      speaker_name:'Synthetic Stable Person',
      speaker_role:'stable_representative',
      speaker_relation:'hos Trainer 1',
      published_at:'2099-03-01T11:45:00Z',
      interview_text:'Hästen känns fin och vi provar ett offensivt upplägg.',
      summary:'Positiv form och offensiv intention.',
      signals:[
        {type:'form',value:'positive',polarity:'positive',class:'soft_signal',confidence:0.8},
        {type:'tactics',value:'offensive',polarity:'positive',class:'intention',confidence:0.9}
      ]
    }]
  };
}

test('external evidence context binds current track, balance and wagon to verified round context', async () => {
  const {env,db}=createTestEnv();seedRound(db);
  const context=await buildExternalEvidenceImportContext(env,'round_x');
  const entry=context.entries.find((row)=>row.race_entry_id==='entry_1');
  assert.equal(context.rules.no_driver_data,true);
  assert.equal(entry.external_stat_context.current_track.key,'track_x');
  assert.equal(entry.external_stat_context.current_balance.label,'Barfota runt om');
  assert.equal(entry.external_stat_context.current_wagon.label,'Amerikansk vagn');
  assert.equal('driver' in entry,false);
});

test('external evidence import is append-only, idempotent and links one interview to horse and trainer', async () => {
  const {env,db}=createTestEnv();seedRound(db);
  const first=await importExternalEvidence(env,payload());
  assert.equal(first.counts.inserted,5);
  const second=await importExternalEvidence(env,payload());
  assert.equal(second.reused,true);
  assert.equal(second.counts.inserted,0);

  const stats=await getHorseExternalStatistics(env,'horse_1');
  assert.equal(stats.snapshots.length,4);
  assert.equal(stats.snapshots.find((row)=>row.context_type==='current_track').context_key,'track_x');
  assert.equal(stats.snapshots.find((row)=>row.context_type==='current_balance').context_label,'Barfota runt om');

  const horseInterviews=await getExternalInterviews(env,'horses','horse_1');
  const trainerInterviews=await getExternalInterviews(env,'trainers','trainer_1');
  assert.equal(horseInterviews.interviews.length,1);
  assert.equal(trainerInterviews.interviews.length,1);
  assert.equal(horseInterviews.interviews[0].id,trainerInterviews.interviews[0].id);
  assert.match(horseInterviews.interviews[0].interview_text,/offensivt upplägg/);
  assert.equal(horseInterviews.interviews[0].signals.length,2);

  const step3=await buildStep3Context(env,'round_x');
  const step3Horse=step3.horses.find((row)=>row.horse_id==='horse_1');
  assert.equal(step3Horse.external_statistics.length,4);
  assert.equal(step3Horse.current_round_context.current_balance.label,'Barfota runt om');
  assert.equal(step3.trainers.find((row)=>row.trainer_id==='trainer_1').interview_history.length,1);
});

test('Step 3 current equipment context excludes updates captured after the round deadline', async () => {
  const {env,db}=createTestEnv();seedRound(db);
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('official_late','official_provider','late','2099-03-01T12:58:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,source_record_id) VALUES ('eq_late','entry_1','shod','shod',0,0,'regular','official_late')").run();

  const registrationContext=await buildExternalEvidenceImportContext(env,'round_x');
  const registrationEntry=registrationContext.entries.find((row)=>row.race_entry_id==='entry_1');
  assert.equal(registrationEntry.external_stat_context.current_balance.label,'Skor runt om');
  assert.equal(registrationEntry.external_stat_context.current_wagon.label,'Vanlig vagn');

  const step3=await buildStep3Context(env,'round_x');
  const step3Horse=step3.horses.find((row)=>row.horse_id==='horse_1');
  assert.equal(step3Horse.current_round_context.current_balance.label,'Barfota runt om');
  assert.equal(step3Horse.current_round_context.current_wagon.label,'Amerikansk vagn');
});

test('Step 3 historical context excludes evidence that became available after the round deadline', async () => {
  const {env,db}=createTestEnv();seedRound(db);
  await importExternalEvidence(env,payload());

  const later=payload('2099-03-01T12:00:00Z');
  later.submission_id='synthetic-evidence-later';
  later.statistics[0].wins=5;
  later.statistics[0].win_percent=42;
  later.interviews[0].interview_text='Detta importerades först efter spelstopp.';
  await importExternalEvidence(env,later,{now:'2099-03-01T14:30:00Z'});

  const step3=await buildStep3Context(env,'round_x');
  assert.equal(step3.context_as_of,'2099-03-01T12:55:00Z');
  const horse=step3.horses.find((row)=>row.horse_id==='horse_1');
  assert.equal(horse.external_statistics.length,4);
  assert.equal(horse.external_statistics.find((row)=>row.context_type==='all_starts').wins,4);
  assert.equal(horse.interview_history.length,1);
  assert.doesNotMatch(horse.interview_history[0].interview_text,/efter spelstopp/);
});

test('external evidence import rejects wrong round identities and unknown current equipment context', async () => {
  const {env,db}=createTestEnv();seedRound(db);
  const wrong=payload();wrong.statistics=[{...wrong.statistics[0],race_entry_id:'not_an_entry'}];wrong.interviews=[];
  await assert.rejects(()=>importExternalEvidence(env,wrong),/does not belong to selected round/);

  const missing=payload();missing.statistics=[{...missing.statistics[0],race_entry_id:'entry_2',context_type:'current_balance'}];missing.interviews=[];
  await assert.rejects(()=>importExternalEvidence(env,missing),/race-day balance is unknown/);
});

test('Step 3 and import prompts preserve separation and exclude driver storage', () => {
  assert.match(getStep3Prompt('openai'),/Steg 3/);
  assert.match(getStep3Prompt('openai'),/Bygg inte ett färdigt system/);
  assert.match(getExternalEvidenceImportPrompt('anthropic'),/Spara ingen kuskdata/);
});
