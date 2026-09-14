import { placingStats,binaryStats,personEvidence,shrinkDelta } from './person-context-stats.js';

function parsePace(value){
  if(typeof value!=='string')return null;
  const match=value.trim().replace(/\s*min\/km$/i,'').match(/^(\d+)[.:](\d{2})[,.](\d)$/);
  if(!match)return null;
  const seconds=Number(match[2]);
  return seconds<=59?Number(match[1])*60+seconds+Number(match[3])/10:null;
}

async function openingPace(env,rows,cutoffIso){
  const values=[]; const refs=[];
  for(const row of rows){
    const x=await env.DB.prepare(`SELECT x.first_200_time,x.source_record_id,sr.fetched_at FROM xlabs_data x JOIN source_records sr ON sr.id=x.source_record_id WHERE x.race_entry_id=? AND x.quality_status='xlabs-telemetry-v1' AND julianday(sr.fetched_at)<=julianday(?) ORDER BY julianday(sr.fetched_at) DESC,x.id DESC LIMIT 1`).bind(row.race_entry_id,cutoffIso).first();
    const value=parsePace(x?.first_200_time); if(value!=null){values.push(value);refs.push(x);}
  }
  return {value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,count:values.length,refs};
}

export async function buildDriverHorseContext(env,horseRows,driverId,cutoffIso,version){
  const together=driverId?horseRows.filter((row)=>row.driver_id===driverId):[];
  const other=driverId?horseRows.filter((row)=>row.driver_id&&row.driver_id!==driverId):horseRows;
  const tp=placingStats(together),op=placingStats(other),tg=binaryStats(together,'gallop'),og=binaryStats(other,'gallop'),td=binaryStats(together,'disqualified');
  const top3Delta=tp.top3Rate==null||op.top3Rate==null?null:tp.top3Rate-op.top3Rate;
  const gallopDelta=tg.rate==null||og.rate==null?null:tg.rate-og.rate;
  const pace=await openingPace(env,together,cutoffIso);
  return {
    status:together.length?'own_history':'unavailable',together_starts:together.length,other_driver_starts:other.length,
    together_win_rate:personEvidence({value:tp.winRate,source:'driver_horse_together_history',known:tp.known,total:together.length,asOf:cutoffIso,version}),
    together_top3_rate:personEvidence({value:tp.top3Rate,source:'driver_horse_together_history',known:tp.known,total:together.length,asOf:cutoffIso,version}),
    other_driver_top3_rate:personEvidence({value:op.top3Rate,source:'same_horse_other_driver_history',known:op.known,total:other.length,asOf:cutoffIso,version}),
    top3_association_delta_vs_other_drivers:personEvidence({value:top3Delta,source:'driver_horse_vs_other_drivers',known:tp.known,total:together.length,asOf:cutoffIso,version}),
    together_gallop_rate:personEvidence({value:tg.rate,source:'driver_horse_together_history',known:tg.known,total:together.length,asOf:cutoffIso,version}),
    other_driver_gallop_rate:personEvidence({value:og.rate,source:'same_horse_other_driver_history',known:og.known,total:other.length,asOf:cutoffIso,version}),
    gallop_association_delta_vs_other_drivers:personEvidence({value:gallopDelta,source:'driver_horse_vs_other_drivers',known:tg.known,total:together.length,asOf:cutoffIso,version}),
    together_disqualification_rate:personEvidence({value:td.rate,source:'driver_horse_together_history',known:td.known,total:together.length,asOf:cutoffIso,version}),
    together_xlabs_first200_km_seconds:personEvidence({value:pace.value,source:'xlabs_driver_horse_history',known:pace.count,total:together.length,asOf:cutoffIso,version}),
    estimates:{shrunk_top3_association_delta:shrinkDelta(top3Delta,tp.known),shrunk_gallop_association_delta:shrinkDelta(gallopDelta,tg.known)},
    xlabs_source_refs:pace.refs.map((row)=>({source_record_id:row.source_record_id,selected_at:row.fetched_at,time_basis:'xlabs_observed_at'}))
  };
}
