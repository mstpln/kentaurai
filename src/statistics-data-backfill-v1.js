import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { persistAnalysisFormSnapshots, persistHistoricalFormSnapshots } from './analysis-form-snapshot-v1.js';
import { stableId } from './ids.js';
import { HORSE_FORM_INDEX_VERSION } from './statistics/horse-form-index.js';
import { repairCapturedOfficialClosingMarket } from './import/official-live.js';

export const STATISTICS_DATA_BACKFILL_VERSION = 'statistics-data-backfill-v1';

function nowIso(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('statistics backfill time is invalid');
  return date.toISOString();
}

function countStatus(value, expected, { pendingWhenZero = false } = {}) {
  const count = Number(value || 0);
  if (expected <= 0) return 'unavailable';
  if (count >= expected) return 'complete';
  if (pendingWhenZero && count === 0) return 'pending';
  return 'unavailable';
}

async function primarySystem(env, roundId) {
  return env.DB.prepare(`
    SELECT s.id,s.model_version_id,s.created_at,s.metrics_json
    FROM systems s
    WHERE s.id=COALESCE(
      (SELECT aer.main_system_id
       FROM analysis_external_runs aer
       WHERE aer.game_round_id=?
       ORDER BY datetime(aer.created_at) DESC,aer.id DESC
       LIMIT 1),
      (SELECT s1.id FROM systems s1
       WHERE s1.game_round_id=? AND s1.system_type='main'
       ORDER BY datetime(s1.created_at) DESC,s1.id ASC LIMIT 1),
      (SELECT s2.id FROM systems s2
       WHERE s2.game_round_id=?
       ORDER BY datetime(s2.created_at) ASC,s2.id ASC LIMIT 1)
    )
    LIMIT 1
  `).bind(roundId,roundId,roundId).first();
}

function jsonValue(text, key) {
  try {
    const value=JSON.parse(text || '{}');
    return value?.[key] ?? null;
  } catch {
    return null;
  }
}

async function step1Lineage(env, roundId, system) {
  if (!system) return null;
  const run=await env.DB.prepare(`
    SELECT id,step1_pack_id,step1_pack_as_of,step1_generated_at,step1_facts_fingerprint
    FROM analysis_external_runs
    WHERE game_round_id=? AND main_system_id=?
    ORDER BY datetime(created_at) DESC,id DESC
    LIMIT 1
  `).bind(roundId,system.id).first();
  if (run) {
    const audited=await env.DB.prepare(`
      SELECT artifact_id,artifact_fingerprint,as_of,generated_at
      FROM analysis_external_exports
      WHERE game_round_id=? AND stage='step1'
        AND artifact_id=? AND artifact_fingerprint=? AND as_of=? AND generated_at=?
      LIMIT 1
    `).bind(
      roundId,run.step1_pack_id,run.step1_facts_fingerprint,
      run.step1_pack_as_of,run.step1_generated_at
    ).first();
    if (!audited) return {
      source:'external_run',
      audited:false,
      externalRunId:run.id,
      packId:run.step1_pack_id,
      factsFingerprint:run.step1_facts_fingerprint,
      asOf:run.step1_pack_as_of,
      generatedAt:run.step1_generated_at
    };
    return {
      source:'external_run',
      audited:true,
      externalRunId:run.id,
      packId:run.step1_pack_id,
      factsFingerprint:run.step1_facts_fingerprint,
      asOf:run.step1_pack_as_of,
      generatedAt:run.step1_generated_at
    };
  }

  const packId=jsonValue(system.metrics_json,'step1_pack_id');
  const fingerprint=jsonValue(system.metrics_json,'step1_facts_fingerprint');
  if (!packId || !fingerprint) return null;
  const exported=await env.DB.prepare(`
    SELECT artifact_id,artifact_fingerprint,as_of,generated_at
    FROM analysis_external_exports
    WHERE game_round_id=? AND stage='step1'
      AND artifact_id=? AND artifact_fingerprint=?
    ORDER BY datetime(generated_at) DESC,id DESC
    LIMIT 1
  `).bind(roundId,String(packId),String(fingerprint)).first();
  if (!exported) return {
    source:'system_metrics',
    audited:false,
    externalRunId:null,
    packId:String(packId),
    factsFingerprint:String(fingerprint),
    asOf:null,
    generatedAt:null
  };
  return {
    source:'system_metrics',
    audited:true,
    externalRunId:null,
    packId:exported.artifact_id,
    factsFingerprint:exported.artifact_fingerprint,
    asOf:exported.as_of,
    generatedAt:exported.generated_at
  };
}

