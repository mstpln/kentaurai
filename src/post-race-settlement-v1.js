import { stableId } from './ids.js';
import { normalizeCapturedOfficialRace, officialRaceHasFinalResults } from './import/official-historical-race.js';
import { ensureXlabsDailyDateJob } from './import/xlabs-backfill.js';
import { captureRace } from './provider/official.js';
import { sourceFailureRetryDelayMs } from './provider/source-error.js';

export const POST_RACE_SETTLEMENT_VERSION = 'post-race-settlement-v1';
export const POST_RACE_SETTLEMENT_DELAY_MINUTES = 45;
export const POST_RACE_NOT_FINAL_RETRY_MS = 5 * 60_000;
export const POST_RACE_DEFAULT_RETRY_MS = 10 * 60_000;
const LEASE_MS = 4 * 60_000;

function exactIso(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('settlement time is invalid');
  return date.toISOString();
}

function addMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

async function eligibleRounds(env, nowIso) {
  const today = nowIso.slice(0, 10);
  const { results } = await env.DB.prepare(`
    SELECT gr.id,gr.round_date,
      COALESCE(
        (SELECT MAX(r.scheduled_start_at)
         FROM game_legs gl JOIN races r ON r.id=gl.race_id
         WHERE gl.game_round_id=gr.id),
        gr.scheduled_start_at,
        gr.bet_stop_at
      ) AS last_known_start
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND EXISTS (SELECT 1 FROM systems s WHERE s.game_round_id=gr.id)
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8
      AND (
        SELECT COUNT(*)
        FROM game_legs gl
        WHERE gl.game_round_id=gr.id
          AND (SELECT COUNT(*)
               FROM race_entries re
               JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1
               WHERE re.race_id=gl.race_id)=1
      )<8
      AND (
        gr.round_date<?
        OR (
          gr.round_date=?
          AND COALESCE(
            (SELECT MAX(r2.scheduled_start_at)
             FROM game_legs gl2 JOIN races r2 ON r2.id=gl2.race_id
             WHERE gl2.game_round_id=gr.id),
            gr.scheduled_start_at,
            gr.bet_stop_at
          ) IS NOT NULL
          AND datetime(COALESCE(
            (SELECT MAX(r3.scheduled_start_at)
             FROM game_legs gl3 JOIN races r3 ON r3.id=gl3.race_id
             WHERE gl3.game_round_id=gr.id),
            gr.scheduled_start_at,
            gr.bet_stop_at
          ), '+45 minutes')<=datetime(?)
        )
      )
    ORDER BY gr.round_date ASC,gr.id ASC
  `).bind(today,today,nowIso).all();
  return results || [];
}

export async function ensurePostRaceSettlementJobs(env, scheduledTime = Date.now()) {
  if (!env.DB) throw new Error('DB is not configured');
  const nowIso = exactIso(scheduledTime);
  const rounds = await eligibleRounds(env, nowIso);
  let created = 0;
  for (const round of rounds) {
    const id = stableId('post-race-settlement', POST_RACE_SETTLEMENT_VERSION, round.id);
    const write = await env.DB.prepare(`
      INSERT OR IGNORE INTO post_race_settlement_jobs
        (id,game_round_id,status,settled_legs,next_check_at,started_at)
      VALUES (?,?,'pending',0,?,?)
    `).bind(id,round.id,nowIso,nowIso).run();
    created += Number(write.meta?.changes ?? 0);
  }
  return { version:POST_RACE_SETTLEMENT_VERSION, eligible:rounds.length, created };
}

async function roundState(env, roundId) {
  const { results } = await env.DB.prepare(`
    SELECT gl.leg_number,gl.race_id,r.race_date,r.scheduled_start_at,
      (SELECT COUNT(*)
       FROM race_entries re
       JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1
       WHERE re.race_id=gl.race_id) AS winner_count
    FROM game_legs gl
    JOIN races r ON r.id=gl.race_id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number
  `).bind(roundId).all();
  if ((results || []).length !== 8) throw new Error(`round ${roundId} does not have exactly eight legs`);
  return results.map(row=>({
    legNumber:Number(row.leg_number),
    raceId:row.race_id,
    raceDate:row.race_date,
    scheduledStartAt:row.scheduled_start_at || null,
    winnerCount:Number(row.winner_count || 0)
  }));
}

