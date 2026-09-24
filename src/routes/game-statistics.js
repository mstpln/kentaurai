function normalizeGameType(value) {
  const type=String(value||'').toUpperCase();
  return type==='V85'||type==='V86'?type:null;
}

const PRIMARY_SYSTEM_ID = `COALESCE(
  (SELECT aer.main_system_id FROM analysis_external_runs aer WHERE aer.game_round_id=gr.id ORDER BY aer.created_at DESC,aer.id DESC LIMIT 1),
  (SELECT s1.id FROM systems s1 WHERE s1.game_round_id=gr.id AND s1.system_type='main' ORDER BY s1.created_at DESC,s1.id ASC LIMIT 1),
  (SELECT s2.id FROM systems s2 WHERE s2.game_round_id=gr.id ORDER BY s2.created_at ASC,s2.id ASC LIMIT 1)
)`;

const PRE_RACE_CUTOFF = `(
  SELECT value FROM (
    SELECT gr.bet_stop_at AS value
    UNION ALL SELECT gr.scheduled_start_at
    UNION ALL SELECT (
      SELECT r0.scheduled_start_at
      FROM game_legs gl0
      JOIN races r0 ON r0.id=gl0.race_id
      WHERE gl0.game_round_id=gr.id AND r0.scheduled_start_at IS NOT NULL
      ORDER BY julianday(r0.scheduled_start_at) ASC
      LIMIT 1
    )
  ) WHERE value IS NOT NULL ORDER BY julianday(value) ASC LIMIT 1
)`;

function rankLabel(value) {
  const rank=Number(value);
  if (!Number.isInteger(rank)||rank<1) return null;
  return rank>=10?'10+':String(rank);
}

function formLabel(value) {
  const score=Number(value);
  if (!Number.isFinite(score)) return null;
  if (score<40) return '<40';
  if (score<50) return '40–49';
  if (score<60) return '50–59';
  if (score<70) return '60–69';
  if (score<80) return '70–79';
  return '80+';
}

function marketLabel(value) {
  const pct=Number(value);
  if (!Number.isFinite(pct)||pct<0) return null;
  if (pct<5) return '0–4,9%';
  if (pct<10) return '5–9,9%';
  if (pct<20) return '10–19,9%';
  if (pct<30) return '20–29,9%';
  if (pct<50) return '30–49,9%';
  return '50%+';
}

function aggregate(rows, labels, selector) {
  const map=new Map(labels.map(label=>[label,{label,starters:0,winners:0,winRate:null}]));
  for (const row of rows) {
    const label=selector(row);
    if (!label||!map.has(label)) continue;
    const item=map.get(label);
    item.starters+=1;
    if (Number(row.placing)===1) item.winners+=1;
  }
  return labels.map(label=>{
    const item=map.get(label);
    return {...item,winRate:item.starters?item.winners/item.starters:null};
  });
}

function payoutLabel(value) {
  const payout=Number(value);
  if (!Number.isFinite(payout)||payout<0) return null;
  if (payout<5000) return '<5 000 kr';
  if (payout<20000) return '5 000–19 999 kr';
  if (payout<100000) return '20 000–99 999 kr';
  if (payout<500000) return '100 000–499 999 kr';
  return '500 000 kr+';
}