async function legacyFormLineage(env, roundId, system, preRaceCutoff) {
  if (!system?.model_version_id || !system?.created_at || !preRaceCutoff) return null;
  const {results}=await env.DB.prepare(`
    SELECT gl.leg_number,
      (SELECT ara.data_snapshot_at
       FROM ai_race_analyses ara
       WHERE ara.race_id=gl.race_id
         AND ara.model_version_id=?
         AND ara.data_snapshot_at IS NOT NULL
         AND julianday(ara.data_snapshot_at)<=julianday(?)
       ORDER BY julianday(ara.data_snapshot_at) DESC,ara.id DESC
       LIMIT 1) AS data_snapshot_at
    FROM game_legs gl
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number
  `).bind(system.model_version_id,system.created_at,roundId).all();
  if ((results || []).length!==8) return null;
  const cutoffMs=Date.parse(preRaceCutoff);
  if (!Number.isFinite(cutoffMs)) return null;
  const asOfByLeg=new Map();
  for(const row of results || []){
    const leg=Number(row.leg_number);
    const ms=Date.parse(String(row.data_snapshot_at || ''));
    if(!Number.isInteger(leg) || leg<1 || leg>8 || !Number.isFinite(ms) || ms>cutoffMs) return null;
    asOfByLeg.set(leg,new Date(ms).toISOString());
  }
  if(asOfByLeg.size!==8) return null;
  const snapshotRef=stableId(
    'historical-form',
    HORSE_FORM_INDEX_VERSION,
    system.id,
    ...[...asOfByLeg.entries()].flatMap(([leg,asOf])=>[leg,asOf])
  );
  return {
    kind:'legacy_analysis_snapshot',
    audited:true,
    snapshotRef,
    asOfByLeg
  };
}

async function scalar(env, sql, bindings = []) {
  const row=await env.DB.prepare(sql).bind(...bindings).first();
  return Number(row?.n || 0);
}