async function selectJob(env, roundId, nowIso) {
  const filter = roundId ? 'AND j.game_round_id=?' : '';
  const sql = `
    SELECT j.*,gr.round_date
    FROM post_race_settlement_jobs j
    JOIN game_rounds gr ON gr.id=j.game_round_id
    WHERE j.status IN ('pending','waiting')
      AND (j.next_check_at IS NULL OR j.next_check_at<=?)
      AND (j.lease_until IS NULL OR j.lease_until<?)
      ${filter}
    ORDER BY gr.round_date ASC,j.created_at ASC,j.id ASC
    LIMIT 1
  `;
  return roundId
    ? env.DB.prepare(sql).bind(nowIso,nowIso,roundId).first()
    : env.DB.prepare(sql).bind(nowIso,nowIso).first();
}

async function acquireLease(env, job, nowIso) {
  const token = crypto.randomUUID();
  const result = await env.DB.prepare(`
    UPDATE post_race_settlement_jobs
    SET lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('pending','waiting')
      AND (lease_until IS NULL OR lease_until<?)
  `).bind(token,addMs(nowIso,LEASE_MS),job.id,nowIso).run();
  return Number(result.meta?.changes ?? 0)===1 ? token : null;
}

async function releaseWaiting(env, job, token, settledLegs, nowIso, delayMs, message = null) {
  const result = await env.DB.prepare(`
    UPDATE post_race_settlement_jobs
    SET status='waiting',settled_legs=?,attempt_count=attempt_count+1,
        next_check_at=?,last_error=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=?
  `).bind(settledLegs,addMs(nowIso,delayMs),message,job.id,token).run();
  if (Number(result.meta?.changes ?? 0)!==1) throw new Error('post-race settlement lease was lost while waiting');
}

async function releasePending(env, job, token, settledLegs, nowIso) {
  const result = await env.DB.prepare(`
    UPDATE post_race_settlement_jobs
    SET status='pending',settled_legs=?,attempt_count=attempt_count+1,
        next_check_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=?
  `).bind(settledLegs,nowIso,job.id,token).run();
  if (Number(result.meta?.changes ?? 0)!==1) throw new Error('post-race settlement lease was lost while checkpointing');
}

async function markManualReview(env, job, token, settledLegs, message) {
  const result = await env.DB.prepare(`
    UPDATE post_race_settlement_jobs
    SET status='manual_review',settled_legs=?,attempt_count=attempt_count+1,
        next_check_at=NULL,last_error=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=?
  `).bind(settledLegs,message,job.id,token).run();
  if (Number(result.meta?.changes ?? 0)!==1) throw new Error('post-race settlement lease was lost while marking manual review');
}

async function markCompleted(env, job, token, roundDate, nowIso) {
  const xlabsJob = await ensureXlabsDailyDateJob(env, roundDate);
  const result = await env.DB.prepare(`
    UPDATE post_race_settlement_jobs
    SET status='completed',settled_legs=8,attempt_count=attempt_count+1,
        next_check_at=NULL,last_error=NULL,lease_token=NULL,lease_until=NULL,
        completed_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=?
  `).bind(nowIso,job.id,token).run();
  if (Number(result.meta?.changes ?? 0)!==1) throw new Error('post-race settlement lease was lost while completing');
  return xlabsJob;
}

async function readCapturedRace(env, rawObjectKey) {
  const object = await env.RAW_BUCKET?.get?.(rawObjectKey);
  if (!object) throw new Error('captured post-race raw object was not found');
  let payload;
  try { payload=JSON.parse(await object.text()); }
  catch { throw new Error('captured post-race raw object is invalid JSON'); }
  return payload;
}

export async function getPostRaceSettlementJob(env, roundId) {
  const id=String(roundId || '').trim();
  if (!id) throw new Error('round_id is required');
  const row=await env.DB.prepare(`
    SELECT id,game_round_id,status,settled_legs,attempt_count,next_check_at,last_error,
           started_at,completed_at,created_at,updated_at
    FROM post_race_settlement_jobs
    WHERE game_round_id=?
    LIMIT 1
  `).bind(id).first();
  return row || null;
}

