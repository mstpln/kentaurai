import { PERSON_CONTEXT_DAY_MS, personContextInstant } from './person-context-time.js';
const CHUNK=80;
function ph(values){return values.map(()=>'?').join(',');}

export async function loadHorsePersonHistories(env,horseIds,cutoffValue){
  const ids=[...new Set((horseIds||[]).filter(Boolean))];
  const out=new Map(ids.map((id)=>[id,[]]));
  if(!ids.length)return out;
  const cutoff=personContextInstant(cutoffValue),lower=new Date(cutoff.ms-365*PERSON_CONTEXT_DAY_MS).toISOString();
  for(let i=0;i<ids.length;i+=CHUNK){
    const group=ids.slice(i,i+CHUNK);
    const {results}=await env.DB.prepare(`SELECT re.id AS race_entry_id,re.race_id,re.horse_id,re.driver_id,re.trainer_id,re.start_tier,re.actual_start_distance_m,r.race_date,r.scheduled_start_at,r.distance_m,r.start_method,r.track_id,rr.placing,rr.gallop,rr.disqualified,rr.source_record_id AS result_source_record_id,sr.fetched_at AS result_observed_at FROM race_entries re JOIN races r ON r.id=re.race_id JOIN race_results rr ON rr.race_entry_id=re.id JOIN source_records sr ON sr.id=rr.source_record_id WHERE re.horse_id IN (${ph(group)}) AND re.scratched=0 AND rr.result_status='official' AND julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59.999Z'))>=julianday(?) AND julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59.999Z'))<julianday(?) AND julianday(sr.fetched_at)<=julianday(?) ORDER BY re.horse_id,COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59.999Z'),re.id`).bind(...group,lower,cutoff.iso,cutoff.iso).all();
    for(const row of results||[]){row.event_ms=Date.parse(row.scheduled_start_at||`${row.race_date}T23:59:59.999Z`);out.get(row.horse_id)?.push(row);}
  }
  return out;
}
