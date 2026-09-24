import { stableId } from './ids.js';
import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from './analysis-pack-v3-asof-guard.js';
import { persistAnalysisFormSnapshots } from './analysis-form-snapshot-v1.js';

export const GAME_STATISTICS_BACKFILL_VERSION = 'game-statistics-backfill-v1';
const LEASE_MS = 4 * 60_000;
const MAX_ERROR = 1200;

function iso(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('backfill time is invalid');
  return date.toISOString();
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function primarySystem(env, roundId) {
  return env.DB.prepare(`
    SELECT s.*
    FROM systems s
    WHERE s.id=COALESCE(
      (SELECT aer.main_system_id FROM analysis_external_runs aer
       WHERE aer.game_round_id=? ORDER BY datetime(aer.created_at) DESC,aer.id DESC LIMIT 1),
      (SELECT s1.id FROM systems s1
       WHERE s1.game_round_id=? AND s1.system_type='main'
       ORDER BY datetime(s1.created_at) DESC,s1.id ASC LIMIT 1),
      (SELECT s2.id FROM systems s2
       WHERE s2.game_round_id=? ORDER BY datetime(s2.created_at) ASC,s2.id ASC LIMIT 1)
    )
    LIMIT 1
  `).bind(roundId,roundId,roundId).first();
}

async function lineageForSystem(env, roundId, system) {
  if (!system) return null;
  const external = await env.DB.prepare(`
    SELECT id,step1_pack_id,step1_pack_as_of,step1_facts_fingerprint
    FROM analysis_external_runs
    WHERE game_round_id=? AND main_system_id=?
    ORDER BY datetime(created_at) DESC,id DESC
    LIMIT 1
  `).bind(roundId,system.id).first();
  if (external) {
    return {
      type:'external_run',
      sourceId:external.id,
      packId:external.step1_pack_id,
      asOf:external.step1_pack_as_of,
      factsFingerprint:external.step1_facts_fingerprint
    };
  }

  const metrics=parseJson(system.metrics_json,{});
  const packId=String(metrics.step1_pack_id || '').trim();
  const fingerprint=String(metrics.step1_facts_fingerprint || '').trim();
  if (!packId || !fingerprint) return null;

  const exported=await env.DB.prepare(`
    SELECT id,as_of,artifact_fingerprint
    FROM analysis_external_exports
    WHERE game_round_id=? AND stage='step1' AND artifact_id=?
      AND artifact_fingerprint=?
    ORDER BY datetime(generated_at) DESC,id DESC
    LIMIT 1
  `).bind(roundId,packId,fingerprint).first();
  if (!exported) return null;
  return {
    type:'external_export',
    sourceId:exported.id,
    packId,
    asOf:exported.as_of,
    factsFingerprint:fingerprint
  };
}

async function roundCounts(env, roundId, systemId, packId = null) {
  const row=await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=?) AS legs,
      (SELECT COUNT(*) FROM game_legs gl
       WHERE gl.game_round_id=?
         AND (SELECT COUNT(*) FROM race_entries re
              JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1
              WHERE re.race_id=gl.race_id)=1) AS settled_legs,
      (SELECT COUNT(*) FROM game_legs gl JOIN race_entries re ON re.race_id=gl.race_id
       WHERE gl.game_round_id=? AND re.scratched=0) AS active_entries,
      (SELECT COUNT(*) FROM system_selections ss WHERE ss.system_id=?) AS system_selections,
      (SELECT COUNT(DISTINCT ss.leg_number) FROM system_selections ss WHERE ss.system_id=?) AS system_legs,
      (SELECT COUNT(DISTINCT ss.leg_number) FROM system_selections ss WHERE ss.system_id=? AND ss.is_spike=1) AS spike_legs,
      (SELECT COUNT(*) FROM analysis_entry_form_snapshots afs
       WHERE afs.game_round_id=? AND (? IS NOT NULL AND afs.step1_pack_id=?)) AS form_rows,
      (SELECT COUNT(*) FROM analysis_entry_form_snapshots afs
       WHERE afs.game_round_id=? AND (? IS NOT NULL AND afs.step1_pack_id=?) AND afs.form_score IS NOT NULL) AS form_scores,
      (SELECT COUNT(*) FROM system_entry_judgment_snapshots sjs WHERE sjs.system_id=?) AS judgment_rows
  `).bind(
    roundId,roundId,roundId,systemId,systemId,systemId,
    roundId,packId,packId,roundId,packId,packId,systemId
  ).first();
  return {
    legs:Number(row?.legs||0),
    settledLegs:Number(row?.settled_legs||0),
    activeEntries:Number(row?.active_entries||0),
    systemSelections:Number(row?.system_selections||0),
    systemLegs:Number(row?.system_legs||0),
    spikeLegs:Number(row?.spike_legs||0),
    formRows:Number(row?.form_rows||0),
    formScores:Number(row?.form_scores||0),
    judgmentRows:Number(row?.judgment_rows||0)
  };
}

async function finalCoverage(env, roundId) {
  const final=await env.DB.prepare(`
    SELECT game_round_id,source_record_id,highest_payout_level,highest_payout_raw,highest_payout_sek
    FROM game_round_final_results WHERE game_round_id=? LIMIT 1
  `).bind(roundId).first();
  if (!final) return { final:null, closingMarketEntries:0 };
  const row=await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
    JOIN betting_snapshots bs ON bs.race_entry_id=re.id
      AND bs.game_round_id=gl.game_round_id
      AND bs.leg_number=gl.leg_number
      AND bs.source_record_id=?
      AND bs.bet_percent IS NOT NULL
      AND bs.market_rank IS NOT NULL
    WHERE gl.game_round_id=?
  `).bind(final.source_record_id,roundId).first();
  return { final, closingMarketEntries:Number(row?.n||0) };
}