export async function auditStatisticsRound(env, roundId) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id=String(roundId || '').trim();
  if (!id) throw new Error('round_id is required');

  const round=await env.DB.prepare(`
    SELECT id,game_type,round_date,status,
      COALESCE(
        bet_stop_at,
        scheduled_start_at,
        (SELECT MIN(r.scheduled_start_at)
         FROM game_legs gl JOIN races r ON r.id=gl.race_id
         WHERE gl.game_round_id=game_rounds.id)
      ) AS pre_race_cutoff
    FROM game_rounds
    WHERE id=? AND game_type IN ('V85','V86')
    LIMIT 1
  `).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');

  const system=await primarySystem(env,id);
  if (!system) throw new Error('round has no registered system');
  const lineage=await step1Lineage(env,id,system);
  let formLineage=null;
  if(lineage?.audited && lineage.packId && lineage.asOf){
    const normalizedAsOf=new Date(Date.parse(lineage.asOf)).toISOString();
    formLineage={
      kind:'step1_pack',
      audited:true,
      snapshotRef:lineage.packId,
      asOfByLeg:new Map(Array.from({length:8},(_,index)=>[index+1,normalizedAsOf]))
    };
  } else {
    formLineage=await legacyFormLineage(env,id,system,round.pre_race_cutoff);
  }

  const activeEntries=await scalar(env,`
    SELECT COUNT(*) n
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    WHERE gl.game_round_id=? AND re.scratched=0
  `,[id]);

  const winnerLegs=await scalar(env,`
    SELECT COUNT(*) n FROM (
      SELECT gl.leg_number
      FROM game_legs gl
      WHERE gl.game_round_id=?
        AND (SELECT COUNT(*)
             FROM race_entries re
             JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1
             WHERE re.race_id=gl.race_id)=1
    )
  `,[id]);

  const finalResult=await env.DB.prepare(`
    SELECT source_record_id,payouts_json,highest_payout_level,highest_payout_sek
    FROM game_round_final_results
    WHERE game_round_id=?
    LIMIT 1
  `).bind(id).first();

  const closingMarketCount=finalResult ? await scalar(env,`
    SELECT COUNT(DISTINCT re.id) n
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
    JOIN betting_snapshots bs ON bs.race_entry_id=re.id
      AND bs.game_round_id=gl.game_round_id
      AND bs.leg_number=gl.leg_number
      AND bs.source_record_id=?
    WHERE gl.game_round_id=?
      AND bs.bet_percent IS NOT NULL
      AND bs.market_rank IS NOT NULL
  `,[finalResult.source_record_id,id]) : 0;

  const formSnapshotCount=formLineage?.snapshotRef ? await scalar(env,`
    SELECT COUNT(DISTINCT afs.race_entry_id) n
    FROM analysis_entry_form_snapshots afs
    JOIN race_entries re ON re.id=afs.race_entry_id AND re.scratched=0
    JOIN game_legs gl ON gl.game_round_id=afs.game_round_id
      AND gl.leg_number=afs.leg_number
      AND gl.race_id=re.race_id
    WHERE afs.game_round_id=? AND afs.step1_pack_id=?
  `,[id,formLineage.snapshotRef]) : 0;

  const kaiRankCount=system.model_version_id ? await scalar(env,`
    SELECT COUNT(DISTINCT re.id) n
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
    WHERE gl.game_round_id=?
      AND EXISTS (
        SELECT 1
        FROM ai_horse_predictions ahp
        JOIN ai_race_analyses ara ON ara.id=ahp.ai_race_analysis_id
        WHERE ara.race_id=gl.race_id
          AND ara.model_version_id=?
          AND ahp.race_entry_id=re.id
          AND ahp.raw_rank IS NOT NULL
          AND julianday(ara.data_snapshot_at)<=julianday(?)
      )
  `,[id,system.model_version_id,system.created_at]) : 0;

  const abcdCount=system.model_version_id ? await scalar(env,`
    SELECT COUNT(DISTINCT re.id) n
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
    WHERE gl.game_round_id=?
      AND EXISTS (
        SELECT 1
        FROM ai_horse_predictions ahp
        JOIN ai_race_analyses ara ON ara.id=ahp.ai_race_analysis_id
        WHERE ara.race_id=gl.race_id
          AND ara.model_version_id=?
          AND ahp.race_entry_id=re.id
          AND ahp.abcd_group IN ('A','B','C','D')
          AND julianday(ara.data_snapshot_at)<=julianday(?)
      )
  `,[id,system.model_version_id,system.created_at]) : 0;

  const spikeCount=await scalar(env,`
    SELECT COUNT(*) n
    FROM system_selections
    WHERE system_id=? AND is_spike=1
  `,[system.id]);

  const resultStatus=winnerLegs===8 ? 'complete' : 'pending';
  let finalMarketStatus=finalResult
    ? countStatus(closingMarketCount,activeEntries)
    : 'pending';
  if (finalResult && activeEntries===0) finalMarketStatus='unavailable';

  const payoutStatus=finalResult
    ? (finalResult.payouts_json && finalResult.highest_payout_sek != null ? 'complete' : 'unavailable')
    : 'pending';

  const formStatus=formSnapshotCount>=activeEntries && activeEntries>0
    ? 'complete'
    : formLineage?.audited
      ? 'pending'
      : 'unavailable';

  return {
    version:STATISTICS_DATA_BACKFILL_VERSION,
    roundId:id,
    gameType:round.game_type,
    roundDate:round.round_date,
    primarySystemId:system.id,
    modelVersionId:system.model_version_id || null,
    lineage,
    formLineage,
    counts:{
      activeEntries,
      winnerLegs,
      closingMarket:closingMarketCount,
      formSnapshots:formSnapshotCount,
      kaiRank:kaiRankCount,
      abcd:abcdCount,
      spikes:spikeCount
    },
    status:{
      results:resultStatus,
      finalMarket:finalMarketStatus,
      payout:payoutStatus,
      form:formStatus,
      kaiRank:kaiRankCount>=activeEntries && activeEntries>0 ? 'complete' : 'unavailable',
      abcd:abcdCount>=activeEntries && activeEntries>0 ? 'complete' : 'unavailable',
      spikes:spikeCount===3 ? 'complete' : 'unavailable'
    },
    finalGameSourceRecordId:finalResult?.source_record_id || null,
    highestPayoutLevel:finalResult?.highest_payout_level == null ? null : Number(finalResult.highest_payout_level),
    highestPayoutSek:finalResult?.highest_payout_sek == null ? null : Number(finalResult.highest_payout_sek)
  };
}