export async function runNextPostRaceSettlement(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  const nowIso=exactIso(options.now ?? Date.now());
  await ensurePostRaceSettlementJobs(env, nowIso);

  const requestedRoundId=options.roundId == null ? null : String(options.roundId).trim();
  const existing=requestedRoundId ? await getPostRaceSettlementJob(env, requestedRoundId) : null;
  if (existing?.status==='completed' || existing?.status==='manual_review') {
    return { status:existing.status,roundId:requestedRoundId,settledLegs:Number(existing.settled_legs || 0),reused:true };
  }

  const job=await selectJob(env,requestedRoundId,nowIso);
  if (!job) return { status:'idle',roundId:requestedRoundId,settledLegs:0 };
  const token=await acquireLease(env,job,nowIso);
  if (!token) return { status:'busy',roundId:job.game_round_id,settledLegs:Number(job.settled_legs || 0) };

  try {
    let state=await roundState(env,job.game_round_id);
    const ambiguous=state.find(leg=>leg.winnerCount>1);
    if (ambiguous) {
      const settled=state.filter(leg=>leg.winnerCount===1).length;
      const message=`leg ${ambiguous.legNumber} has ambiguous factual winners`;
      await markManualReview(env,job,token,settled,message);
      return { status:'manual_review',roundId:job.game_round_id,settledLegs:settled,legNumber:ambiguous.legNumber,reason:'ambiguous_winner' };
    }

    let settled=state.filter(leg=>leg.winnerCount===1).length;
    if (settled===8) {
      const xlabsJob=await markCompleted(env,job,token,job.round_date,nowIso);
      return { status:'completed',roundId:job.game_round_id,settledLegs:8,xlabsJobId:xlabsJob.id || null,reused:true };
    }

    const target=state.find(leg=>leg.winnerCount===0);
    const captured=await captureRace(env,target.raceId,{fetchImpl:options.fetchImpl});
    const payload=await readCapturedRace(env,captured.rawObjectKey);
    if (!officialRaceHasFinalResults(payload)) {
      await releaseWaiting(env,job,token,settled,nowIso,POST_RACE_NOT_FINAL_RETRY_MS,'official race results are not final');
      return {
        status:'waiting',
        roundId:job.game_round_id,
        legNumber:target.legNumber,
        raceId:target.raceId,
        settledLegs:settled,
        nextCheckAt:addMs(nowIso,POST_RACE_NOT_FINAL_RETRY_MS),
        reason:'results_not_final'
      };
    }

    await normalizeCapturedOfficialRace(env,captured.sourceRecordId);
    state=await roundState(env,job.game_round_id);
    const afterAmbiguous=state.find(leg=>leg.winnerCount>1);
    if (afterAmbiguous) {
      settled=state.filter(leg=>leg.winnerCount===1).length;
      const message=`leg ${afterAmbiguous.legNumber} has ambiguous factual winners`;
      await markManualReview(env,job,token,settled,message);
      return { status:'manual_review',roundId:job.game_round_id,settledLegs:settled,legNumber:afterAmbiguous.legNumber,reason:'ambiguous_winner' };
    }

    settled=state.filter(leg=>leg.winnerCount===1).length;
    if (settled===8) {
      const xlabsJob=await markCompleted(env,job,token,job.round_date,nowIso);
      return {
        status:'completed',
        roundId:job.game_round_id,
        legNumber:target.legNumber,
        raceId:target.raceId,
        settledLegs:8,
        sourceRecordId:captured.sourceRecordId,
        xlabsJobId:xlabsJob.id || null
      };
    }

    await releasePending(env,job,token,settled,nowIso);
    return {
      status:'running',
      roundId:job.game_round_id,
      legNumber:target.legNumber,
      raceId:target.raceId,
      settledLegs:settled,
      sourceRecordId:captured.sourceRecordId
    };
  } catch (error) {
    const retry=sourceFailureRetryDelayMs(error) ?? POST_RACE_DEFAULT_RETRY_MS;
    const state=await roundState(env,job.game_round_id).catch(()=>[]);
    const settled=Array.isArray(state) ? state.filter(leg=>leg.winnerCount===1).length : Number(job.settled_legs || 0);
    await releaseWaiting(env,job,token,settled,nowIso,retry,String(error.message).slice(0,1000));
    throw error;
  }
}


export async function runPostRaceSettlementBatch(env, options = {}) {
  const maxSteps = options.maxSteps == null ? 3 : Number(options.maxSteps);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 3) throw new Error('maxSteps must be between 1 and 3');
  const results = [];
  for (let index = 0; index < maxSteps; index += 1) {
    const result = await runNextPostRaceSettlement(env, options);
    results.push(result);
    if (!result || ['idle','busy','waiting','manual_review','completed'].includes(result.status)) break;
  }
  const last = results.at(-1) || { status:'idle',settledLegs:0 };
  return {
    status:last.status,
    roundId:last.roundId || options.roundId || null,
    settledLegs:Number(last.settledLegs || 0),
    stepCount:results.length,
    maxSteps,
    results
  };
}
