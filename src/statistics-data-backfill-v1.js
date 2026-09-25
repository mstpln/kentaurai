import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { persistAnalysisFormSnapshots, persistHistoricalFormSnapshots } from './analysis-form-snapshot-v1.js';
import { stableId } from './ids.js';
import { HORSE_FORM_INDEX_VERSION } from './statistics/horse-form-index.js';
import { repairCapturedOfficialClosingMarket } from './import/official-live.js';

export const STATISTICS_DATA_BACKFILL_VERSION = 'statistics-data-backfill-v2';
export const STATISTICS_WAIT_RECHECK_MS = 15 * 60_000;
export const STATISTICS_TERMINAL_REAUDIT_MS = 24 * 60 * 60_000;
export const STATISTICS_RETRY_BASE_MS = 5 * 60_000;
export const STATISTICS_RETRY_CAP_MS = 6 * 60 * 60_000;
export const STATISTICS_MAX_FORM_RETRIES = 4;
export const STATISTICS_MAX_AUDIT_RETRIES = 4;
const STATISTICS_LEASE_MS = 4 * 60_000;

function addMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function retryDelayMs(retryCount) {
  const exponent=Math.max(0,Number(retryCount || 1)-1);
  return Math.min(STATISTICS_RETRY_CAP_MS,STATISTICS_RETRY_BASE_MS * (2 ** exponent));
}

function lifecycleFingerprint(prefix, ...parts) {
  return stableId(prefix,...parts.map((part)=>part == null ? 'none' : String(part)));
}

function isoAtOrBefore(value, boundary) {
  const valueMs=Date.parse(String(value || ''));
  const boundaryMs=Date.parse(String(boundary || ''));
  return Number.isFinite(valueMs) && Number.isFinite(boundaryMs) && valueMs<=boundaryMs;
}

function formInputFingerprint(audit) {
  return lifecycleFingerprint(
    'statistics-form-input-v2',
    audit.primarySystemId,
    audit.primarySystemCreatedAt,
    audit.modelVersionId,
    audit.preRaceCutoff,
    audit.formLineage?.kind,
    audit.formLineage?.snapshotRef,
    audit.lineage?.packId,
    audit.lineage?.factsFingerprint,
    audit.lineage?.asOf,
    audit.formLineage?.asOfByLeg ? JSON.stringify(Object.fromEntries(audit.formLineage.asOfByLeg)) : null,
    audit.counts.activeEntries
  );
}

function finalMarketInputFingerprint(audit) {
  return lifecycleFingerprint('statistics-final-market-input-v2',audit.finalGameSourceRecordId,audit.counts.activeEntries,audit.entryIdentityVersion);
}

function roundInputFingerprint(audit) {
  return lifecycleFingerprint(
    'statistics-round-input-v2',
    audit.primarySystemId,audit.modelVersionId,audit.counts.activeEntries,
    audit.counts.winnerLegs,audit.counts.ambiguousWinnerLegs,audit.finalGameSourceRecordId,
    audit.counts.closingMarket,audit.highestPayoutLevel,audit.highestPayoutSek,
    audit.counts.formSnapshots,audit.counts.kaiRank,audit.counts.abcd,audit.counts.spikes,
    audit.counts.spikeLegs,audit.counts.singletonSpikeLegs,audit.counts.selectionLegs,
    audit.counts.invalidSelections,formInputFingerprint(audit),finalMarketInputFingerprint(audit)
  );
}