function overallStatus(audit, formOverride = null) {
  const status={...audit.status,form:formOverride || audit.status.form};
  if (status.form==='manual_review') return 'manual_review';
  if (['results','finalMarket','payout'].some((key)=>status[key]==='pending')) return 'pending';
  return Object.values(status).every((value)=>value==='complete')
    ? 'complete'
    : 'complete_with_gaps';
}

async function persistAudit(env, audit, { formStatus = null, lastError = null, attempted = false } = {}) {
  const normalizedForm=formStatus || audit.status.form;
  const overall=overallStatus(audit,normalizedForm);
  const completedAt=overall==='pending' ? null : new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO statistics_data_backfill_rounds
      (game_round_id,status,result_status,final_market_status,payout_status,form_status,
       kai_rank_status,abcd_status,spike_status,active_entry_count,closing_market_count,
       form_snapshot_count,kai_rank_count,abcd_count,spike_count,form_lineage_kind,form_snapshot_ref,
       form_as_of_json,step1_pack_id,step1_facts_fingerprint,step1_as_of,attempt_count,last_error,last_checked_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(game_round_id) DO UPDATE SET
      status=excluded.status,
      result_status=excluded.result_status,
      final_market_status=excluded.final_market_status,
      payout_status=excluded.payout_status,
      form_status=excluded.form_status,
      kai_rank_status=excluded.kai_rank_status,
      abcd_status=excluded.abcd_status,
      spike_status=excluded.spike_status,
      active_entry_count=excluded.active_entry_count,
      closing_market_count=excluded.closing_market_count,
      form_snapshot_count=excluded.form_snapshot_count,
      kai_rank_count=excluded.kai_rank_count,
      abcd_count=excluded.abcd_count,
      spike_count=excluded.spike_count,
      form_lineage_kind=excluded.form_lineage_kind,
      form_snapshot_ref=excluded.form_snapshot_ref,
      form_as_of_json=excluded.form_as_of_json,
      step1_pack_id=excluded.step1_pack_id,
      step1_facts_fingerprint=excluded.step1_facts_fingerprint,
      step1_as_of=excluded.step1_as_of,
      attempt_count=statistics_data_backfill_rounds.attempt_count+?,
      last_error=excluded.last_error,
      last_checked_at=excluded.last_checked_at,
      completed_at=excluded.completed_at,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    audit.roundId,overall,audit.status.results,audit.status.finalMarket,audit.status.payout,normalizedForm,
    audit.status.kaiRank,audit.status.abcd,audit.status.spikes,
    audit.counts.activeEntries,audit.counts.closingMarket,audit.counts.formSnapshots,
    audit.counts.kaiRank,audit.counts.abcd,audit.counts.spikes,
    audit.formLineage?.kind || null,audit.formLineage?.snapshotRef || null,
    audit.formLineage?.asOfByLeg ? JSON.stringify(Object.fromEntries(audit.formLineage.asOfByLeg)) : null,
    audit.lineage?.packId || null,audit.lineage?.factsFingerprint || null,audit.lineage?.asOf || null,
    attempted ? 1 : 0,lastError,
    new Date().toISOString(),completedAt,
    attempted ? 1 : 0
  ).run();
  return overall;
}

