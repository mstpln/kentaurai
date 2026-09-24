import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestEnv } from './helpers/d1.js';
import { createPreMarketAnalysisPackV3 } from '../src/analysis-pack-v3.js';
import {
  getGameStatisticsCoverageAudit,
  inspectGameStatisticsRoundCoverage,
  runNextGameStatisticsBackfill
} from '../src/game-statistics-backfill-v1.js';
import { getGameStatistics } from '../src/routes/game-statistics.js';

function seedRound(db) {
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('round_stats','V85','2099-01-02','2099-01-02T12:10:00Z','2099-01-02T12:00:00Z','results')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('official_before','official_provider','game:round_stats:before','2099-01-02T11:00:00Z','hash-before','normalized_verified_subset')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status) VALUES ('final_game','official_provider','game:round_stats','2099-01-02T22:00:00Z','hash-final','normalized_verified_subset')").run();

  for (let leg=1;leg<=8;leg+=1) {
    const track='track_'+leg, race='race_'+leg, horse='horse_'+leg, driver='driver_'+leg, trainer='trainer_'+leg, entry='entry_'+leg;
    db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES (?,?,'SE')").run(track,'Track '+leg);
    db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES (?,'official',?)").run(track,String(100+leg));
    db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horse,'Horse '+leg);
    db.prepare("INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)").run(horse,String(200+leg));
    db.prepare("INSERT INTO drivers (id,canonical_name) VALUES (?,?)").run(driver,'Driver '+leg);
    db.prepare("INSERT INTO driver_external_ids (driver_id,source_type,external_id) VALUES (?,'official',?)").run(driver,String(300+leg));
    db.prepare("INSERT INTO trainers (id,canonical_name) VALUES (?,?)").run(trainer,'Trainer '+leg);
    db.prepare("INSERT INTO trainer_external_ids (trainer_id,source_type,external_id) VALUES (?,'official',?)").run(trainer,String(400+leg));
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?,?,'2099-01-02',?,?,2140,'auto','results')")
      .run(race,track,leg,`2099-01-02T12:${String(9+leg).padStart(2,'0')}:00Z`);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round_stats',?,?)").run(leg,race);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES (?,?,?,?,?,?,?,1,0,2140,0)")
      .run(entry,race,horse,driver,trainer,leg,leg);
    const raceFields=JSON.stringify({date:'2099-01-02',raceNumber:leg,distanceM:2140,startMethod:'auto',scheduledStartAt:`2099-01-02T12:${String(9+leg).padStart(2,'0')}:00Z`,trackExternalId:String(100+leg),status:'upcoming'});
    const entryFields=JSON.stringify({startNumber:leg,postPosition:leg,startTier:1,handicapM:0,actualStartDistanceM:2140,scratched:false,scratchSemanticsVerified:true,horseExternalId:String(200+leg),driverExternalId:String(300+leg),trainerExternalId:String(400+leg)});
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')")
      .run('obs_race_'+leg,race,raceFields);
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'official_before','2099-01-02T11:00:00Z',?,'normalized_verified_subset')")
      .run('obs_entry_'+leg,entry,entryFields);
  }
}

async function finishSeed(env,db) {
  const pack=await createPreMarketAnalysisPackV3(env,'round_stats',{asOf:'2099-01-02T11:30:00Z'});

  db.prepare("INSERT INTO model_versions (id,created_at,feature_version,prompt_version,ai_provider,ai_model,config_json) VALUES ('model_stats','2099-01-02T11:40:00Z','external-analysis-v1','synthetic','openai','synthetic','{}')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('system_stats','round_stats','model_stats','main',200,128,0.5,3,'2099-01-02T11:50:00Z',?)")
    .run(JSON.stringify({step1_pack_id:pack.manifest.pack_id,step1_facts_fingerprint:pack.manifest.facts_fingerprint}));

  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?, 'model_stats','2099-01-02T11:30:00Z',1,'2099-01-02T11:40:00Z')")
      .run('analysis_'+leg,'race_'+leg);
    db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,1,'A')")
      .run('pred_'+leg,'analysis_'+leg,'entry_'+leg,1);
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike,own_probability) VALUES ('system_stats',?,?,?,1)")
      .run(leg,'entry_'+leg,leg<=3?1:0);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id) VALUES (?,1,'official','final_game')").run('entry_'+leg);
    db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,'round_stats',?,?, '2099-01-02T22:00:00Z',50,1,'final_game')")
      .run('bet_'+leg,leg,'entry_'+leg);
  }

  db.prepare(`INSERT INTO analysis_external_runs
    (id,game_round_id,model_version_id,main_system_id,contract_version,flow_version,prompt_version,provider,model,
     step1_pack_id,step1_pack_as_of,step1_generated_at,step1_facts_fingerprint,step2_market_fingerprint,
     step2_market_cutoff,step2_generated_at,analysis_blindness,import_timing,learning_eligibility,payload_digest,created_at)
    VALUES ('external_stats','round_stats','model_stats','system_stats','kentaurai-external-analysis-run-v1',
      'external-analysis-v1','synthetic','openai','synthetic',?,?, '2099-01-02T11:31:00Z',?,
      'sha256:market','2099-01-02T12:00:00Z','2099-01-02T11:45:00Z','declared_unsealed',
      'pre_race','eligible_by_timing','sha256:payload','2099-01-02T11:50:00Z')`)
    .run(pack.manifest.pack_id,pack.manifest.as_of,pack.manifest.facts_fingerprint);

  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES ('round_stats','V85','final_game','2099-01-02T22:00:00Z','results',1000000,10000,100,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":1,"jackpot":false}}',8,2500000,25000)`).run();

  return pack;
}