async function statisticsRows(env,gameType) {
  const filter=gameType?'AND gr.game_type=?':'';
  const sql=`
    WITH primary_rounds AS (
      SELECT gr.id AS round_id,gr.game_type,gr.round_date,
        ${PRIMARY_SYSTEM_ID} AS system_id
      FROM game_rounds gr
      WHERE gr.game_type IN ('V85','V86')
        AND EXISTS (SELECT 1 FROM systems sx WHERE sx.game_round_id=gr.id)
        AND (SELECT COUNT(*) FROM game_legs glx
             WHERE glx.game_round_id=gr.id
               AND (SELECT COUNT(*) FROM race_entries rex
                    JOIN race_results rrx ON rrx.race_entry_id=rex.id AND rrx.placing=1
                    WHERE rex.race_id=glx.race_id)=1)=8
        ${filter}
    )
    SELECT
      p.round_id,p.game_type,p.round_date,p.system_id,gl.leg_number,re.id AS race_entry_id,
      re.start_number,h.canonical_name AS horse_name,rr.placing,
      afs.form_score,afs.used_starts,afs.form_rank,
      bs.bet_percent AS closing_bet_percent,bs.market_rank AS closing_market_rank,
      (SELECT ahp.raw_rank
       FROM ai_horse_predictions ahp
       JOIN ai_race_analyses ara ON ara.id=ahp.ai_race_analysis_id
       JOIN systems sp ON sp.id=p.system_id
       WHERE ara.race_id=gl.race_id AND ara.model_version_id=sp.model_version_id AND ahp.race_entry_id=re.id
         AND ara.data_snapshot_at IS NOT NULL
         AND julianday(ara.data_snapshot_at)<=julianday(sp.created_at)
         AND julianday(ara.data_snapshot_at)<=julianday(${PRE_RACE_CUTOFF})
         AND julianday(ara.created_at)<=julianday(sp.created_at)
       ORDER BY ara.data_snapshot_at DESC,ara.created_at DESC,ara.id ASC LIMIT 1) AS kai_rank,
      (SELECT ahp.abcd_group
       FROM ai_horse_predictions ahp
       JOIN ai_race_analyses ara ON ara.id=ahp.ai_race_analysis_id
       JOIN systems sp ON sp.id=p.system_id
       WHERE ara.race_id=gl.race_id AND ara.model_version_id=sp.model_version_id AND ahp.race_entry_id=re.id
         AND ara.data_snapshot_at IS NOT NULL
         AND julianday(ara.data_snapshot_at)<=julianday(sp.created_at)
         AND julianday(ara.data_snapshot_at)<=julianday(${PRE_RACE_CUTOFF})
         AND julianday(ara.created_at)<=julianday(sp.created_at)
       ORDER BY ara.data_snapshot_at DESC,ara.created_at DESC,ara.id ASC LIMIT 1) AS abcd_group,
      CASE WHEN EXISTS(
        SELECT 1 FROM system_selections ss
        WHERE ss.system_id=p.system_id AND ss.race_entry_id=re.id AND ss.leg_number=gl.leg_number AND ss.is_spike=1
      ) THEN 1 ELSE 0 END AS is_spike
    FROM primary_rounds p
    JOIN game_rounds gr ON gr.id=p.round_id
    JOIN game_legs gl ON gl.game_round_id=p.round_id
    JOIN race_entries re ON re.race_id=gl.race_id AND re.scratched=0
    LEFT JOIN horses h ON h.id=re.horse_id
    LEFT JOIN race_results rr ON rr.race_entry_id=re.id
    LEFT JOIN game_round_final_results gfr ON gfr.game_round_id=p.round_id
    LEFT JOIN betting_snapshots bs ON bs.race_entry_id=re.id AND bs.source_record_id=gfr.source_record_id
    LEFT JOIN analysis_entry_form_snapshots afs ON afs.race_entry_id=re.id
      AND afs.step1_pack_id=COALESCE(
        (SELECT sdb.form_snapshot_ref
         FROM statistics_data_backfill_rounds sdb
         WHERE sdb.game_round_id=p.round_id AND sdb.form_status='complete'
         LIMIT 1),
        (SELECT aer.step1_pack_id FROM analysis_external_runs aer
         WHERE aer.main_system_id=p.system_id ORDER BY aer.created_at DESC,aer.id DESC LIMIT 1),
        (SELECT json_extract(sp2.metrics_json,'$.step1_pack_id')
         FROM systems sp2 WHERE sp2.id=p.system_id LIMIT 1)
      )
    ORDER BY p.round_date DESC,p.round_id,gl.leg_number,re.start_number,re.id
  `;
  const {results}=gameType
    ? await env.DB.prepare(sql).bind(gameType).all()
    : await env.DB.prepare(sql).all();
  return results||[];
}