export async function ensureStatisticsDataBackfillQueue(env, value = Date.now()) {
  if (!env?.DB) throw new Error('DB is not configured');
  const at=nowIso(value);
  const result=await env.DB.prepare(`
    INSERT OR IGNORE INTO statistics_data_backfill_rounds
      (game_round_id,status,result_status,final_market_status,payout_status,form_status,
       kai_rank_status,abcd_status,spike_status,last_checked_at)
    SELECT gr.id,'pending','pending','pending','pending','pending',
           'unavailable','unavailable','unavailable',?
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND EXISTS (SELECT 1 FROM systems s WHERE s.game_round_id=gr.id)
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8
      AND datetime(COALESCE(
        gr.bet_stop_at,
        gr.scheduled_start_at,
        gr.round_date || 'T23:59:59Z'
      )) < datetime(?)
  `).bind(at,at).run();
  return { version:STATISTICS_DATA_BACKFILL_VERSION, created:Number(result.meta?.changes || 0) };
}

async function nextQueuedRound(env) {
  return env.DB.prepare(`
    SELECT game_round_id
    FROM statistics_data_backfill_rounds
    WHERE status='pending'
    ORDER BY last_checked_at ASC,game_round_id ASC
    LIMIT 1
  `).first();
}

async function replayFormSnapshot(env, audit) {
  const formLineage=audit.formLineage;
  if (!formLineage?.audited || !formLineage.snapshotRef) {
    return { status:'unavailable', reason:'verified_form_lineage_missing' };
  }
  if(formLineage.kind==='step1_pack'){
    const lineage=audit.lineage;
    if(!lineage?.packId || !lineage.factsFingerprint || !lineage.asOf) {
      return { status:'unavailable', reason:'verified_step1_lineage_missing' };
    }
    const pack=await createPreMarketAnalysisPackV3(env,audit.roundId,{asOf:lineage.asOf});
    if (pack.packId!==lineage.packId || pack.factsFingerprint!==lineage.factsFingerprint || pack.manifest?.as_of!==lineage.asOf) {
      return {
        status:'manual_review',
        reason:'step1_replay_fingerprint_mismatch',
        replayedPackId:pack.packId,
        replayedFingerprint:pack.factsFingerprint
      };
    }
    const persisted=await persistAnalysisFormSnapshots(env,pack);
    return { status:'complete', persisted };
  }
  if(formLineage.kind==='legacy_analysis_snapshot'){
    const persisted=await persistHistoricalFormSnapshots(env,{
      roundId:audit.roundId,
      snapshotRef:formLineage.snapshotRef,
      asOfByLeg:formLineage.asOfByLeg
    });
    return { status:'complete', persisted };
  }
  return { status:'unavailable', reason:'unsupported_form_lineage' };
}

