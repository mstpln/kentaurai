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

async function sha256(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return 'sha256:'+Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,'0')).join('');
}

function futureIso(value, milliseconds) {
  return new Date(Date.parse(value)+milliseconds).toISOString();
}

function retryDelayMs(retryCount) {
  const delays=[5*60*1000,30*60*1000,2*60*60*1000,6*60*60*1000,12*60*60*1000];
  return delays[Math.min(Math.max(Number(retryCount || 1)-1,0),delays.length-1)];
}

function retryDue(value, now) {
  return !value || Date.parse(value)<=Date.parse(now);
}

function deterministicFormFailure(error) {
  const message=String(error?.message || error || '');
  return /has no active horse entries|analysis pack identity is incomplete|as-of is missing|unsupported_form_lineage/i.test(message);
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
         AND julianday(ara.data_snapshot_at)<=julianday(?)
         AND julianday(ara.created_at)<=julianday(?)
       ORDER BY julianday(ara.data_snapshot_at) DESC,julianday(ara.created_at) DESC,ara.id DESC
       LIMIT 1) AS data_snapshot_at
    FROM game_legs gl
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number
  `).bind(system.model_version_id,system.created_at,preRaceCutoff,system.created_at,roundId).all();
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
      (SELECT value FROM (
        SELECT game_rounds.bet_stop_at AS value
        UNION ALL SELECT game_rounds.scheduled_start_at
        UNION ALL SELECT (SELECT r.scheduled_start_at
                          FROM game_legs gl JOIN races r ON r.id=gl.race_id
                          WHERE gl.game_round_id=game_rounds.id AND r.scheduled_start_at IS NOT NULL
                          ORDER BY julianday(r.scheduled_start_at) ASC
                          LIMIT 1)
      ) WHERE value IS NOT NULL ORDER BY julianday(value) ASC LIMIT 1) AS pre_race_cutoff
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

  const invalidWinnerLegs=await scalar(env,`
    SELECT COUNT(*) n FROM (
      SELECT gl.leg_number
      FROM game_legs gl
      WHERE gl.game_round_id=?
        AND (SELECT COUNT(*)
             FROM race_entries re
             JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1
             WHERE re.race_id=gl.race_id)>1
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
          AND ara.data_snapshot_at IS NOT NULL
          AND julianday(ara.data_snapshot_at)<=julianday(?)
          AND julianday(ara.data_snapshot_at)<=julianday(?)
          AND julianday(ara.created_at)<=julianday(?)
      )
  `,[id,system.model_version_id,system.created_at,round.pre_race_cutoff,system.created_at]) : 0;

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
          AND ara.data_snapshot_at IS NOT NULL
          AND julianday(ara.data_snapshot_at)<=julianday(?)
          AND julianday(ara.data_snapshot_at)<=julianday(?)
          AND julianday(ara.created_at)<=julianday(?)
      )
  `,[id,system.model_version_id,system.created_at,round.pre_race_cutoff,system.created_at]) : 0;

  const spikeIntegrity=await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN is_spike=1 THEN 1 ELSE 0 END) AS spike_count,
      COUNT(DISTINCT CASE WHEN is_spike=1 THEN leg_number END) AS spike_legs,
      SUM(CASE WHEN leg_selection_count=1 AND spike_selection_count=1 THEN 1 ELSE 0 END) AS singleton_spike_legs
    FROM (
      SELECT ss.*,
        COUNT(*) OVER (PARTITION BY ss.system_id,ss.leg_number) AS leg_selection_count,
        SUM(CASE WHEN ss.is_spike=1 THEN 1 ELSE 0 END) OVER (PARTITION BY ss.system_id,ss.leg_number) AS spike_selection_count
      FROM system_selections ss
      WHERE ss.system_id=?
    )
  `).bind(system.id).first();
  const spikeCount=Number(spikeIntegrity?.spike_count || 0);
  const spikeLegs=Number(spikeIntegrity?.spike_legs || 0);
  const singletonSpikeLegs=Number(spikeIntegrity?.singleton_spike_legs || 0);
  const spikesValid=spikeCount===3 && spikeLegs===3 && singletonSpikeLegs===3;

  const resultStatus=invalidWinnerLegs>0 ? 'unavailable' : winnerLegs===8 ? 'complete' : 'pending';
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
      invalidWinnerLegs,
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
      spikes:spikesValid ? 'complete' : 'unavailable'
    },
    finalGameSourceRecordId:finalResult?.source_record_id || null,
    highestPayoutLevel:finalResult?.highest_payout_level == null ? null : Number(finalResult.highest_payout_level),
    highestPayoutSek:finalResult?.highest_payout_sek == null ? null : Number(finalResult.highest_payout_sek),
    integrityErrors:[
      ...(invalidWinnerLegs>0 ? ['results_multiple_winners'] : []),
      ...(!spikesValid ? ['registered_system_spike_integrity'] : [])
    ]
  };
}

function overallStatus(audit, overrides = {}) {
  const status={...audit.status,...overrides};
  if (Object.values(status).includes('manual_review')) return 'manual_review';
  if (Object.values(status).includes('pending')) return 'pending';
  return Object.values(status).every((value)=>value==='complete')
    ? 'complete'
    : 'complete_with_gaps';
}

async function auditFingerprints(audit) {
  const form=await sha256({
    roundId:audit.roundId,
    primarySystemId:audit.primarySystemId,
    activeEntries:audit.counts.activeEntries,
    formSnapshots:audit.counts.formSnapshots,
    lineage:audit.lineage ? {
      source:audit.lineage.source,
      audited:audit.lineage.audited,
      packId:audit.lineage.packId,
      factsFingerprint:audit.lineage.factsFingerprint,
      asOf:audit.lineage.asOf,
      generatedAt:audit.lineage.generatedAt
    } : null,
    formLineage:audit.formLineage ? {
      kind:audit.formLineage.kind,
      snapshotRef:audit.formLineage.snapshotRef,
      asOfByLeg:audit.formLineage.asOfByLeg ? Object.fromEntries(audit.formLineage.asOfByLeg) : null
    } : null
  });
  const finalMarket=await sha256({
    roundId:audit.roundId,
    sourceRecordId:audit.finalGameSourceRecordId,
    activeEntries:audit.counts.activeEntries,
    closingMarket:audit.counts.closingMarket
  });
  const input=await sha256({
    roundId:audit.roundId,
    primarySystemId:audit.primarySystemId,
    modelVersionId:audit.modelVersionId,
    finalGameSourceRecordId:audit.finalGameSourceRecordId,
    counts:audit.counts,
    status:audit.status,
    form,
    finalMarket
  });
  return { input, form, finalMarket };
}

async function backfillState(env, roundId) {
  return env.DB.prepare(`
    SELECT *
    FROM statistics_data_backfill_rounds
    WHERE game_round_id=?
    LIMIT 1
  `).bind(roundId).first();
}

function actionStateFor(overall, metrics, { hasRetryable = false } = {}) {
  if (Object.values(metrics).includes('pending')) return hasRetryable ? 'retryable' : 'waiting';
  if (overall==='manual_review') return 'manual_review';
  if (overall==='complete') return 'complete';
  return 'complete_with_gaps';
}

async function persistAudit(env, audit, {
  formStatus = null,
  finalMarketStatus = null,
  lastError = null,
  attempted = false,
  checkedAt = new Date().toISOString(),
  inputFingerprint = null,
  formInputFingerprint = null,
  formAttemptFingerprint = null,
  formTerminalReason = null,
  formRetryCount = 0,
  formNextRetryAt = null,
  formErrorClass = null,
  finalMarketInputFingerprint = null,
  finalMarketAttemptFingerprint = null,
  finalMarketTerminalReason = null,
  finalMarketRetryCount = 0,
  finalMarketNextRetryAt = null,
  finalMarketErrorClass = null,
  actionState = null,
  nextRetryAt = null,
  errorClass = null,
  auditedRevision = null,
  leaseToken = null
} = {}) {
  const normalizedForm=formStatus || audit.status.form;
  const normalizedFinalMarket=finalMarketStatus || audit.status.finalMarket;
  const metrics={...audit.status,form:normalizedForm,finalMarket:normalizedFinalMarket};
  const overall=overallStatus(audit,{form:normalizedForm,finalMarket:normalizedFinalMarket});
  const normalizedAction=actionState || actionStateFor(overall,metrics);
  const completedAt=['waiting','retryable'].includes(normalizedAction) ? null : checkedAt;
  const revision=auditedRevision == null
    ? Number((await backfillState(env,audit.roundId))?.input_revision || 0)
    : Number(auditedRevision);
  await env.DB.prepare(`
    INSERT INTO statistics_data_backfill_rounds
      (game_round_id,status,result_status,final_market_status,payout_status,form_status,
       kai_rank_status,abcd_status,spike_status,active_entry_count,closing_market_count,
       form_snapshot_count,kai_rank_count,abcd_count,spike_count,form_lineage_kind,form_snapshot_ref,
       form_as_of_json,step1_pack_id,step1_facts_fingerprint,step1_as_of,attempt_count,last_error,last_checked_at,completed_at,
       action_state,audited_revision,input_fingerprint,last_audit_at,last_attempt_at,next_retry_at,error_class,
       form_input_fingerprint,form_attempt_fingerprint,form_terminal_reason,form_retry_count,form_next_retry_at,form_error_class,
       final_market_input_fingerprint,final_market_attempt_fingerprint,final_market_terminal_reason,final_market_retry_count,
       final_market_next_retry_at,final_market_error_class,lease_token,lease_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)
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
      action_state=excluded.action_state,
      audited_revision=excluded.audited_revision,
      input_fingerprint=excluded.input_fingerprint,
      last_audit_at=excluded.last_audit_at,
      last_attempt_at=CASE WHEN ? THEN excluded.last_attempt_at ELSE statistics_data_backfill_rounds.last_attempt_at END,
      next_retry_at=excluded.next_retry_at,
      error_class=excluded.error_class,
      form_input_fingerprint=excluded.form_input_fingerprint,
      form_attempt_fingerprint=excluded.form_attempt_fingerprint,
      form_terminal_reason=excluded.form_terminal_reason,
      form_retry_count=excluded.form_retry_count,
      form_next_retry_at=excluded.form_next_retry_at,
      form_error_class=excluded.form_error_class,
      final_market_input_fingerprint=excluded.final_market_input_fingerprint,
      final_market_attempt_fingerprint=excluded.final_market_attempt_fingerprint,
      final_market_terminal_reason=excluded.final_market_terminal_reason,
      final_market_retry_count=excluded.final_market_retry_count,
      final_market_next_retry_at=excluded.final_market_next_retry_at,
      final_market_error_class=excluded.final_market_error_class,
      lease_token=NULL,
      lease_until=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE statistics_data_backfill_rounds.lease_token=?
  `).bind(
    audit.roundId,overall,audit.status.results,normalizedFinalMarket,audit.status.payout,normalizedForm,
    audit.status.kaiRank,audit.status.abcd,audit.status.spikes,
    audit.counts.activeEntries,audit.counts.closingMarket,audit.counts.formSnapshots,
    audit.counts.kaiRank,audit.counts.abcd,audit.counts.spikes,
    audit.formLineage?.kind || null,audit.formLineage?.snapshotRef || null,
    audit.formLineage?.asOfByLeg ? JSON.stringify(Object.fromEntries(audit.formLineage.asOfByLeg)) : null,
    audit.lineage?.packId || null,audit.lineage?.factsFingerprint || null,audit.lineage?.asOf || null,
    attempted ? 1 : 0,lastError,checkedAt,completedAt,
    normalizedAction,revision,inputFingerprint,checkedAt,attempted ? checkedAt : null,nextRetryAt,errorClass,
    formInputFingerprint,formAttemptFingerprint,formTerminalReason,Number(formRetryCount || 0),formNextRetryAt,formErrorClass,
    finalMarketInputFingerprint,finalMarketAttemptFingerprint,finalMarketTerminalReason,Number(finalMarketRetryCount || 0),
    finalMarketNextRetryAt,finalMarketErrorClass,
    attempted ? 1 : 0,
    attempted ? 1 : 0,
    leaseToken
  ).run();
  const owner=await backfillState(env,audit.roundId);
  if(owner?.lease_token && owner.lease_token!==leaseToken) throw new Error('statistics backfill lease ownership was lost before persist');
  return { overall, actionState:normalizedAction, revision };
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

async function nextQueuedRound(env, now) {
  return env.DB.prepare(`
    SELECT game_round_id
    FROM statistics_data_backfill_rounds
    WHERE (lease_until IS NULL OR datetime(lease_until)<=datetime(?))
      AND (
        audited_revision<input_revision
        OR (
          action_state='retryable'
          AND next_retry_at IS NOT NULL
          AND datetime(next_retry_at)<=datetime(?)
        )
      )
    ORDER BY
      CASE WHEN audited_revision<input_revision THEN 0 ELSE 1 END,
      datetime(COALESCE(next_retry_at,last_audit_at,last_checked_at)) ASC,
      game_round_id ASC
    LIMIT 1
  `).bind(now,now).first();
}

async function claimRound(env, roundId, now) {
  const token=`statistics_${crypto.randomUUID()}`;
  const leaseUntil=futureIso(now,5*60*1000);
  const result=await env.DB.prepare(`
    UPDATE statistics_data_backfill_rounds
    SET lease_token=?,lease_until=?
    WHERE game_round_id=?
      AND (lease_until IS NULL OR datetime(lease_until)<=datetime(?))
  `).bind(token,leaseUntil,roundId,now).run();
  return Number(result.meta?.changes || 0)===1 ? token : null;
}

async function releaseRound(env, roundId, token) {
  if (!token) return;
  await env.DB.prepare(`
    UPDATE statistics_data_backfill_rounds
    SET lease_token=NULL,lease_until=NULL
    WHERE game_round_id=? AND lease_token=?
  `).bind(roundId,token).run();
}

function closingMarketRepairFailureStatus(error) {
  const message=String(error?.message || error || '');
  if (/closing_market_manual_review:/i.test(message)) {
    return 'manual_review';
  }
  return 'pending';
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
  const now=nowIso(options.now ?? Date.now());
  await ensureStatisticsDataBackfillQueue(env,now);
  const requested=options.roundId == null ? null : String(options.roundId).trim();
  const target=requested
    ? await env.DB.prepare('SELECT game_round_id FROM statistics_data_backfill_rounds WHERE game_round_id=? LIMIT 1').bind(requested).first()
    : await nextQueuedRound(env,now);
  if (requested && !target) throw new Error('round is not eligible for historical statistics backfill');
  if (!target) return { version:STATISTICS_DATA_BACKFILL_VERSION, status:'idle' };

  const leaseToken=await claimRound(env,target.game_round_id,now);
  if(!leaseToken) return { version:STATISTICS_DATA_BACKFILL_VERSION, status:'idle', reason:'leased' };

  try {
    const prior=await backfillState(env,target.game_round_id);
    let audit=await auditStatisticsRound(env,target.game_round_id);
    let fingerprints=await auditFingerprints(audit);
    let attempted=false;
    let formStatus=audit.status.form;
    let finalMarketStatus=audit.status.finalMarket;
    let formAttemptFingerprint=prior?.form_attempt_fingerprint || null;
    let formTerminalReason=prior?.form_terminal_reason || null;
    let formRetryCount=Number(prior?.form_retry_count || 0);
    let formNextRetryAt=prior?.form_next_retry_at || null;
    let formErrorClass=prior?.form_error_class || null;
    let finalMarketAttemptFingerprint=prior?.final_market_attempt_fingerprint || null;
    let finalMarketTerminalReason=prior?.final_market_terminal_reason || null;
    let finalMarketRetryCount=Number(prior?.final_market_retry_count || 0);
    let finalMarketNextRetryAt=prior?.final_market_next_retry_at || null;
    let finalMarketErrorClass=prior?.final_market_error_class || null;
    const errors=[];

    const formTerminalSameInput=
      ['manual_review','unavailable'].includes(prior?.form_status)
      && prior?.form_attempt_fingerprint
      && prior.form_attempt_fingerprint===fingerprints.form;
    if(formTerminalSameInput){
      formStatus=prior.form_status;
      formTerminalReason=prior.form_terminal_reason || prior.last_error || 'terminal_form_state';
    } else if(prior?.form_attempt_fingerprint && prior.form_attempt_fingerprint!==fingerprints.form){
      formAttemptFingerprint=null;
      formTerminalReason=null;
      formRetryCount=0;
      formNextRetryAt=null;
      formErrorClass=null;
    }

    const marketTerminalSameInput=
      ['manual_review','unavailable'].includes(prior?.final_market_status)
      && prior?.final_market_attempt_fingerprint
      && prior.final_market_attempt_fingerprint===fingerprints.finalMarket;
    if(marketTerminalSameInput){
      finalMarketStatus=prior.final_market_status;
      finalMarketTerminalReason=prior.final_market_terminal_reason || prior.last_error || 'terminal_final_market_state';
    } else if(prior?.final_market_attempt_fingerprint && prior.final_market_attempt_fingerprint!==fingerprints.finalMarket){
      finalMarketAttemptFingerprint=null;
      finalMarketTerminalReason=null;
      finalMarketRetryCount=0;
      finalMarketNextRetryAt=null;
      finalMarketErrorClass=null;
    }

    if (audit.finalGameSourceRecordId && audit.status.finalMarket!=='complete' && !marketTerminalSameInput
        && retryDue(finalMarketNextRetryAt,now)) {
      attempted=true;
      finalMarketAttemptFingerprint=fingerprints.finalMarket;
      try {
        const repair=await repairCapturedOfficialClosingMarket(env,audit.finalGameSourceRecordId);
        audit=await auditStatisticsRound(env,target.game_round_id);
        fingerprints=await auditFingerprints(audit);
        finalMarketStatus=audit.status.finalMarket;
        finalMarketRetryCount=0;
        finalMarketNextRetryAt=null;
        finalMarketErrorClass=null;
        finalMarketTerminalReason=null;
        if (finalMarketStatus!=='complete') {
          finalMarketStatus='unavailable';
          finalMarketTerminalReason=repair?.complete===false ? 'closing_market_incomplete_archive' : 'closing_market_unavailable';
          finalMarketErrorClass='deterministic_gap';
        }
      } catch (error) {
        const failure=closingMarketRepairFailureStatus(error);
        const message=String(error?.message || error);
        errors.push('closing_market_repair: '+message);
        if(failure==='manual_review'){
          finalMarketStatus='manual_review';
          finalMarketTerminalReason=message.replace(/^closing_market_manual_review:\s*/i,'').slice(0,500);
          finalMarketErrorClass='deterministic_gap';
          finalMarketNextRetryAt=null;
        } else {
          const sameFingerprint=prior?.final_market_attempt_fingerprint===finalMarketAttemptFingerprint;
          finalMarketRetryCount=(sameFingerprint ? Number(prior?.final_market_retry_count || 0) : 0)+1;
          if(finalMarketRetryCount>=8){
            finalMarketStatus='manual_review';
            finalMarketTerminalReason='closing_market_repeated_failure';
            finalMarketErrorClass='repeated_failure';
            finalMarketNextRetryAt=null;
          } else {
            finalMarketStatus='pending';
            finalMarketErrorClass='transient_error';
            finalMarketNextRetryAt=futureIso(now,retryDelayMs(finalMarketRetryCount));
          }
        }
      }
    }

    if (audit.status.form==='pending' && !formTerminalSameInput && retryDue(formNextRetryAt,now)) {
      attempted=true;
      formAttemptFingerprint=fingerprints.form;
      try {
        const replay=await replayFormSnapshot(env,audit);
        formStatus=replay.status;
        formRetryCount=0;
        formNextRetryAt=null;
        formErrorClass=null;
        formTerminalReason=replay.status==='complete' ? null : replay.reason;
        if (replay.status==='manual_review') {
          formErrorClass='deterministic_mismatch';
          errors.push('form_replay: '+replay.reason);
        } else if(replay.status==='unavailable') {
          formErrorClass='deterministic_gap';
        } else if (replay.status==='complete') {
          audit=await auditStatisticsRound(env,target.game_round_id);
          fingerprints=await auditFingerprints(audit);
          formStatus=audit.status.form;
        }
      } catch (error) {
        const message=String(error?.message || error);
        errors.push('form_replay: '+message);
        const sameFingerprint=prior?.form_attempt_fingerprint===formAttemptFingerprint;
        formRetryCount=(sameFingerprint ? Number(prior?.form_retry_count || 0) : 0)+1;
        if(deterministicFormFailure(error) || formRetryCount>=8){
          formStatus='manual_review';
          formTerminalReason=deterministicFormFailure(error) ? 'form_replay_deterministic_failure' : 'form_replay_repeated_failure';
          formErrorClass=deterministicFormFailure(error) ? 'deterministic_failure' : 'repeated_failure';
          formNextRetryAt=null;
        } else {
          formStatus='pending';
          formErrorClass='transient_error';
          formNextRetryAt=futureIso(now,retryDelayMs(formRetryCount));
        }
      }
    }

    const metrics={...audit.status,finalMarket:finalMarketStatus,form:formStatus};
    const overall=overallStatus(audit,{form:formStatus,finalMarket:finalMarketStatus});
    const hasRetryable=
      (formStatus==='pending' && formErrorClass==='transient_error')
      || (finalMarketStatus==='pending' && finalMarketErrorClass==='transient_error');
    const integrityErrors=audit.integrityErrors || [];
    const actionState=integrityErrors.length
      ? 'manual_review'
      : actionStateFor(overall,metrics,{hasRetryable});
    let nextRetryAt=null;
    if(actionState==='retryable'){
      const retryTimes=[formNextRetryAt,finalMarketNextRetryAt].filter(Boolean).sort();
      nextRetryAt=retryTimes[0] || futureIso(now,5*60*1000);
    }

    const combinedErrors=[
      ...errors,
      ...integrityErrors.map((value)=>'data_integrity: '+value)
    ];
    const lastError=combinedErrors.length ? combinedErrors.join(' | ').slice(0,1000) : null;
    const errorClass=integrityErrors[0] || formErrorClass || finalMarketErrorClass || null;
    const stateBeforePersist=await backfillState(env,target.game_round_id);
    const persisted=await persistAudit(env,audit,{
      formStatus,
      finalMarketStatus,
      lastError,
      attempted,
      checkedAt:now,
      inputFingerprint:fingerprints.input,
      formInputFingerprint:fingerprints.form,
      formAttemptFingerprint,
      formTerminalReason,
      formRetryCount,
      formNextRetryAt,
      formErrorClass,
      finalMarketInputFingerprint:fingerprints.finalMarket,
      finalMarketAttemptFingerprint,
      finalMarketTerminalReason,
      finalMarketRetryCount,
      finalMarketNextRetryAt,
      finalMarketErrorClass,
      actionState,
      nextRetryAt,
      errorClass,
      auditedRevision:Number(stateBeforePersist?.input_revision || 0),
      leaseToken
    });
    return {
      version:STATISTICS_DATA_BACKFILL_VERSION,
      status:persisted.overall,
      actionState:persisted.actionState,
      roundId:audit.roundId,
      metrics,
      counts:audit.counts,
      step1PackId:audit.lineage?.packId || null,
      formLineageKind:audit.formLineage?.kind || null,
      formSnapshotRef:audit.formLineage?.snapshotRef || null,
      reason:lastError,
      nextRetryAt
    };
  } catch(error) {
    await releaseRound(env,target.game_round_id,leaseToken);
    throw error;
  }
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
  const {results:actions}=await env.DB.prepare(`
    SELECT action_state,COUNT(*) n
    FROM statistics_data_backfill_rounds
    GROUP BY action_state
    ORDER BY action_state
  `).all();
  const actionTotals=Object.fromEntries((actions || []).map((row)=>[row.action_state,Number(row.n || 0)]));
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
    SELECT game_round_id,status,action_state,result_status,final_market_status,payout_status,form_status,
           kai_rank_status,abcd_status,spike_status,error_class,next_retry_at,last_error,last_checked_at
    FROM statistics_data_backfill_rounds
    WHERE action_state IN ('waiting','retryable','manual_review','complete_with_gaps')
    ORDER BY
      CASE action_state
        WHEN 'retryable' THEN 0
        WHEN 'waiting' THEN 1
        WHEN 'manual_review' THEN 2
        ELSE 3
      END,
      game_round_id DESC
    LIMIT 50
  `).all();
  return {
    version:STATISTICS_DATA_BACKFILL_VERSION,
    totals,
    actionTotals,
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
