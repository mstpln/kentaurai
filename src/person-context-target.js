const CHUNK=80;
function ph(values){return values.map(()=>'?').join(',');}

export async function loadPersonContextTargets(env,entryIds){
  const ids=[...new Set(entryIds||[])],out=new Map();
  for(let i=0;i<ids.length;i+=CHUNK){
    const group=ids.slice(i,i+CHUNK);
    const {results}=await env.DB.prepare(`SELECT re.id AS race_entry_id,re.race_id,re.horse_id,re.driver_id,re.trainer_id,re.start_tier,re.actual_start_distance_m,r.race_date,r.scheduled_start_at,r.distance_m,r.start_method,r.track_id FROM race_entries re JOIN races r ON r.id=re.race_id WHERE re.id IN (${ph(group)})`).bind(...group).all();
    for(const row of results||[])out.set(row.race_entry_id,row);
  }
  const missing=ids.filter((id)=>!out.has(id));
  if(missing.length)throw new Error(`target race entries were not found: ${missing.join(', ')}`);
  return out;
}
