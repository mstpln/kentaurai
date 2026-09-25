import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreMarketAnalysisPackV3 } from '../src/analysis-pack-v3.js';
import { recordExternalAnalysisExport } from '../src/external-analysis-flow-v1.js';
import {
  auditStatisticsRound,
  classifyStatisticsFormFailure,
  getStatisticsDataBackfillStatus,
  runNextStatisticsDataBackfill
} from '../src/statistics-data-backfill-v1.js';
import { getGameStatistics } from '../src/routes/game-statistics.js';
import { getGameHistoryDetail } from '../src/routes/games.js';
import { createTestEnv } from './helpers/d1.js';

function seedRound(db) {
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('stats_round','V86','2099-01-02','2099-01-02T12:10:00Z','2099-01-02T12:00:00.000Z','results')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('stats_official','official_provider','game:stats_round','2099-01-02T11:00:00Z','normalized_verified_subset')").run();

  for (let leg=1;leg<=8;leg+=1) {
    const track='stats_track_'+leg;
    const race='stats_race_'+leg;
    const horse='stats_horse_'+leg;
    const entry='stats_entry_'+leg;
    db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES (?,?,'SE')").run(track,'Track '+leg);
    db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES (?,'official',?)").run(track,String(100+leg));
    db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horse,'Horse '+leg);
    db.prepare("INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)").run(horse,String(200+leg));
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?,?,'2099-01-02',?,?,2140,'auto','upcoming')")
      .run(race,track,leg,`2099-01-02T12:${String(9+leg).padStart(2,'0')}:00Z`);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('stats_round',?,?)").run(leg,race);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched) VALUES (?,?,?, ?,?,1,0,2140,0)")
      .run(entry,race,horse,leg,leg);
    const raceFields=JSON.stringify({
      date:'2099-01-02',raceNumber:leg,distanceM:2140,startMethod:'auto',
      scheduledStartAt:`2099-01-02T12:${String(9+leg).padStart(2,'0')}:00Z`,
      trackExternalId:String(100+leg),status:'upcoming'
    });
    const entryFields=JSON.stringify({
      startNumber:leg,postPosition:leg,startTier:1,handicapM:0,actualStartDistanceM:2140,
      scratched:false,scratchSemanticsVerified:true,horseExternalId:String(200+leg)
    });
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'stats_official','2099-01-02T11:00:00Z',?,'normalized_verified_subset')")
      .run('stats_obs_race_'+leg,race,raceFields);
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'stats_official','2099-01-02T11:00:00Z',?,'normalized_verified_subset')")
      .run('stats_obs_entry_'+leg,entry,entryFields);
  }
}

async function seedRecordedSystem(env,db) {
  const pack=await createPreMarketAnalysisPackV3(env,'stats_round',{asOf:'2099-01-02T11:30:00Z'});
  await recordExternalAnalysisExport(env,{
    stage:'step1',
    roundId:'stats_round',
    artifactId:pack.packId,
    artifactFingerprint:pack.factsFingerprint,
    asOf:pack.manifest.as_of,
    generatedAt:'2099-01-02T11:35:00.000Z',
    artifact:{pack_id:pack.packId,facts_fingerprint:pack.factsFingerprint}
  });
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('stats_model','2099-01-02T11:40:00.000Z','synthetic')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('stats_system','stats_round','stats_model','main',200,8,0.25,3,'2099-01-02T11:40:00.000Z',?)")
    .run(JSON.stringify({step1_pack_id:pack.packId,step1_facts_fingerprint:pack.factsFingerprint}));
  for(let leg=1;leg<=3;leg+=1){
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('stats_system',?,?,1)")
      .run(leg,'stats_entry_'+leg);
  }
  db.prepare(`INSERT INTO analysis_external_runs
    (id,game_round_id,model_version_id,main_system_id,contract_version,flow_version,prompt_version,provider,model,
     step1_pack_id,step1_pack_as_of,step1_generated_at,step1_facts_fingerprint,step2_market_fingerprint,
     step2_market_cutoff,step2_generated_at,analysis_blindness,import_timing,learning_eligibility,payload_digest,created_at)
    VALUES ('stats_run','stats_round','stats_model','stats_system','kentaurai-external-analysis-run-v1','external-analysis-v1',
      'synthetic','openai','synthetic',?,?,?,?, 'market-fp','2099-01-02T12:00:00.000Z','2099-01-02T11:50:00.000Z',
      'declared_unsealed','pre_race','eligible_by_timing','digest','2099-01-02T11:40:00.000Z')`)
    .run(pack.packId,pack.manifest.as_of,'2099-01-02T11:35:00.000Z',pack.factsFingerprint);
  return pack;
}

