import { placingStats,binaryStats,personEvidence,shrinkDelta } from './person-context-stats.js';
const CHUNK=80;
function ph(values){return values.map(()=>'?').join(',');}
function parsePace(value){if(typeof value!=='string')return null;const m=value.trim().replace(/\s*min\/km$/i,'').match(/^(\d+)[.:](\d{2})[,.](\d)$/);if(!m)return null;const s=Number(m[2]);return s<=59?Number(m[1])*60+s+Number(m[3])/10:null;}

async function openingPace(env,rows,cutoffIso){
  const ids=[...new Set(rows.map((row)=>row.race_entry_id))],latest=new Map();
  for(let i=0;i<ids.length;i+=CHUNK){
    const group=ids.slice(i,i+CHUNK);
    const {results}=await env.DB.prepare(`SELECT x.race_entry_id,x.first_200_time,x.source_record_id,sr.fetched_at FROM xlabs_data x JOIN source_records sr ON sr.id=x.source_record_id WHERE x.race_entry_id IN (${ph(group)}) AND x.quality_status='xlabs-telemetry-v1' AND julianday(sr.fetched_at)<=julianday(?) ORDER BY x.race_entry_id,julianday(sr.fetched_at) DESC,x.id DESC`).bind(...group,cutoffIso).all();
    for(const row of results||[])if(!latest.has(row.race_entry_id))latest.set(row.race_entry_id,row);
  }
  const used=[];for(const row of latest.values())if(parsePace(row.first_200_time)!=null)used.push(row);
  const values=used.map((row)=>parsePace(row.first_200_time));
  return {value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,count:values.length,refs:used};
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