export async function runNextStatisticsDataBackfill(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  await ensureStatisticsDataBackfillQueue(env,options.now ?? Date.now());
  const requested=options.roundId == null ? null : String(options.roundId).trim();
  const target=requested
    ? await env.DB.prepare('SELECT game_round_id FROM statistics_data_backfill_rounds WHERE game_round_id=? LIMIT 1').bind(requested).first()
    : await nextQueuedRound(env);
  if (requested && !target) throw new Error('round is not eligible for historical statistics backfill');
  if (!target) return { version:STATISTICS_DATA_BACKFILL_VERSION, status:'idle' };

  let audit=await auditStatisticsRound(env,target.game_round_id);
  let attempted=false;
  let formOverride=null;
  const errors=[];

  if (audit.finalGameSourceRecordId && audit.status.finalMarket!=='complete') {
    attempted=true;
    try {
      await repairCapturedOfficialClosingMarket(env,audit.finalGameSourceRecordId);
      audit=await auditStatisticsRound(env,target.game_round_id);
      if (audit.status.finalMarket!=='complete') audit.status.finalMarket='unavailable';
    } catch (error) {
      audit.status.finalMarket='unavailable';
      errors.push('closing_market_repair: '+String(error?.message || error));
    }
  }

  if (audit.status.form==='pending') {
    attempted=true;
    try {
      const replay=await replayFormSnapshot(env,audit);
      formOverride=replay.status;
      if (replay.status==='manual_review') errors.push('form_replay: '+replay.reason);
      if (replay.status==='complete') audit=await auditStatisticsRound(env,target.game_round_id);
    } catch (error) {
      formOverride='manual_review';
      errors.push('form_replay: '+String(error?.message || error));
    }
  }

  const lastError=errors.length ? errors.join(' | ').slice(0,1000) : null;
  const overall=await persistAudit(env,audit,{formStatus:formOverride,lastError,attempted});
  return {
    version:STATISTICS_DATA_BACKFILL_VERSION,
    status:overall,
    roundId:audit.roundId,
    metrics:{...audit.status,form:formOverride || audit.status.form},
    counts:audit.counts,
    step1PackId:audit.lineage?.packId || null,
    formLineageKind:audit.formLineage?.kind || null,
    formSnapshotRef:audit.formLineage?.snapshotRef || null,
    reason:lastError
  };
}

export async function getStatisticsDataBackfillStatus(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const {results}=await env.DB.prepare(`
    SELECT status,COUNT(*) n
    FROM statistics_data_backfill_rounds
    GROUP BY status
    ORDER BY status
  `).all();
  const totals=Object.fromEntries((results || []).map((row)=>[row.status,Number(row.n || 0)]));
  const coverage=await env.DB.prepare(`
    SELECT
      COUNT(*) rounds,
      SUM(CASE WHEN result_status='complete' THEN 1 ELSE 0 END) results_complete,
      SUM(CASE WHEN final_market_status='complete' THEN 1 ELSE 0 END) final_market_complete,
      SUM(CASE WHEN payout_status='complete' THEN 1 ELSE 0 END) payout_complete,
      SUM(CASE WHEN form_status='complete' THEN 1 ELSE 0 END) form_complete,
      SUM(CASE WHEN kai_rank_status='complete' THEN 1 ELSE 0 END) kai_rank_complete,
      SUM(CASE WHEN abcd_status='complete' THEN 1 ELSE 0 END) abcd_complete,
      SUM(CASE WHEN spike_status='complete' THEN 1 ELSE 0 END) spike_complete
    FROM statistics_data_backfill_rounds
  `).first();
  const {results:attention}=await env.DB.prepare(`
    SELECT game_round_id,status,result_status,final_market_status,payout_status,form_status,
           kai_rank_status,abcd_status,spike_status,last_error,last_checked_at
    FROM statistics_data_backfill_rounds
    WHERE status IN ('complete_with_gaps','manual_review')
    ORDER BY game_round_id DESC
    LIMIT 50
  `).all();
  return {
    version:STATISTICS_DATA_BACKFILL_VERSION,
    totals,
    coverage:{
      rounds:Number(coverage?.rounds || 0),
      results:Number(coverage?.results_complete || 0),
      finalMarket:Number(coverage?.final_market_complete || 0),
      payout:Number(coverage?.payout_complete || 0),
      form:Number(coverage?.form_complete || 0),
      kaiRank:Number(coverage?.kai_rank_complete || 0),
      abcd:Number(coverage?.abcd_complete || 0),
      spikes:Number(coverage?.spike_complete || 0)
    },
    attention:attention || []
  };
}