test('statistics backfill replays and freezes Form only when Step 1 fingerprint matches exactly',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  const pack=await seedRecordedSystem(env,db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM analysis_entry_form_snapshots").get().n,0);

  const result=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(result.metrics.form,'complete');
  const snapshots=db.prepare("SELECT step1_pack_id,as_of,used_starts FROM analysis_entry_form_snapshots ORDER BY leg_number").all();
  assert.equal(snapshots.length,8);
  assert.ok(snapshots.every(row=>row.step1_pack_id===pack.packId));
  assert.ok(snapshots.every(row=>row.as_of===pack.manifest.as_of));
  assert.ok(snapshots.every(row=>row.used_starts===0));

  const audit=await auditStatisticsRound(env,'stats_round');
  assert.equal(audit.status.form,'complete');
  assert.equal(audit.counts.formSnapshots,8);
});

test('statistics backfill fails closed on Step 1 fingerprint mismatch',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  db.prepare("UPDATE analysis_external_runs SET step1_facts_fingerprint='sha256:wrong' WHERE id='stats_run'").run();
  db.prepare("UPDATE analysis_external_exports SET artifact_fingerprint='sha256:wrong' WHERE game_round_id='stats_round' AND stage='step1'").run();

  const result=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(result.status,'pending');
  assert.equal(result.metrics.form,'manual_review');
  assert.equal(result.errorClass,'step1_replay_fingerprint_mismatch');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM analysis_entry_form_snapshots").get().n,0);
});

test('statistics backfill status reports coverage without inventing unavailable analysis facts',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  const status=await getStatisticsDataBackfillStatus(env);
  assert.equal(status.coverage.rounds,1);
  assert.equal(status.coverage.form,1);
  assert.equal(status.coverage.kaiRank,0);
  assert.equal(status.coverage.abcd,0);
  assert.equal(status.coverage.spikes,1);
});


test('statistics backfill status is read-only before queue creation',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM statistics_data_backfill_rounds').get().n,0);
  const status=await getStatisticsDataBackfillStatus(env);
  assert.equal(status.coverage.rounds,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM statistics_data_backfill_rounds').get().n,0);
});

test('explicit statistics backfill refuses a round that is not yet historically eligible',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  await assert.rejects(
    () => runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2099-01-02T11:45:00Z'}),
    /not eligible for historical statistics backfill/
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM analysis_entry_form_snapshots').get().n,0);
});


test('transient closing-market repair failure stays pending and does not falsely mark Form for manual review',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  db.prepare("UPDATE source_records SET raw_object_key='raw/official_provider/transient.json' WHERE id='stats_official'").run();
  env.RAW_BUCKET.get=async()=>{ throw new Error('temporary R2 outage'); };
  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,
     system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES ('stats_round','V86','stats_official','2099-01-02T22:00:00Z','results',
      100000,1000,100,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":1,"jackpot":false}}',8,2500000,25000)`).run();

  const result=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(result.status,'pending');
  assert.equal(result.metrics.finalMarket,'pending');
  assert.equal(result.metrics.form,'complete');
  assert.match(result.reason,/closing_market_repair/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM analysis_entry_form_snapshots").get().n,8);
  const state=db.prepare("SELECT status,final_market_status,form_status FROM statistics_data_backfill_rounds WHERE game_round_id='stats_round'").get();
  assert.equal(state.status,'pending');
  assert.equal(state.final_market_status,'pending');
  assert.equal(state.form_status,'complete');
});


test('legacy registered systems backfill Form from verified pre-race analysis snapshots without inventing Step 1 lineage',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('legacy_model','2099-01-02T11:40:00.000Z','analysis-exchange-v1')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('legacy_system','stats_round','legacy_model','main',200,8,0.25,3,'2099-01-02T11:40:00.000Z',?)")
    .run(JSON.stringify({step1_pack_id:'stale-pack',step1_facts_fingerprint:'sha256:stale'}));
  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?,?,'2099-01-02T11:30:00.000Z',1,'2099-01-02T11:40:00.000Z')")
      .run('legacy_analysis_'+leg,'stats_race_'+leg,'legacy_model');
    db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,1,'A')")
      .run('legacy_prediction_'+leg,'legacy_analysis_'+leg,'stats_entry_'+leg,1);
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('legacy_system',?,?,?)")
      .run(leg,'stats_entry_'+leg,leg<=3?1:0);
  }

  const result=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(result.metrics.form,'complete');
  assert.equal(result.formLineageKind,'legacy_analysis_snapshot');
  assert.ok(result.formSnapshotRef);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM analysis_entry_form_snapshots WHERE step1_pack_id=?").get(result.formSnapshotRef).n,8);
  // Give the synthetic no-history fixtures a deterministic score so the read-path fallback can be asserted separately.
  db.prepare("UPDATE analysis_entry_form_snapshots SET form_score=65,form_rank=1 WHERE step1_pack_id=?").run(result.formSnapshotRef);

  const state=db.prepare("SELECT form_lineage_kind,form_snapshot_ref,form_as_of_json FROM statistics_data_backfill_rounds WHERE game_round_id='stats_round'").get();
  assert.equal(state.form_lineage_kind,'legacy_analysis_snapshot');
  assert.equal(state.form_snapshot_ref,result.formSnapshotRef);
  assert.equal(Object.keys(JSON.parse(state.form_as_of_json)).length,8);

  // Statistics/history read the same verified backfilled Form set once results exist.
  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified) VALUES (?,1,'official',0,0)")
      .run('stats_entry_'+leg);
  }
  const stats=await getGameStatistics(env,{gameType:'V86'});
  assert.equal(stats.winners.byForm.reduce((sum,row)=>sum+row.starters,0),8);

  const detail=await getGameHistoryDetail(env,'stats_round');
  assert.ok(detail.legs.every(leg=>leg.systems.legacy_system.winnerContext?.formRank===1));
});