async function payoutRows(env,gameType) {
  const filter=gameType?'AND gr.game_type=?':'';
  const sql=`
    SELECT gr.id AS round_id,gr.game_type,gfr.highest_payout_sek,
      (SELECT COUNT(DISTINCT ss.leg_number)
       FROM system_selections ss
       JOIN race_results rr ON rr.race_entry_id=ss.race_entry_id AND rr.placing=1
       WHERE ss.system_id=${PRIMARY_SYSTEM_ID}) AS correct_legs
    FROM game_rounds gr
    JOIN game_round_final_results gfr ON gfr.game_round_id=gr.id
    WHERE gr.game_type IN ('V85','V86')
      AND ${PRIMARY_SYSTEM_ID} IS NOT NULL
      ${filter}
    ORDER BY gr.round_date DESC,gr.id
  `;
  const {results}=gameType
    ? await env.DB.prepare(sql).bind(gameType).all()
    : await env.DB.prepare(sql).all();
  return results||[];
}

function aggregatePayout(rows) {
  const labels=['<5 000 kr','5 000–19 999 kr','20 000–99 999 kr','100 000–499 999 kr','500 000 kr+'];
  const map=new Map(labels.map(label=>[label,{label,rounds:0,totalCorrect:0,averageCorrect:null,correct8:0,correct7:0,correct6:0,correct5:0}]));
  for (const row of rows) {
    const label=payoutLabel(row.highest_payout_sek);
    if (!label) continue;
    const item=map.get(label);
    const correct=Number(row.correct_legs);
    item.rounds+=1;
    item.totalCorrect+=Number.isFinite(correct)?correct:0;
    if ([5,6,7,8].includes(correct)) item['correct'+correct]+=1;
  }
  return labels.map(label=>{
    const item=map.get(label);
    return {
      label,
      rounds:item.rounds,
      averageCorrect:item.rounds?item.totalCorrect/item.rounds:null,
      correct8:item.correct8,
      correct7:item.correct7,
      correct6:item.correct6,
      correct5:item.correct5
    };
  });
}

export async function getGameStatistics(env,options={}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const requestedType=String(options.gameType||'').trim();
  const gameType=normalizeGameType(requestedType);
  if (requestedType && !gameType) throw new Error('game type must be V85 or V86');
  const [rows,payouts]=await Promise.all([statisticsRows(env,gameType),payoutRows(env,gameType)]);
  const rankLabels=['1','2','3','4','5','6','7','8','9','10+'];
  const formLabels=['<40','40–49','50–59','60–69','70–79','80+'];
  const marketLabels=['0–4,9%','5–9,9%','10–19,9%','20–29,9%','30–49,9%','50%+'];
  const abcdLabels=['A','B','C','D'];
  const spikes=rows.filter(row=>Number(row.is_spike)===1).map(row=>({
    roundId:row.round_id,
    gameType:row.game_type,
    roundDate:row.round_date,
    legNumber:Number(row.leg_number),
    raceEntryId:row.race_entry_id,
    startNumber:row.start_number==null?null:Number(row.start_number),
    horseName:row.horse_name||null,
    won:Number(row.placing)===1,
    formScore:row.form_score==null?null:Number(row.form_score),
    formRank:row.form_rank==null?null:Number(row.form_rank),
    kaiRank:row.kai_rank==null?null:Number(row.kai_rank),
    abcdGroup:row.abcd_group||null,
    closingBetPercent:row.closing_bet_percent==null?null:Number(row.closing_bet_percent),
    closingMarketRank:row.closing_market_rank==null?null:Number(row.closing_market_rank)
  }));
  const winningSpikes=spikes.filter(row=>row.won).length;
  return {
    gameType,
    winners:{
      byBetPercent:aggregate(rows,marketLabels,row=>marketLabel(row.closing_bet_percent)),
      byMarketRank:aggregate(rows,rankLabels,row=>rankLabel(row.closing_market_rank)),
      byForm:aggregate(rows,formLabels,row=>formLabel(row.form_score)),
      byFormRank:aggregate(rows,rankLabels,row=>rankLabel(row.form_rank))
    },
    kentaurai:{
      byRank:aggregate(rows,rankLabels,row=>rankLabel(row.kai_rank)),
      byAbcd:aggregate(rows,abcdLabels,row=>row.abcd_group||null)
    },
    spikes:{
      total:spikes.length,
      winners:winningSpikes,
      hitRate:spikes.length?winningSpikes/spikes.length:null,
      items:spikes
    },
    payoutPerformance:aggregatePayout(payouts)
  };
}

