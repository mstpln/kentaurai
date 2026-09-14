export async function loadPersonContextTarget(env, entryId) {
  const row = await env.DB.prepare(`
    SELECT re.id AS race_entry_id,re.race_id,re.horse_id,re.driver_id,re.trainer_id,re.start_tier,re.actual_start_distance_m,
      r.race_date,r.scheduled_start_at,r.distance_m,r.start_method,r.track_id
    FROM race_entries re JOIN races r ON r.id=re.race_id WHERE re.id=? LIMIT 1
  `).bind(entryId).first();
  if (!row) throw new Error(`target race entry was not found: ${entryId}`);
  return row;
}