test('legacy Form fallback refuses analysis snapshots after the earliest pre-race cutoff',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('late_model','2099-01-02T12:30:00.000Z','analysis-exchange-v1')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('late_system','stats_round','late_model','main',200,8,0.25,3,'2099-01-02T12:30:00.000Z','{}')").run();
  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?,?,'2099-01-02T12:05:00.000Z',1,'2099-01-02T12:30:00.000Z')")
      .run('late_analysis_'+leg,'stats_race_'+leg,'late_model');
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('late_system',?,?,?)")
      .run(leg,'stats_entry_'+leg,leg<=3?1:0);
  }
  const audit=await auditStatisticsRound(env,'stats_round');
  assert.equal(audit.formLineage,null);
  assert.equal(audit.status.form,'unavailable');
});


test('deterministic closing-market archive gaps require manual review instead of endless retry',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,
     system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES ('stats_round','V86','stats_official','2099-01-02T22:00:00Z','results',
      100000,1000,100,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":1,"jackpot":false}}',8,2500000,25000)`).run();

  const result=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(result.status,'pending');
  assert.equal(result.metrics.finalMarket,'manual_review');
  assert.equal(result.metrics.form,'complete');
  assert.equal(result.errorClass,'closing_market_manual_review');
  assert.match(result.reason,/closing_market_manual_review/);
});

test('legacy Form and historical KAI judgments reject analyses created after the registered system',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('late_created_model','2099-01-02T11:00:00.000Z','analysis-exchange-v1')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('late_created_system','stats_round','late_created_model','main',200,8,0.25,3,'2099-01-02T11:40:00.000Z','{}')").run();
  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?,?,'2099-01-02T11:30:00.000Z',1,'2099-01-02T11:41:00.000Z')")
      .run('late_created_analysis_'+leg,'stats_race_'+leg,'late_created_model');
    db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,1,'A')")
      .run('late_created_prediction_'+leg,'late_created_analysis_'+leg,'stats_entry_'+leg,1);
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('late_created_system',?,?,?)")
      .run(leg,'stats_entry_'+leg,leg<=3?1:0);
  }

  const audit=await auditStatisticsRound(env,'stats_round');
  assert.equal(audit.formLineage,null);
  assert.equal(audit.status.form,'unavailable');
  assert.equal(audit.counts.kaiRank,0);
  assert.equal(audit.counts.abcd,0);
  assert.equal(audit.status.kaiRank,'unavailable');
  assert.equal(audit.status.abcd,'unavailable');
});

test('historical KAI judgments reject snapshots after the round pre-race cutoff',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('post_cutoff_model','2099-01-02T11:00:00.000Z','analysis-exchange-v1')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,created_at,metrics_json) VALUES ('post_cutoff_system','stats_round','post_cutoff_model','main',200,8,0.25,3,'2099-01-02T12:30:00.000Z','{}')").run();
  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES (?,?,?,'2099-01-02T12:05:00.000Z',1,'2099-01-02T12:20:00.000Z')")
      .run('post_cutoff_analysis_'+leg,'stats_race_'+leg,'post_cutoff_model');
    db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES (?,?,?,?,1,'A')")
      .run('post_cutoff_prediction_'+leg,'post_cutoff_analysis_'+leg,'stats_entry_'+leg,1);
    db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('post_cutoff_system',?,?,?)")
      .run(leg,'stats_entry_'+leg,leg<=3?1:0);
  }

  const audit=await auditStatisticsRound(env,'stats_round');
  assert.equal(audit.counts.kaiRank,0);
  assert.equal(audit.counts.abcd,0);
  assert.equal(audit.status.kaiRank,'unavailable');
  assert.equal(audit.status.abcd,'unavailable');
});


