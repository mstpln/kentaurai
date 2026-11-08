import { getFinalGameResult } from './game-final-result-v1.js';

export const MANUAL_SETTLEMENT_TIERS = Object.freeze({
  V85:[8,7,6,5], V86:[8,7,6]
});

/** Count exact winning rows by tier, without guessing from system-wide hits. */
export function manualWinningRowCounts(legs, winners) {
  if (!Array.isArray(legs) || !Array.isArray(winners) || legs.length !== 8 || winners.length !== 8) {
    throw new Error('eight verified selections and winners are required');
  }
  let polynomial=[1];
  for (let index=0;index<8;index++) {
    const selections=legs[index];
    if (!Array.isArray(selections) || !selections.length || !Number.isInteger(winners[index])) {
      throw new Error('unsupported manual system or winner identity');
    }
    const hits=selections.filter(n=>Number(n)===winners[index]).length;
    const misses=selections.length-hits;
    const next=Array(polynomial.length+1).fill(0);
    for(let k=0;k<polynomial.length;k++){
      next[k]+=polynomial[k]*misses;
      next[k+1]+=polynomial[k]*hits;
    }
    polynomial=next;
  }
  if (polynomial.some(n=>!Number.isSafeInteger(n))) throw new Error('manual system row count overflow');
  return polynomial;
}

/** Final game payout must be source-verified. No phantom payout from hits alone. */
export function evaluateManualPayout(legs, winners, gameType, officialPayouts) {
  const tiers=MANUAL_SETTLEMENT_TIERS[gameType];
  if (!tiers || !officialPayouts || typeof officialPayouts !== 'object') {
    return { state:'manual_review', reason:'verified_payouts_missing' };
  }
  let lines;
  try { lines=manualWinningRowCounts(legs,winners); }
  catch { return { state:'manual_review', reason:'invalid_system_or_winners' }; }
  const correctLegs=legs.filter((numbers,index)=>numbers.includes(winners[index])).length;
  let payout=0;
  for(const tier of tiers){
    if (!lines[tier]) continue;
    const record=officialPayouts[String(tier)];
    const amount=record?.payoutSek;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return { state:'manual_review', reason:'verified_payout_tier_missing', correctLegs };
    }
    payout+=lines[tier]*amount;
  }
  if (!Number.isFinite(payout) || payout>Number.MAX_SAFE_INTEGER) {
    return { state:'manual_review', reason:'payout_out_of_range', correctLegs };
  }
  return {
    state:'settled', correctLegs,
    // Theoretical full-stake payout based on verified official tier prices.
    // This is not evidence that a ticket was submitted or paid.
    payoutSek:Math.round(payout*100)/100,
    winningLines:Object.fromEntries(tiers.map(tier=>[tier,lines[tier]||0]))
  };
}

async function roundWinnerState(env, roundId, legs) {
  const {results=[]}=await env.DB.prepare(
    'SELECT gl.leg_number,re.start_number,re.scratched,rr.placing,rr.result_status ' +
    'FROM game_legs gl LEFT JOIN race_entries re ON re.race_id=gl.race_id ' +
    'LEFT JOIN race_results rr ON rr.race_entry_id=re.id ' +
    'WHERE gl.game_round_id=? ORDER BY gl.leg_number,re.start_number'
  ).bind(roundId).all();
  const winners=[],scratchByLeg=[];
  for(let leg=1;leg<=8;leg++){
    const rows=results.filter(row=>Number(row.leg_number)===leg);
    if(!rows.length)return { state:'pending',reason:'entry_history_missing' };
    const winning=rows.filter(row=>row.result_status==='official'&&Number(row.placing)===1);
    if(winning.length!==1) {
      return { state:winning.length===0?'pending':'manual_review',
        reason:winning.length===0?'official_winner_pending':'ambiguous_winner' };
    }
    const number=Number(winning[0].start_number);
    if(!Number.isInteger(number)||number<1||number>15){
      return { state:'manual_review',reason:'unverified_winner_number' };
    }
    winners.push(number);
    scratchByLeg.push(rows.some(row=>Number(row.scratched)===1
      && legs[leg-1].includes(Number(row.start_number))));
  }
  if(scratchByLeg.some(Boolean)){
    return { state:'manual_review',reason:'selected_scratch_requires_verified_reserve',winners };
  }
  return { state:'ready',winners };
}