export async function getWinnerContextsForRound(env,roundId) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id=String(roundId||'').trim();
  if (!id) return new Map();
  const {results}=await env.DB.prepare(`
    SELECT s.id AS system_id,gl.leg_number,winner.id AS race_entry_id,
      afs.form_score,afs.used_starts,afs.form_rank,
      bs.bet_percent AS closing_bet_percent,bs.market_rank AS closing_market_rank
    FROM systems s
    JOIN game_legs gl ON gl.game_round_id=s.game_round_id
    JOIN race_entries winner ON winner.race_id=gl.race_id
    JOIN race_results rr ON rr.race_entry_id=winner.id AND rr.placing=1
    LEFT JOIN game_round_final_results gfr ON gfr.game_round_id=s.game_round_id
    LEFT JOIN betting_snapshots bs ON bs.race_entry_id=winner.id AND bs.source_record_id=gfr.source_record_id
    LEFT JOIN analysis_entry_form_snapshots afs ON afs.race_entry_id=winner.id
      AND afs.step1_pack_id=COALESCE(
        (SELECT sdb.form_snapshot_ref
         FROM statistics_data_backfill_rounds sdb
         WHERE sdb.game_round_id=s.game_round_id
           AND sdb.form_status='complete'
           AND s.id=COALESCE(
             (SELECT aer0.main_system_id FROM analysis_external_runs aer0
              WHERE aer0.game_round_id=s.game_round_id
              ORDER BY aer0.created_at DESC,aer0.id DESC LIMIT 1),
             (SELECT s1.id FROM systems s1
              WHERE s1.game_round_id=s.game_round_id AND s1.system_type='main'
              ORDER BY s1.created_at DESC,s1.id ASC LIMIT 1),
             (SELECT s2.id FROM systems s2
              WHERE s2.game_round_id=s.game_round_id
              ORDER BY s2.created_at ASC,s2.id ASC LIMIT 1)
           )
         LIMIT 1),
        json_extract(s.metrics_json,'$.step1_pack_id'),
        (SELECT aer.step1_pack_id FROM analysis_external_runs aer
         WHERE aer.main_system_id=s.id
         ORDER BY aer.created_at DESC,aer.id DESC LIMIT 1)
      )
    WHERE s.game_round_id=?
    ORDER BY s.id,gl.leg_number
  `).bind(id).all();
  return new Map((results||[]).map(row=>[
    `${row.system_id}:${row.leg_number}`,
    {
      raceEntryId:row.race_entry_id,
      formScore:row.form_score==null?null:Number(row.form_score),
      usedStarts:row.used_starts==null?null:Number(row.used_starts),
      formRank:row.form_rank==null?null:Number(row.form_rank),
      closingBetPercent:row.closing_bet_percent==null?null:Number(row.closing_bet_percent),
      closingMarketRank:row.closing_market_rank==null?null:Number(row.closing_market_rank)
    }
  ]));
}