test('manual-review Form does not block later settlement facts from reconciling',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  db.prepare("UPDATE analysis_external_runs SET step1_facts_fingerprint='sha256:wrong' WHERE id='stats_run'").run();
  db.prepare("UPDATE analysis_external_exports SET artifact_fingerprint='sha256:wrong' WHERE game_round_id='stats_round' AND stage='step1'").run();

  const first=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(first.status,'pending');
  assert.equal(first.metrics.form,'manual_review');
  const attemptsAfterForm=db.prepare("SELECT attempt_count FROM statistics_data_backfill_rounds WHERE game_round_id='stats_round'").get().attempt_count;

  for(let leg=1;leg<=8;leg+=1){
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified) VALUES (?,1,'official',0,0)")
      .run('stats_entry_'+leg);
  }
  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,
     system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES ('stats_round','V86','stats_official','2099-01-02T22:00:00Z','results',
      100000,1000,100,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":1,"jackpot":false}}',8,2500000,25000)`).run();
  for(let leg=1;leg<=8;leg+=1){
    db.prepare(`INSERT INTO betting_snapshots
      (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run('stats_final_bet_'+leg,'stats_round',leg,'stats_entry_'+leg,'2099-01-02T22:00:00Z',50,leg,'stats_official');
  }

  const second=await runNextStatisticsDataBackfill(env,{now:'2100-01-01T00:06:00Z'});
  assert.equal(second.status,'manual_review');
  assert.equal(second.metrics.results,'complete');
  assert.equal(second.metrics.finalMarket,'complete');
  assert.equal(second.metrics.payout,'complete');
  assert.equal(second.metrics.form,'manual_review');
  assert.equal(db.prepare("SELECT attempt_count FROM statistics_data_backfill_rounds WHERE game_round_id='stats_round'").get().attempt_count,attemptsAfterForm);
});


test('deterministic Form source gaps are classified as manual review',()=>{
  const failure=classifyStatisticsFormFailure(new Error('round leg 5 has no active horse entries'));
  assert.deepEqual(failure,{status:'manual_review',errorClass:'form_source_incomplete'});
});

test('retryable closing-market failures back off and stop after bounded unchanged retries',async()=>{
  const {env,db}=createTestEnv();
  seedRound(db);
  await seedRecordedSystem(env,db);
  db.prepare("UPDATE source_records SET raw_object_key='raw/official_provider/retry.json' WHERE id='stats_official'").run();
  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES ('stats_round','V86','stats_official','2099-01-02T22:00:00Z','results',100000,1000,100,'{"8":{"payoutRaw":2500000,"payoutSek":25000,"systems":1,"jackpot":false}}',8,2500000,25000)`).run();
  let reads=0;
  env.RAW_BUCKET.get=async()=>{reads+=1;throw new Error('temporary archive outage');};

  const first=await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-01-01T00:00:00Z'});
  assert.equal(first.retryCount,1);
  assert.equal(first.nextCheckAt,'2100-01-01T00:05:00.000Z');
  assert.equal((await runNextStatisticsDataBackfill(env,{now:'2100-01-01T00:01:00Z'})).status,'idle');

  for(let attempt=2;attempt<=5;attempt+=1){
    await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:`2100-01-0${attempt}T00:00:00Z`});
  }
  const state=db.prepare(`SELECT b.final_market_status,r.retry_count,r.last_error_class
    FROM statistics_data_backfill_rounds b JOIN statistics_data_backfill_retry_state r ON r.game_round_id=b.game_round_id
    WHERE b.game_round_id='stats_round'`).get();
  assert.equal(state.final_market_status,'manual_review');
  assert.equal(state.retry_count,5);
  assert.equal(state.last_error_class,'closing_market_retryable_retry_exhausted');
  assert.equal(reads,5);

  const automatic=await runNextStatisticsDataBackfill(env,{now:'2100-02-01T00:00:00Z'});
  assert.equal(automatic.metrics.finalMarket,'manual_review');
  assert.equal(reads,5,'automatic runs must not repeat an exhausted failure with unchanged inputs');

  await runNextStatisticsDataBackfill(env,{roundId:'stats_round',now:'2100-02-01T00:01:00Z'});
  assert.equal(reads,6,'an explicit round retry may force a recovery attempt');
});