async function updateDeferred(env,id,now,reason) {
  const retryAt=new Date(Date.parse(now)+12*60*60*1000).toISOString();
  await env.DB.prepare(
    'UPDATE travdata_manual_systems SET next_check_at=?,attempt_count=attempt_count+1,' +
    'review_reason=? WHERE id=? AND settlement_state=\'pending\' AND deleted_at IS NULL'
  ).bind(retryAt,reason,id).run();
}

async function updateReview(env,id,now,reason,winners=null) {
  await env.DB.prepare(
    'UPDATE travdata_manual_systems SET settlement_state=\'manual_review\',review_reason=?,' +
    'winner_numbers_json=?,settled_at=?,attempt_count=attempt_count+1,next_check_at=NULL ' +
    'WHERE id=? AND settlement_state=\'pending\' AND deleted_at IS NULL'
  ).bind(reason,winners?JSON.stringify(winners):null,now,id).run();
}

export async function settleNextTravdataManualSystems(env, options={}) {
  if(!env?.DB)throw new Error('DB is not configured');
  const limit=options.maxSystems==null?5:Number(options.maxSystems);
  if(!Number.isInteger(limit)||limit<1||limit>10)throw new Error('maxSystems must be 1..10');
  const now=new Date(options.now||Date.now()).toISOString();
  const {results:pending=[]}=await env.DB.prepare(
    'SELECT id,game_round_id,game_type,selections_json,stake_sek FROM travdata_manual_systems ' +
    'WHERE settlement_state=\'pending\' AND deleted_at IS NULL ' +
    'AND (next_check_at IS NULL OR next_check_at<=?) ORDER BY created_at ASC,id ASC LIMIT ?'
  ).bind(now,limit).all();
  const summaries=[];
  for(const s of pending){
    const final=await getFinalGameResult(env,s.game_round_id);
    if(!final||final.status!=='results'){
      await updateDeferred(env,s.id,now,'official_final_game_pending');
      summaries.push({id:s.id,state:'pending'});
      continue;
    }
    let legs;
    try{legs=JSON.parse(s.selections_json);}
    catch{
      await updateReview(env,s.id,now,'invalid_stored_system');
      summaries.push({id:s.id,state:'manual_review'});
      continue;
    }
    const state=await roundWinnerState(env,s.game_round_id,legs);
    if(state.state==='pending'){
      await updateDeferred(env,s.id,now,state.reason);
      summaries.push({id:s.id,state:'pending'});
      continue;
    }
    if(state.state==='manual_review'){
      await updateReview(env,s.id,now,state.reason,state.winners);
      summaries.push({id:s.id,state:'manual_review'});
      continue;
    }
    const outcome=evaluateManualPayout(legs,state.winners,s.game_type,final.payouts);
    if(outcome.state==='manual_review'){
      await updateReview(env,s.id,now,outcome.reason,state.winners);
      summaries.push({id:s.id,state:'manual_review'});
      continue;
    }
    const net=Math.round((outcome.payoutSek-Number(s.stake_sek))*100)/100;
    await env.DB.prepare(
      'UPDATE travdata_manual_systems SET settlement_state=\'settled\',payout_sek=?,' +
      'net_sek=?,correct_legs=?,winner_numbers_json=?,settled_at=?,review_reason=NULL,' +
      'attempt_count=attempt_count+1,next_check_at=NULL ' +
      'WHERE id=? AND settlement_state=\'pending\' AND deleted_at IS NULL'
    ).bind(outcome.payoutSek,net,outcome.correctLegs,JSON.stringify(state.winners),now,s.id).run();
    summaries.push({id:s.id,state:'settled',correctLegs:outcome.correctLegs});
  }
  return {processed:summaries.length,settled:summaries.filter(x=>x.state==='settled').length,
    pending:summaries.filter(x=>x.state==='pending').length,
    manualReview:summaries.filter(x=>x.state==='manual_review').length};
}