test('statistics backfill recreates only fingerprint-identical historical Form and freezes KentaurAI judgments', async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  const pack=await finishSeed(env,db);

  assert.equal(db.prepare("SELECT COUNT(*) n FROM analysis_entry_form_snapshots").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_entry_judgment_snapshots").get().n,0);

  const coverage=await inspectGameStatisticsRoundCoverage(env,'round_stats',{attemptBackfill:true});
  assert.equal(coverage.expectedPackId,pack.manifest.pack_id);
  assert.equal(coverage.actualPackId,pack.manifest.pack_id);
  assert.equal(coverage.expectedFactsFingerprint,pack.manifest.facts_fingerprint);
  assert.equal(coverage.actualFactsFingerprint,pack.manifest.facts_fingerprint);
  assert.equal(coverage.formStatus,'complete_after_backfill');
  assert.equal(coverage.formSnapshotEntries,8);
  assert.equal(coverage.insertedFormRows,8);
  assert.equal(coverage.judgmentStatus,'complete');
  assert.equal(coverage.judgmentEntries,8);
  assert.equal(coverage.insertedJudgmentRows,8);
  assert.equal(coverage.closingMarketStatus,'complete');
  assert.equal(coverage.payoutStatus,'complete');
  assert.equal(coverage.complete,true);

  const stats=await getGameStatistics(env,{gameType:'V85'});
  assert.equal(stats.kentaurai.byRank.find(row=>row.label==='1').winners,8);
  assert.equal(stats.kentaurai.byAbcd.find(row=>row.label==='A').winners,8);
});

test('statistics backfill refuses Form when historical Step 1 fingerprint cannot be reproduced', async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await finishSeed(env,db);
  db.prepare("UPDATE analysis_external_runs SET step1_facts_fingerprint='sha256:not-the-original' WHERE id='external_stats'").run();

  const coverage=await inspectGameStatisticsRoundCoverage(env,'round_stats',{attemptBackfill:true});
  assert.equal(coverage.formStatus,'unavailable_fingerprint_mismatch');
  assert.equal(coverage.formSnapshotEntries,0);
  assert.equal(coverage.insertedFormRows,0);
  assert.equal(coverage.missingMetrics.includes('form'),true);
});

test('bounded scheduled statistics backfill persists per-round audit state and becomes idempotent', async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await finishSeed(env,db);

  const first=await runNextGameStatisticsBackfill(env,{now:'2099-01-03T00:00:00Z'});
  assert.equal(first.status,'running');
  assert.equal(first.coverage.complete,true);

  const second=await runNextGameStatisticsBackfill(env,{now:'2099-01-03T00:01:00Z'});
  assert.equal(second.status,'completed');
  const job=db.prepare("SELECT * FROM game_statistics_backfill_jobs").get();
  assert.equal(job.total_rounds,1);
  assert.equal(job.processed_rounds,1);
  assert.equal(job.complete_rounds,1);
  assert.equal(job.form_rows_inserted,8);
  assert.equal(job.judgment_rows_inserted,8);

  const audit=await getGameStatisticsCoverageAudit(env);
  assert.equal(audit.summary.rounds,1);
  assert.equal(audit.summary.complete,1);
  assert.equal(audit.summary.formComplete,1);
  assert.equal(audit.summary.closingMarketComplete,1);
});