async function persistJudgments(env, roundId, system) {
  if (!system?.id || !system.model_version_id) return 0;
  const {results}=await env.DB.prepare(`
    WITH ranked AS (
      SELECT gl.leg_number,re.id AS race_entry_id,ahp.raw_rank,ahp.abcd_group,
             ara.id AS analysis_id,ara.data_snapshot_at,
             ROW_NUMBER() OVER (
               PARTITION BY re.id
               ORDER BY julianday(ara.data_snapshot_at) DESC,julianday(ara.created_at) DESC,ara.id ASC
             ) AS rn
      FROM game_legs gl
      JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
      JOIN ai_horse_predictions ahp ON ahp.race_entry_id=re.id
      JOIN ai_race_analyses ara ON ara.id=ahp.ai_race_analysis_id
      WHERE gl.game_round_id=?
        AND ara.race_id=gl.race_id
        AND ara.model_version_id=?
        AND julianday(ara.data_snapshot_at)<=julianday(?)
    )
    SELECT leg_number,race_entry_id,raw_rank,abcd_group,analysis_id,data_snapshot_at
    FROM ranked WHERE rn=1
    ORDER BY leg_number,race_entry_id
  `).bind(roundId,system.model_version_id,system.created_at).all();
  const rows=results||[];
  if (!rows.length) return 0;
  let inserted=0;
  for (let offset=0;offset<rows.length;offset+=50) {
    const batch=rows.slice(offset,offset+50).map(row=>env.DB.prepare(`
      INSERT OR IGNORE INTO system_entry_judgment_snapshots
        (system_id,game_round_id,leg_number,race_entry_id,raw_rank,abcd_group,source_kind,source_id,as_of)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      system.id,roundId,Number(row.leg_number),row.race_entry_id,
      row.raw_rank==null?null:Number(row.raw_rank),row.abcd_group||null,
      'ai_prediction',row.analysis_id,row.data_snapshot_at||null
    ));
    const writes=await env.DB.batch(batch);
    inserted+=writes.reduce((sum,item)=>sum+Number(item.meta?.changes||0),0);
  }
  return inserted;
}

async function backfillForm(env, roundId, lineage) {
  if (!lineage?.packId || !lineage?.asOf || !lineage?.factsFingerprint) {
    return { status:'unavailable_no_lineage', inserted:0, actualPackId:null, actualFingerprint:null };
  }
  const existing=await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM analysis_entry_form_snapshots
    WHERE game_round_id=? AND step1_pack_id=?
  `).bind(roundId,lineage.packId).first();
  if (Number(existing?.n||0)>0) {
    return { status:'existing', inserted:0, actualPackId:lineage.packId, actualFingerprint:lineage.factsFingerprint };
  }

  try {
    await assertAnalysisPackReplaySafe(env,roundId,lineage.asOf);
    const pack=await createPreMarketAnalysisPackV3(env,roundId,{asOf:lineage.asOf});
    if (pack.manifest.pack_id!==lineage.packId || pack.manifest.facts_fingerprint!==lineage.factsFingerprint) {
      return {
        status:'unavailable_fingerprint_mismatch',
        inserted:0,
        actualPackId:pack.manifest.pack_id,
        actualFingerprint:pack.manifest.facts_fingerprint
      };
    }
    const saved=await persistAnalysisFormSnapshots(env,pack);
    return {
      status:'backfilled',
      inserted:Number(saved.inserted||0),
      actualPackId:pack.manifest.pack_id,
      actualFingerprint:pack.manifest.facts_fingerprint
    };
  } catch (error) {
    return {
      status:'unavailable_replay_guard',
      inserted:0,
      actualPackId:null,
      actualFingerprint:null,
      error:String(error.message||error).slice(0,MAX_ERROR)
    };
  }
}

function metricStatuses({counts,finalCoverage,lineage,formResult}) {
  const resultsStatus=counts.legs===8&&counts.settledLegs===8?'complete':'pending';
  const finalResultStatus=finalCoverage.final?'complete':'pending_post_race_settlement';
  const closingMarketStatus=finalCoverage.final&&counts.activeEntries>0&&finalCoverage.closingMarketEntries===counts.activeEntries
    ?'complete'
    :(finalCoverage.final?'partial':'pending_post_race_settlement');
  const payoutStatus=finalCoverage.final&&finalCoverage.final.highest_payout_level!=null
    ?'complete'
    :(finalCoverage.final?'partial':'pending_post_race_settlement');
  const systemStatus=counts.systemLegs===8&&counts.spikeLegs===3?'complete':'partial';
  let formStatus='unavailable_no_lineage';
  if (formResult?.status==='backfilled'&&counts.activeEntries>0&&counts.formRows===counts.activeEntries) formStatus='complete_after_backfill';
  else if (counts.activeEntries>0&&counts.formRows===counts.activeEntries) formStatus='complete';
  else if (formResult?.status) formStatus=formResult.status;
  else if (lineage) formStatus='pending_backfill';
  const judgmentStatus=counts.activeEntries>0&&counts.judgmentRows===counts.activeEntries?'complete':'partial';
  return {resultsStatus,finalResultStatus,closingMarketStatus,payoutStatus,systemStatus,formStatus,judgmentStatus};
}

function missingMetrics(statuses) {
  const missing=[];
  if (statuses.resultsStatus!=='complete') missing.push('results');
  if (statuses.finalResultStatus!=='complete') missing.push('final_game');
  if (statuses.closingMarketStatus!=='complete') missing.push('closing_market');
  if (statuses.payoutStatus!=='complete') missing.push('payout');
  if (statuses.systemStatus!=='complete') missing.push('system');
  if (!String(statuses.formStatus).startsWith('complete')) missing.push('form');
  if (statuses.judgmentStatus!=='complete') missing.push('kentaurai_judgment');
  return missing;
}

export async function inspectGameStatisticsRoundCoverage(env,roundId,{attemptBackfill=false}={}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round=await env.DB.prepare(`
    SELECT id,game_type,round_date,status FROM game_rounds
    WHERE id=? AND game_type IN ('V85','V86') LIMIT 1
  `).bind(String(roundId)).first();
  if (!round) throw new Error('V85/V86 round was not found');
  const system=await primarySystem(env,round.id);
  if (!system) {
    return {
      roundId:round.id,gameType:round.game_type,roundDate:round.round_date,primarySystemId:null,
      complete:false,missingMetrics:['system']
    };
  }
  const lineage=await lineageForSystem(env,round.id,system);
  const before=await roundCounts(env,round.id,system.id,lineage?.packId||null);
  const insertedJudgments=attemptBackfill ? await persistJudgments(env,round.id,system) : 0;
  let formResult=null;
  if (attemptBackfill && before.formRows<before.activeEntries) formResult=await backfillForm(env,round.id,lineage);
  const counts=await roundCounts(env,round.id,system.id,lineage?.packId||null);
  const final=await finalCoverage(env,round.id);
  const statuses=metricStatuses({counts,finalCoverage:final,lineage,formResult});
  const missing=missingMetrics(statuses);
  return {
    roundId:round.id,
    gameType:round.game_type,
    roundDate:round.round_date,
    primarySystemId:system.id,
    lineageType:lineage?.type||null,
    lineageSourceId:lineage?.sourceId||null,
    expectedPackId:lineage?.packId||null,
    expectedPackAsOf:lineage?.asOf||null,
    expectedFactsFingerprint:lineage?.factsFingerprint||null,
    actualPackId:formResult?.actualPackId||null,
    actualFactsFingerprint:formResult?.actualFingerprint||null,
    ...statuses,
    activeEntries:counts.activeEntries,
    closingMarketEntries:final.closingMarketEntries,
    formSnapshotEntries:counts.formRows,
    formScoreEntries:counts.formScores,
    judgmentEntries:counts.judgmentRows,
    insertedFormRows:Number(formResult?.inserted||0),
    insertedJudgmentRows:insertedJudgments,
    complete:missing.length===0,
    missingMetrics:missing,
    error:formResult?.error||null
  };
}

export async function getGameStatisticsCoverageAudit(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const {results}=await env.DB.prepare(`
    SELECT gr.id
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND EXISTS(SELECT 1 FROM systems s WHERE s.game_round_id=gr.id)
    ORDER BY gr.round_date DESC,gr.id DESC
  `).all();
  const summary={
    rounds:0,complete:0,resultsComplete:0,finalGameComplete:0,closingMarketComplete:0,payoutComplete:0,
    systemComplete:0,formComplete:0,judgmentComplete:0
  };
  const items=[];
  for (const row of results||[]) {
    const item=await inspectGameStatisticsRoundCoverage(env,row.id);
    items.push(item);
    summary.rounds+=1;
    if(item.complete)summary.complete+=1;
    if(item.resultsStatus==='complete')summary.resultsComplete+=1;
    if(item.finalResultStatus==='complete')summary.finalGameComplete+=1;
    if(item.closingMarketStatus==='complete')summary.closingMarketComplete+=1;
    if(item.payoutStatus==='complete')summary.payoutComplete+=1;
    if(item.systemStatus==='complete')summary.systemComplete+=1;
    if(String(item.formStatus).startsWith('complete'))summary.formComplete+=1;
    if(item.judgmentStatus==='complete')summary.judgmentComplete+=1;
  }
  return {version:GAME_STATISTICS_BACKFILL_VERSION,summary,rounds:items};
}

export async function ensureGameStatisticsBackfillJob(env,now=Date.now()) {
  if (!env?.DB) throw new Error('DB is not configured');
  const started=iso(now);
  const count=await env.DB.prepare(`
    SELECT COUNT(DISTINCT gr.id) AS n
    FROM game_rounds gr JOIN systems s ON s.game_round_id=gr.id
    WHERE gr.game_type IN ('V85','V86')
  `).first();
  const total=Number(count?.n||0);
  const id=stableId('game-statistics-backfill',GAME_STATISTICS_BACKFILL_VERSION);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO game_statistics_backfill_jobs
      (id,status,total_rounds,started_at)
    VALUES (?,'running',?,?)
  `).bind(id,total,started).run();
  await env.DB.prepare(`
    UPDATE game_statistics_backfill_jobs
    SET total_rounds=?,status=CASE WHEN status='completed' AND processed_rounds<? THEN 'running' ELSE status END,
        completed_at=CASE WHEN status='completed' AND processed_rounds<? THEN NULL ELSE completed_at END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(total,total,total,id).run();
  return getGameStatisticsBackfillJob(env,id);
}

export async function getGameStatisticsBackfillJob(env,id=null) {
  const jobId=id||stableId('game-statistics-backfill',GAME_STATISTICS_BACKFILL_VERSION);
  return env.DB.prepare(`
    SELECT id,status,cursor_round_date,cursor_round_id,total_rounds,processed_rounds,
           form_backfilled_rounds,form_rows_inserted,judgment_rows_inserted,complete_rounds,
           unresolved_rounds,consecutive_errors,last_error,started_at,completed_at,created_at,updated_at
    FROM game_statistics_backfill_jobs WHERE id=? LIMIT 1
  `).bind(jobId).first();
}

async function nextRound(env,job) {
  const cursorDate=job.cursor_round_date||'0000-00-00';
  const cursorId=job.cursor_round_id||'';
  return env.DB.prepare(`
    SELECT gr.id,gr.round_date
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND EXISTS(SELECT 1 FROM systems s WHERE s.game_round_id=gr.id)
      AND (gr.round_date>? OR (gr.round_date=? AND gr.id>?))
    ORDER BY gr.round_date ASC,gr.id ASC
    LIMIT 1
  `).bind(cursorDate,cursorDate,cursorId).first();
}

export async function runNextGameStatisticsBackfill(env,options={}) {
  const nowIso=iso(options.now??Date.now());
  let job=await ensureGameStatisticsBackfillJob(env,nowIso);
  if (!job || job.status==='completed') return {status:'completed',job};

  const token=crypto.randomUUID();
  const leased=await env.DB.prepare(`
    UPDATE game_statistics_backfill_jobs
    SET lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running' AND (lease_until IS NULL OR lease_until<?)
  `).bind(token,new Date(Date.parse(nowIso)+LEASE_MS).toISOString(),job.id,nowIso).run();
  if(Number(leased.meta?.changes||0)!==1)return {status:'busy',job};

  try {
    job=await getGameStatisticsBackfillJob(env,job.id);
    const target=await nextRound(env,job);
    if(!target){
      await env.DB.prepare(`
        UPDATE game_statistics_backfill_jobs
        SET status='completed',completed_at=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND lease_token=?
      `).bind(nowIso,job.id,token).run();
      return {status:'completed',job:await getGameStatisticsBackfillJob(env,job.id)};
    }

    const coverage=await inspectGameStatisticsRoundCoverage(env,target.id,{attemptBackfill:true});
    await env.DB.prepare(`
      INSERT INTO game_statistics_backfill_rounds (
        job_id,game_round_id,primary_system_id,lineage_type,lineage_source_id,
        expected_pack_id,expected_pack_as_of,expected_facts_fingerprint,actual_pack_id,actual_facts_fingerprint,
        results_status,final_result_status,closing_market_status,payout_status,system_status,form_status,judgment_status,
        active_entries,closing_market_entries,form_snapshot_entries,form_score_entries,judgment_entries,
        inserted_form_rows,inserted_judgment_rows,missing_metrics_json,error_message,checked_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id,game_round_id) DO UPDATE SET
        primary_system_id=excluded.primary_system_id,lineage_type=excluded.lineage_type,lineage_source_id=excluded.lineage_source_id,
        expected_pack_id=excluded.expected_pack_id,expected_pack_as_of=excluded.expected_pack_as_of,
        expected_facts_fingerprint=excluded.expected_facts_fingerprint,actual_pack_id=excluded.actual_pack_id,
        actual_facts_fingerprint=excluded.actual_facts_fingerprint,results_status=excluded.results_status,
        final_result_status=excluded.final_result_status,closing_market_status=excluded.closing_market_status,
        payout_status=excluded.payout_status,system_status=excluded.system_status,form_status=excluded.form_status,
        judgment_status=excluded.judgment_status,active_entries=excluded.active_entries,
        closing_market_entries=excluded.closing_market_entries,form_snapshot_entries=excluded.form_snapshot_entries,
        form_score_entries=excluded.form_score_entries,judgment_entries=excluded.judgment_entries,
        inserted_form_rows=excluded.inserted_form_rows,inserted_judgment_rows=excluded.inserted_judgment_rows,
        missing_metrics_json=excluded.missing_metrics_json,error_message=excluded.error_message,checked_at=excluded.checked_at
    `).bind(
      job.id,coverage.roundId,coverage.primarySystemId,coverage.lineageType,coverage.lineageSourceId,
      coverage.expectedPackId,coverage.expectedPackAsOf,coverage.expectedFactsFingerprint,coverage.actualPackId,coverage.actualFactsFingerprint,
      coverage.resultsStatus,coverage.finalResultStatus,coverage.closingMarketStatus,coverage.payoutStatus,coverage.systemStatus,
      coverage.formStatus,coverage.judgmentStatus,coverage.activeEntries,coverage.closingMarketEntries,
      coverage.formSnapshotEntries,coverage.formScoreEntries,coverage.judgmentEntries,coverage.insertedFormRows,
      coverage.insertedJudgmentRows,JSON.stringify(coverage.missingMetrics),coverage.error,nowIso
    ).run();

    await env.DB.prepare(`
      UPDATE game_statistics_backfill_jobs
      SET cursor_round_date=?,cursor_round_id=?,processed_rounds=processed_rounds+1,
          form_backfilled_rounds=form_backfilled_rounds+?,
          form_rows_inserted=form_rows_inserted+?,
          judgment_rows_inserted=judgment_rows_inserted+?,
          complete_rounds=complete_rounds+?,
          unresolved_rounds=unresolved_rounds+?,
          consecutive_errors=0,last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=?
    `).bind(
      target.round_date,target.id,
      coverage.insertedFormRows>0?1:0,coverage.insertedFormRows,coverage.insertedJudgmentRows,
      coverage.complete?1:0,coverage.complete?0:1,job.id,token
    ).run();
    return {status:'running',coverage,job:await getGameStatisticsBackfillJob(env,job.id)};
  } catch(error) {
    await env.DB.prepare(`
      UPDATE game_statistics_backfill_jobs
      SET consecutive_errors=consecutive_errors+1,last_error=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=?
    `).bind(String(error.message||error).slice(0,MAX_ERROR),job.id,token).run();
    throw error;
  }
}