function nowIso(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('statistics backfill time is invalid');
  return date.toISOString();
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

  const legCount=await scalar(env,'SELECT COUNT(*) n FROM game_legs WHERE game_round_id=?',[id]);
  if (legCount!==8) throw new Error('round does not have exactly eight legs');

  const system=await primarySystem(env,id);
  if (!system) throw new Error('round has no registered system');
  const lineage=await step1Lineage(env,id,system);
  let formLineage=null;
  if(
    lineage?.audited &&
    lineage.packId &&
    lineage.asOf &&
    lineage.generatedAt &&
    isoAtOrBefore(lineage.asOf,round.pre_race_cutoff) &&
    isoAtOrBefore(lineage.generatedAt,round.pre_race_cutoff) &&
    isoAtOrBefore(lineage.generatedAt,system.created_at)
  ){
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

  const entryIdentityVersionRow=await env.DB.prepare(`
    SELECT MAX(re.updated_at) value
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    WHERE gl.game_round_id=?
  `).bind(id).first();
  const entryIdentityVersion=entryIdentityVersionRow?.value || null;

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

  const ambiguousWinnerLegs=await scalar(env,`
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

  const spikeCount=await scalar(env,`
    SELECT COUNT(*) n
    FROM system_selections
    WHERE system_id=? AND is_spike=1
  `,[system.id]);

  const spikeLegs=await scalar(env,`
    SELECT COUNT(DISTINCT leg_number) n
    FROM system_selections
    WHERE system_id=? AND is_spike=1
  `,[system.id]);

  const singletonSpikeLegs=await scalar(env,`
    SELECT COUNT(*) n FROM (
      SELECT leg_number
      FROM system_selections
      WHERE system_id=?
      GROUP BY leg_number
      HAVING COUNT(*)=1 AND SUM(CASE WHEN is_spike=1 THEN 1 ELSE 0 END)=1
    )
  `,[system.id]);

  const selectionLegs=await scalar(env,`
    SELECT COUNT(DISTINCT leg_number) n
    FROM system_selections
    WHERE system_id=?
  `,[system.id]);

  const invalidSelections=await scalar(env,`
    SELECT COUNT(*) n
    FROM system_selections ss
    LEFT JOIN game_legs gl
      ON gl.game_round_id=? AND gl.leg_number=ss.leg_number
    LEFT JOIN race_entries re
      ON re.id=ss.race_entry_id AND re.race_id=gl.race_id
    WHERE ss.system_id=? AND re.id IS NULL
  `,[id,system.id]);

  const integrityReasons=[];
  if (ambiguousWinnerLegs>0) integrityReasons.push('ambiguous_factual_winners');
  if (selectionLegs!==8 || spikeCount!==3 || spikeLegs!==3 || singletonSpikeLegs!==3 || invalidSelections>0) {
    integrityReasons.push('malformed_registered_system');
  }

  const resultStatus=ambiguousWinnerLegs>0 ? 'unavailable' : winnerLegs===8 ? 'complete' : 'pending';
  let finalMarketStatus='pending';
  if (finalResult && activeEntries===0) finalMarketStatus='unavailable';
  else if (finalResult && activeEntries>0 && closingMarketCount>=activeEntries) finalMarketStatus='complete';

  const payoutStatus=finalResult
    ? (finalResult.payouts_json && finalResult.highest_payout_sek != null ? 'complete' : 'unavailable')
    : 'pending';

  const formStatus=formSnapshotCount>=activeEntries && activeEntries>0
    ? 'complete'
    : formLineage?.audited
      ? 'pending'
      : 'unavailable';

  const audit={
    version:STATISTICS_DATA_BACKFILL_VERSION,
    roundId:id,
    gameType:round.game_type,
    roundDate:round.round_date,
    preRaceCutoff:round.pre_race_cutoff || null,
    primarySystemId:system.id,
    primarySystemCreatedAt:system.created_at || null,
    modelVersionId:system.model_version_id || null,
    lineage,
    formLineage,
    counts:{
      activeEntries,
      winnerLegs,
      ambiguousWinnerLegs,
      closingMarket:closingMarketCount,
      formSnapshots:formSnapshotCount,
      kaiRank:kaiRankCount,
      abcd:abcdCount,
      spikes:spikeCount,
      spikeLegs,
      singletonSpikeLegs,
      selectionLegs,
      invalidSelections
    },
    status:{
      results:resultStatus,
      finalMarket:finalMarketStatus,
      payout:payoutStatus,
      form:formStatus,
      kaiRank:kaiRankCount>=activeEntries && activeEntries>0 ? 'complete' : 'unavailable',
      abcd:abcdCount>=activeEntries && activeEntries>0 ? 'complete' : 'unavailable',
      spikes:integrityReasons.includes('malformed_registered_system') ? 'unavailable' : 'complete'
    },
    integrityReasons,
    entryIdentityVersion,
    finalGameSourceRecordId:finalResult?.source_record_id || null,
    highestPayoutLevel:finalResult?.highest_payout_level == null ? null : Number(finalResult.highest_payout_level),
    highestPayoutSek:finalResult?.highest_payout_sek == null ? null : Number(finalResult.highest_payout_sek)
  };
  audit.fingerprints={
    form:formInputFingerprint(audit),
    finalMarket:finalMarketInputFingerprint(audit)
  };
  audit.fingerprints.round=roundInputFingerprint(audit);
  return audit;
}

function overallStatus(audit, overrides = {}) {
  const status={...audit.status,...overrides};
  if (audit.integrityReasons?.length || Object.values(status).includes('manual_review')) return 'manual_review';
  if (Object.values(status).includes('pending')) return 'pending';
  return Object.values(status).every((value)=>value==='complete') ? 'complete' : 'complete_with_gaps';
}

function classifyFormReplayError(error) {
  const message=String(error?.message || error || '').toLowerCase();
  if (message.includes('no active horse entries')) return { terminal:true,errorClass:'form_replay_no_active_entries' };
  if (message.includes('step1_replay_fingerprint_mismatch')) return { terminal:true,errorClass:'step1_replay_fingerprint_mismatch' };
  if (message.includes('does not have exactly eight legs')) return { terminal:true,errorClass:'form_replay_invalid_round_shape' };
  if (/temporar|timeout|timed out|busy|locked|network|storage|d1_error|internal error/.test(message)) {
    return { terminal:false,errorClass:'form_replay_transient' };
  }
  return { terminal:false,errorClass:'form_replay_other' };
}

function classifyClosingMarketError(error) {
  const message=String(error?.message || error || '');
  if (/closing_market_manual_review:/i.test(message)) return { terminal:true,errorClass:'closing_market_manual_review' };
  return { terminal:false,errorClass:'closing_market_repair_retryable' };
}

function classifyAuditError(error) {
  const message=String(error?.message || error || '').toLowerCase();
  if (/not found|no registered system|does not have exactly eight legs|not eligible/.test(message)) {
    return { terminal:true,errorClass:'audit_ineligible_or_invalid' };
  }
  return { terminal:false,errorClass:'audit_retryable_error' };
}

function closingMarketRepairFailureStatus(error) {
  return classifyClosingMarketError(error).terminal ? 'manual_review' : 'pending';
}

async function replayFormSnapshot(env, audit) {
  const formLineage=audit.formLineage;
  if (!formLineage?.audited || !formLineage.snapshotRef) return { status:'unavailable',reason:'verified_form_lineage_missing' };
  if(formLineage.kind==='step1_pack'){
    const lineage=audit.lineage;
    if(!lineage?.packId || !lineage.factsFingerprint || !lineage.asOf) {
      return { status:'unavailable',reason:'verified_step1_lineage_missing' };
    }
    const pack=await createPreMarketAnalysisPackV3(env,audit.roundId,{asOf:lineage.asOf});
    if (pack.packId!==lineage.packId || pack.factsFingerprint!==lineage.factsFingerprint || pack.manifest?.as_of!==lineage.asOf) {
      return { status:'manual_review',reason:'step1_replay_fingerprint_mismatch' };
    }
    return { status:'complete',persisted:await persistAnalysisFormSnapshots(env,pack) };
  }
  if(formLineage.kind==='legacy_analysis_snapshot'){
    return {
      status:'complete',
      persisted:await persistHistoricalFormSnapshots(env,{
        roundId:audit.roundId,snapshotRef:formLineage.snapshotRef,asOfByLeg:formLineage.asOfByLeg
      })
    };
  }
  return { status:'unavailable',reason:'unsupported_form_lineage' };
}

async function loadState(env, roundId) {
  return env.DB.prepare('SELECT * FROM statistics_data_backfill_rounds WHERE game_round_id=? LIMIT 1').bind(roundId).first();
}

export async function ensureStatisticsDataBackfillQueue(env, value = Date.now()) {
  if (!env?.DB) throw new Error('DB is not configured');
  const at=nowIso(value);
  const result=await env.DB.prepare(`
    INSERT OR IGNORE INTO statistics_data_backfill_rounds
      (game_round_id,status,result_status,final_market_status,payout_status,form_status,
       kai_rank_status,abcd_status,spike_status,last_checked_at,work_state,next_check_at)
    SELECT gr.id,'pending','pending','pending','pending','pending',
           'unavailable','unavailable','unavailable',?,'waiting',?
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND EXISTS (SELECT 1 FROM systems s WHERE s.game_round_id=gr.id)
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8
      AND datetime(COALESCE(gr.bet_stop_at,gr.scheduled_start_at,gr.round_date || 'T23:59:59Z')) < datetime(?)
  `).bind(at,at,at).run();
  return { version:STATISTICS_DATA_BACKFILL_VERSION,created:Number(result.meta?.changes || 0) };
}

async function nextQueuedRound(env, at) {
  return env.DB.prepare(`
    SELECT game_round_id
    FROM statistics_data_backfill_rounds
    WHERE next_check_at IS NOT NULL
      AND datetime(next_check_at)<=datetime(?)
      AND (lease_until IS NULL OR datetime(lease_until)<datetime(?))
    ORDER BY CASE work_state
      WHEN 'retryable' THEN 0
      WHEN 'waiting' THEN 1
      ELSE 2
    END,
    datetime(next_check_at) ASC,datetime(last_checked_at) ASC,game_round_id ASC
    LIMIT 1
  `).bind(at,at).first();
}

async function acquireLease(env, roundId, at) {
  const token=crypto.randomUUID();
  const result=await env.DB.prepare(`
    UPDATE statistics_data_backfill_rounds
    SET lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE game_round_id=? AND (lease_until IS NULL OR datetime(lease_until)<datetime(?))
  `).bind(token,addMs(at,STATISTICS_LEASE_MS),roundId,at).run();
  return Number(result.meta?.changes || 0)===1 ? token : null;
}

function legacyFormTerminal(state, audit) {
  if (!state || state.form_input_fingerprint) return null;
  const errorText=[state.last_error,state.last_error_class,state.form_error_class].filter(Boolean).join(' ').toLowerCase();
  if (state.form_status==='manual_review') {
    if (errorText.includes('step1_replay_fingerprint_mismatch')) {
      return {status:'manual_review',reason:'step1_replay_fingerprint_mismatch',errorClass:'step1_replay_fingerprint_mismatch'};
    }
    if (errorText.includes('form_replay')) {
      const classified=classifyFormReplayError(errorText);
      return {status:'manual_review',reason:classified.errorClass,errorClass:classified.errorClass};
    }
    return {status:'manual_review',reason:'legacy_form_manual_review',errorClass:'legacy_form_manual_review'};
  }
  if (state.form_status==='pending' && errorText.includes('form_replay')) {
    const classified=classifyFormReplayError(errorText);
    if (classified.terminal || Number(state.form_retry_count || 0)>=STATISTICS_MAX_FORM_RETRIES) {
      return {
        status:'manual_review',
        reason:classified.terminal ? classified.errorClass : 'form_replay_retry_exhausted',
        errorClass:classified.terminal ? classified.errorClass : 'form_replay_retry_exhausted'
      };
    }
  }
  if (audit.status.form==='unavailable') return {status:'unavailable',reason:'verified_form_lineage_missing',errorClass:null};
  return null;
}

function controlForForm(state, audit, at) {
  const fp=audit.fingerprints.form;
  const sameInput=state?.form_input_fingerprint===fp;
  let control={
    inputFingerprint:fp,
    effectiveStatus:audit.status.form,
    retryCount:sameInput ? Number(state?.form_retry_count || 0) : 0,
    nextRetryAt:sameInput ? state?.form_next_retry_at || null : null,
    terminalFingerprint:sameInput ? state?.form_terminal_fingerprint || null : null,
    terminalReason:sameInput ? state?.form_terminal_reason || null : null,
    errorClass:sameInput ? state?.form_error_class || null : null,
    lastAttemptFingerprint:sameInput ? state?.form_last_attempt_fingerprint || null : null,
    attempted:false
  };
  const legacy=legacyFormTerminal(state,audit);
  if (legacy && audit.status.form==='pending') {
    control={...control,effectiveStatus:legacy.status,terminalFingerprint:fp,terminalReason:legacy.reason,errorClass:legacy.errorClass,nextRetryAt:null};
  }
  if (audit.status.form==='unavailable') {
    control={...control,effectiveStatus:'unavailable',terminalFingerprint:fp,terminalReason:'verified_form_lineage_missing',errorClass:null,retryCount:0,nextRetryAt:null};
  } else if (audit.status.form==='complete') {
    control={...control,effectiveStatus:'complete',terminalFingerprint:null,terminalReason:null,errorClass:null,retryCount:0,nextRetryAt:null};
  } else if (control.terminalFingerprint===fp) {
    control.effectiveStatus=control.terminalReason?.startsWith('verified_') ? 'unavailable' : 'manual_review';
    control.nextRetryAt=null;
  } else if (control.retryCount>=STATISTICS_MAX_FORM_RETRIES && control.errorClass==='form_replay_other') {
    control={...control,effectiveStatus:'manual_review',terminalFingerprint:fp,terminalReason:'form_replay_retry_exhausted',errorClass:'form_replay_retry_exhausted',nextRetryAt:null};
  }
  control.retryBlocked=Boolean(control.nextRetryAt && Date.parse(control.nextRetryAt)>Date.parse(at));
  return control;
}

function controlForFinalMarket(state, audit, at) {
  const fp=audit.fingerprints.finalMarket;
  const sameInput=state?.final_market_input_fingerprint===fp;
  let control={
    inputFingerprint:fp,
    effectiveStatus:audit.status.finalMarket,
    retryCount:sameInput ? Number(state?.final_market_retry_count || 0) : 0,
    nextRetryAt:sameInput ? state?.final_market_next_retry_at || null : null,
    terminalFingerprint:sameInput ? state?.final_market_terminal_fingerprint || null : null,
    terminalReason:sameInput ? state?.final_market_terminal_reason || null : null,
    errorClass:sameInput ? state?.final_market_error_class || null : null,
    lastAttemptFingerprint:sameInput ? state?.final_market_last_attempt_fingerprint || null : null,
    attempted:false
  };
  if (!state?.final_market_input_fingerprint && state?.final_market_status==='manual_review' && audit.status.finalMarket==='pending') {
    control={...control,effectiveStatus:'manual_review',terminalFingerprint:fp,terminalReason:'closing_market_manual_review',errorClass:'closing_market_manual_review'};
  }
  if (audit.status.finalMarket==='complete' || audit.status.finalMarket==='unavailable') {
    control={...control,effectiveStatus:audit.status.finalMarket,terminalFingerprint:null,terminalReason:null,errorClass:null,retryCount:0,nextRetryAt:null};
  } else if (control.terminalFingerprint===fp) {
    control.effectiveStatus='manual_review';
    control.nextRetryAt=null;
  }
  control.retryBlocked=Boolean(control.nextRetryAt && Date.parse(control.nextRetryAt)>Date.parse(at));
  return control;
}

function resolutionFor(audit, form, finalMarket, at) {
  const effective={...audit.status,form:form.effectiveStatus,finalMarket:finalMarket.effectiveStatus};
  const overall=overallStatus(audit,{form:form.effectiveStatus,finalMarket:finalMarket.effectiveStatus});
  const retryTimes=[];
  if (form.effectiveStatus==='pending' && form.errorClass && form.nextRetryAt) retryTimes.push(form.nextRetryAt);
  if (finalMarket.effectiveStatus==='pending' && finalMarket.errorClass && finalMarket.nextRetryAt) retryTimes.push(finalMarket.nextRetryAt);
  let workState;
  if (retryTimes.length) workState='retryable';
  else if (Object.values(effective).includes('pending')) workState='waiting';
  else if (overall==='manual_review') workState='manual_review';
  else if (overall==='complete') workState='complete';
  else workState='complete_with_gaps';
  const nextCheckAt=retryTimes.length
    ? [...retryTimes].sort((a,b)=>Date.parse(a)-Date.parse(b))[0]
    : addMs(at,workState==='waiting' ? STATISTICS_WAIT_RECHECK_MS : STATISTICS_TERMINAL_REAUDIT_MS);
  return {overall,workState,nextCheckAt,effective};
}

function summarizedError(audit, form, finalMarket) {
  if (audit.integrityReasons?.length) return {errorClass:audit.integrityReasons[0],message:audit.integrityReasons.join(' | ')};
  if (form.effectiveStatus==='manual_review' && form.terminalReason) return {errorClass:form.errorClass || form.terminalReason,message:'form_replay: '+form.terminalReason};
  if (finalMarket.effectiveStatus==='manual_review' && finalMarket.terminalReason) return {errorClass:finalMarket.errorClass || finalMarket.terminalReason,message:'closing_market_repair: '+finalMarket.terminalReason};
  if (form.effectiveStatus==='pending' && form.errorClass) return {errorClass:form.errorClass,message:'form_replay: '+form.errorClass};
  if (finalMarket.effectiveStatus==='pending' && finalMarket.errorClass) return {errorClass:finalMarket.errorClass,message:'closing_market_repair: '+finalMarket.errorClass};
  return {errorClass:null,message:null};
}

async function persistAudit(env, token, audit, form, finalMarket, at, attempted) {
  const resolution=resolutionFor(audit,form,finalMarket,at);
  const summary=summarizedError(audit,form,finalMarket);
  const completedAt=['waiting','retryable'].includes(resolution.workState) ? null : at;
  const result=await env.DB.prepare(`
    UPDATE statistics_data_backfill_rounds SET
      status=?,work_state=?,result_status=?,final_market_status=?,payout_status=?,form_status=?,
      kai_rank_status=?,abcd_status=?,spike_status=?,active_entry_count=?,closing_market_count=?,
      form_snapshot_count=?,kai_rank_count=?,abcd_count=?,spike_count=?,form_lineage_kind=?,form_snapshot_ref=?,
      form_as_of_json=?,step1_pack_id=?,step1_facts_fingerprint=?,step1_as_of=?,
      attempt_count=attempt_count+?,last_error=?,last_error_class=?,last_checked_at=?,last_audit_at=?,
      last_attempt_at=CASE WHEN ?=1 THEN ? ELSE last_attempt_at END,completed_at=?,
      input_fingerprint=?,primary_system_id=?,winner_leg_count=?,ambiguous_winner_leg_count=?,final_game_source_record_id=?,
      next_check_at=?,audit_retry_count=0,
      form_input_fingerprint=?,form_last_attempt_fingerprint=?,form_terminal_fingerprint=?,form_terminal_reason=?,
      form_retry_count=?,form_next_retry_at=?,form_error_class=?,
      final_market_input_fingerprint=?,final_market_last_attempt_fingerprint=?,final_market_terminal_fingerprint=?,final_market_terminal_reason=?,
      final_market_retry_count=?,final_market_next_retry_at=?,final_market_error_class=?,
      lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE game_round_id=? AND lease_token=?
  `).bind(
    resolution.overall,resolution.workState,audit.status.results,finalMarket.effectiveStatus,audit.status.payout,form.effectiveStatus,
    audit.status.kaiRank,audit.status.abcd,audit.status.spikes,
    audit.counts.activeEntries,audit.counts.closingMarket,audit.counts.formSnapshots,audit.counts.kaiRank,audit.counts.abcd,audit.counts.spikes,
    audit.formLineage?.kind || null,audit.formLineage?.snapshotRef || null,
    audit.formLineage?.asOfByLeg ? JSON.stringify(Object.fromEntries(audit.formLineage.asOfByLeg)) : null,
    audit.lineage?.packId || null,audit.lineage?.factsFingerprint || null,audit.lineage?.asOf || null,
    attempted ? 1 : 0,summary.message,summary.errorClass,at,at,attempted ? 1 : 0,at,completedAt,
    audit.fingerprints.round,audit.primarySystemId,audit.counts.winnerLegs,audit.counts.ambiguousWinnerLegs,audit.finalGameSourceRecordId,
    resolution.nextCheckAt,
    form.inputFingerprint,form.lastAttemptFingerprint,form.terminalFingerprint,form.terminalReason,
    form.retryCount,form.nextRetryAt,form.errorClass,
    finalMarket.inputFingerprint,finalMarket.lastAttemptFingerprint,finalMarket.terminalFingerprint,finalMarket.terminalReason,
    finalMarket.retryCount,finalMarket.nextRetryAt,finalMarket.errorClass,
    audit.roundId,token
  ).run();
  if (Number(result.meta?.changes || 0)!==1) throw new Error('statistics backfill lease was lost while persisting audit');
  return resolution;
}

async function persistAuditFailure(env, state, token, at, error) {
  const classified=classifyAuditError(error);
  const retryCount=Number(state?.audit_retry_count || 0)+1;
  const terminal=classified.terminal || retryCount>=STATISTICS_MAX_AUDIT_RETRIES;
  const errorClass=terminal && !classified.terminal ? 'audit_retry_exhausted' : classified.errorClass;
  const status=terminal ? 'manual_review' : 'pending';
  const workState=terminal ? 'manual_review' : 'retryable';
  const nextCheckAt=addMs(at,terminal ? STATISTICS_TERMINAL_REAUDIT_MS : retryDelayMs(retryCount));
  const result=await env.DB.prepare(`
    UPDATE statistics_data_backfill_rounds
    SET status=?,work_state=?,audit_retry_count=?,last_error=?,last_error_class=?,
        last_checked_at=?,next_check_at=?,completed_at=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE game_round_id=? AND lease_token=?
  `).bind(status,workState,retryCount,'audit: '+errorClass,errorClass,at,nextCheckAt,terminal ? at : null,state.game_round_id,token).run();
  if (Number(result.meta?.changes || 0)!==1) throw new Error('statistics backfill lease was lost while recording audit failure');
  return {status,workState,errorClass,nextCheckAt};
}

export async function runNextStatisticsDataBackfill(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const at=nowIso(options.now ?? Date.now());
  await ensureStatisticsDataBackfillQueue(env,at);
  const requested=options.roundId == null ? null : String(options.roundId).trim();
  const target=requested
    ? await env.DB.prepare('SELECT game_round_id FROM statistics_data_backfill_rounds WHERE game_round_id=? LIMIT 1').bind(requested).first()
    : await nextQueuedRound(env,at);
  if (requested && !target) throw new Error('round is not eligible for historical statistics backfill');
  if (!target) return {version:STATISTICS_DATA_BACKFILL_VERSION,status:'idle'};

  const token=await acquireLease(env,target.game_round_id,at);
  if (!token) return {version:STATISTICS_DATA_BACKFILL_VERSION,status:'busy',roundId:target.game_round_id};
  const state=await loadState(env,target.game_round_id);

  try {
    let audit=await auditStatisticsRound(env,target.game_round_id);
    let form=controlForForm(state,audit,at);
    let finalMarket=controlForFinalMarket(state,audit,at);
    let attempted=false;

    if (audit.finalGameSourceRecordId && audit.status.finalMarket==='pending' && finalMarket.effectiveStatus==='pending' && !finalMarket.retryBlocked) {
      attempted=true;
      finalMarket.lastAttemptFingerprint=finalMarket.inputFingerprint;
      try {
        await (options.closingMarketRepairImpl || repairCapturedOfficialClosingMarket)(env,audit.finalGameSourceRecordId);
        audit=await auditStatisticsRound(env,target.game_round_id);
        finalMarket=controlForFinalMarket(state,audit,at);
        finalMarket.lastAttemptFingerprint=audit.fingerprints.finalMarket;
        if (audit.status.finalMarket!=='complete') {
          finalMarket={...finalMarket,effectiveStatus:'manual_review',terminalFingerprint:finalMarket.inputFingerprint,
            terminalReason:'closing_market_incomplete_after_repair',errorClass:'closing_market_incomplete_after_repair',
            retryCount:0,nextRetryAt:null};
        }
      } catch (error) {
        const classified=classifyClosingMarketError(error);
        if (classified.terminal) {
          finalMarket={...finalMarket,effectiveStatus:'manual_review',terminalFingerprint:finalMarket.inputFingerprint,
            terminalReason:classified.errorClass,errorClass:classified.errorClass,retryCount:0,nextRetryAt:null};
        } else {
          const retryCount=finalMarket.retryCount+1;
          finalMarket={...finalMarket,effectiveStatus:'pending',retryCount,errorClass:classified.errorClass,nextRetryAt:addMs(at,retryDelayMs(retryCount))};
        }
      }
    }

    form=controlForForm(state,audit,at);
    if (audit.status.form==='pending' && form.effectiveStatus==='pending' && !form.retryBlocked) {
      attempted=true;
      form.lastAttemptFingerprint=form.inputFingerprint;
      try {
        const replay=await (options.formReplayImpl || replayFormSnapshot)(env,audit);
        if (replay.status==='complete') {
          audit=await auditStatisticsRound(env,target.game_round_id);
          form=controlForForm(state,audit,at);
          form.lastAttemptFingerprint=audit.fingerprints.form;
        } else if (replay.status==='manual_review') {
          form={...form,effectiveStatus:'manual_review',terminalFingerprint:form.inputFingerprint,
            terminalReason:replay.reason,errorClass:replay.reason,retryCount:0,nextRetryAt:null};
        } else {
          form={...form,effectiveStatus:'unavailable',terminalFingerprint:form.inputFingerprint,
            terminalReason:replay.reason || 'verified_form_lineage_missing',errorClass:null,retryCount:0,nextRetryAt:null};
        }
      } catch (error) {
        const classified=classifyFormReplayError(error);
        const retryCount=form.retryCount+1;
        if (classified.terminal || (classified.errorClass==='form_replay_other' && retryCount>=STATISTICS_MAX_FORM_RETRIES)) {
          form={...form,effectiveStatus:'manual_review',terminalFingerprint:form.inputFingerprint,
            terminalReason:classified.terminal ? classified.errorClass : 'form_replay_retry_exhausted',
            errorClass:classified.terminal ? classified.errorClass : 'form_replay_retry_exhausted',
            retryCount,nextRetryAt:null};
        } else {
          form={...form,effectiveStatus:'pending',retryCount,errorClass:classified.errorClass,nextRetryAt:addMs(at,retryDelayMs(retryCount))};
        }
      }
    }

    const resolution=await persistAudit(env,token,audit,form,finalMarket,at,attempted);
    return {
      version:STATISTICS_DATA_BACKFILL_VERSION,status:resolution.overall,workState:resolution.workState,
      roundId:audit.roundId,metrics:resolution.effective,counts:audit.counts,
      step1PackId:audit.lineage?.packId || null,formLineageKind:audit.formLineage?.kind || null,
      formSnapshotRef:audit.formLineage?.snapshotRef || null,nextCheckAt:resolution.nextCheckAt,
      reason:summarizedError(audit,form,finalMarket).message
    };
  } catch (error) {
    const failure=await persistAuditFailure(env,state,token,at,error);
    return {
      version:STATISTICS_DATA_BACKFILL_VERSION,status:failure.status,workState:failure.workState,
      roundId:target.game_round_id,nextCheckAt:failure.nextCheckAt,reason:'audit: '+failure.errorClass
    };
  }
}

export async function getStatisticsDataBackfillStatus(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  const {results}=await env.DB.prepare(`
    SELECT status,COUNT(*) n FROM statistics_data_backfill_rounds GROUP BY status ORDER BY status
  `).all();
  const totals=Object.fromEntries((results || []).map((row)=>[row.status,Number(row.n || 0)]));
  const {results:workResults}=await env.DB.prepare(`
    SELECT work_state,COUNT(*) n FROM statistics_data_backfill_rounds GROUP BY work_state ORDER BY work_state
  `).all();
  const workStates=Object.fromEntries((workResults || []).map((row)=>[row.work_state,Number(row.n || 0)]));
  const coverage=await env.DB.prepare(`
    SELECT COUNT(*) rounds,
      SUM(CASE WHEN result_status='complete' THEN 1 ELSE 0 END) results_complete,
      SUM(CASE WHEN final_market_status='complete' THEN 1 ELSE 0 END) final_market_complete,
      SUM(CASE WHEN payout_status='complete' THEN 1 ELSE 0 END) payout_complete,
      SUM(CASE WHEN form_status='complete' THEN 1 ELSE 0 END) form_complete,
      SUM(CASE WHEN kai_rank_status='complete' THEN 1 ELSE 0 END) kai_rank_complete,
      SUM(CASE WHEN abcd_status='complete' THEN 1 ELSE 0 END) abcd_complete,
      SUM(CASE WHEN spike_status='complete' THEN 1 ELSE 0 END) spike_complete
    FROM statistics_data_backfill_rounds
  `).first();
  const actionable=await scalar(env,`
    SELECT COUNT(*) n FROM statistics_data_backfill_rounds
    WHERE next_check_at IS NOT NULL AND datetime(next_check_at)<=datetime('now')
      AND (lease_until IS NULL OR datetime(lease_until)<datetime('now'))
  `);
  const {results:attention}=await env.DB.prepare(`
    SELECT work_state,status,result_status,final_market_status,payout_status,form_status,
           kai_rank_status,abcd_status,spike_status,COALESCE(last_error_class,'none') error_class,COUNT(*) count
    FROM statistics_data_backfill_rounds
    WHERE work_state IN ('waiting','retryable','manual_review','complete_with_gaps')
    GROUP BY work_state,status,result_status,final_market_status,payout_status,form_status,
             kai_rank_status,abcd_status,spike_status,COALESCE(last_error_class,'none')
    ORDER BY work_state,error_class
  `).all();
  return {
    version:STATISTICS_DATA_BACKFILL_VERSION,totals,workStates,actionable,
    coverage:{
      rounds:Number(coverage?.rounds || 0),results:Number(coverage?.results_complete || 0),
      finalMarket:Number(coverage?.final_market_complete || 0),payout:Number(coverage?.payout_complete || 0),
      form:Number(coverage?.form_complete || 0),kaiRank:Number(coverage?.kai_rank_complete || 0),
      abcd:Number(coverage?.abcd_complete || 0),spikes:Number(coverage?.spike_complete || 0)
    },
    attention:attention || []
  };
}

export { closingMarketRepairFailureStatus };
