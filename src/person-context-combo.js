import { placingStats,binaryStats,personEvidence,shrinkDelta } from './person-context-stats.js';
const CHUNK=80;
function ph(values){return values.map(()=>'?').join(',');}
function parsePace(value){if(typeof value!=='string')return null;const m=value.trim().replace(/\s*min\/km$/i,'').match(/^(\d+)[.:](\d{2})[,.](\d)$/);if(!m)return null;const s=Number(m[2]);return s<=59?Number(m[1])*60+s+Number(m[3])/10:null;}

export async function loadDriverHorseXlabs(env,entryIds,cutoffIso){
  const ids=[...new Set((entryIds||[]).filter(Boolean))],latest=new Map();
  for(let i=0;i<ids.length;i+=CHUNK){const group=ids.slice(i,i+CHUNK);const {results}=await env.DB.prepare(`SELECT x.race_entry_id,x.first_200_time,x.source_record_id,sr.fetched_at FROM xlabs_data x JOIN source_records sr ON sr.id=x.source_record_id WHERE x.race_entry_id IN (${ph(group)}) AND x.quality_status='xlabs-telemetry-v1' AND julianday(sr.fetched_at)<=julianday(?) ORDER BY x.race_entry_id,julianday(sr.fetched_at) DESC,x.id DESC`).bind(...group,cutoffIso).all();for(const row of results||[])if(!latest.has(row.race_entry_id))latest.set(row.race_entry_id,row);}
  return latest;
}

export function buildDriverHorseContext(horseRows,driverId,xlabsByEntry,cutoffIso,version){
  const together=driverId?horseRows.filter((row)=>row.driver_id===driverId):[];
  const other=driverId?horseRows.filter((row)=>row.driver_id&&row.driver_id!==driverId):[];
  const tp=placingStats(together),op=placingStats(other),tg=binaryStats(together,'gallop'),og=binaryStats(other,'gallop'),td=binaryStats(together,'disqualified');
  const top3Delta=tp.top3Rate==null||op.top3Rate==null?null:tp.top3Rate-op.top3Rate,gallopDelta=tg.rate==null||og.rate==null?null:tg.rate-og.rate;
  const used=[];for(const row of together){const x=xlabsByEntry?.get(row.race_entry_id);if(parsePace(x?.first_200_time)!=null)used.push(x);}const paceValues=used.map((row)=>parsePace(row.first_200_time)),pace=paceValues.length?paceValues.reduce((a,b)=>a+b,0)/paceValues.length:null;
  return {status:together.length?'own_history':'unavailable',together_starts:together.length,other_driver_starts:other.length,
    together_win_rate:personEvidence({value:tp.winRate,source:'driver_horse_together_history',known:tp.known,total:together.length,asOf:cutoffIso,version}),
    together_top3_rate:personEvidence({value:tp.top3Rate,source:'driver_horse_together_history',known:tp.known,total:together.length,asOf:cutoffIso,version}),other_driver_top3_rate:personEvidence({value:op.top3Rate,source:'same_horse_other_driver_history',known:op.known,total:other.length,asOf:cutoffIso,version}),top3_association_delta_vs_other_drivers:personEvidence({value:top3Delta,source:'driver_horse_vs_other_drivers',known:tp.known,total:together.length,asOf:cutoffIso,version}),
    together_gallop_rate:personEvidence({value:tg.rate,source:'driver_horse_together_history',known:tg.known,total:together.length,asOf:cutoffIso,version}),other_driver_gallop_rate:personEvidence({value:og.rate,source:'same_horse_other_driver_history',known:og.known,total:other.length,asOf:cutoffIso,version}),gallop_association_delta_vs_other_drivers:personEvidence({value:gallopDelta,source:'driver_horse_vs_other_drivers',known:tg.known,total:together.length,asOf:cutoffIso,version}),together_disqualification_rate:personEvidence({value:td.rate,source:'driver_horse_together_history',known:td.known,total:together.length,asOf:cutoffIso,version}),together_xlabs_first200_km_seconds:personEvidence({value:pace,source:'xlabs_driver_horse_history',known:used.length,total:together.length,asOf:cutoffIso,version}),estimates:{shrunk_top3_association_delta:shrinkDelta(top3Delta,tp.known),shrunk_gallop_association_delta:shrinkDelta(gallopDelta,tg.known)},xlabs_source_refs:used.map((row)=>({source_record_id:row.source_record_id,selected_at:row.fetched_at,time_basis:'xlabs_observed_at'}))};
}