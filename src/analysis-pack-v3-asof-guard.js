function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameScalar(left, right) {
  if (left == null && right == null) return true;
  if (typeof left === 'number' || typeof right === 'number') return finiteOrNull(left) === finiteOrNull(right);
  return String(left) === String(right);
}

function normalizeMethod(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'auto' || text === 'autostart') return 'auto';
  if (text === 'volt' || text === 'volte' || text === 'voltstart') return 'volte';
  return text;
}

function instantOrNull(value) {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function observationBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function pushMismatch(out, scope, id, field, canonical, observed) {
  out.push({ scope, id, field, canonical: canonical ?? null, observed: observed ?? null });
}

function compareEntry(row, observation, mismatches) {
  const fields = observation?.fields || {};
  const pairs = [
    ['start_number', finiteOrNull(row.start_number), finiteOrNull(fields.startNumber)],
    ['actual_lane', finiteOrNull(row.actual_lane), finiteOrNull(fields.postPosition)],
    ['start_tier', finiteOrNull(row.start_tier), finiteOrNull(fields.startTier)],
    ['handicap_m', finiteOrNull(row.handicap_m), finiteOrNull(fields.handicapM)],
    ['actual_start_distance_m', finiteOrNull(row.actual_start_distance_m), finiteOrNull(fields.actualStartDistanceM)],
    ['horse_external_id', row.horse_external_id || null, fields.horseExternalId == null ? null : String(fields.horseExternalId)],
    ['driver_external_id', row.driver_external_id || null, fields.driverExternalId == null ? null : String(fields.driverExternalId)],
    ['trainer_external_id', row.trainer_external_id || null, fields.trainerExternalId == null ? null : String(fields.trainerExternalId)]
  ];
  for (const [field, canonical, observed] of pairs) if (!sameScalar(canonical, observed)) pushMismatch(mismatches, 'race_entry', row.race_entry_id, field, canonical, observed);
  if (fields.scratchSemanticsVerified === true) {
    const canonicalScratch = row.scratched == null ? null : Number(row.scratched) === 1;
    const observedScratch = observationBoolean(fields.scratched);
    if (canonicalScratch !== observedScratch) pushMismatch(mismatches, 'race_entry', row.race_entry_id, 'scratched', canonicalScratch, observedScratch);
  }
}

function compareRace(row, observation, mismatches) {
  const fields = observation?.fields || {};
  const pairs = [
    ['distance_m', finiteOrNull(row.distance_m), finiteOrNull(fields.distanceM)],
    ['start_method', normalizeMethod(row.start_method), normalizeMethod(fields.startMethod)],
    ['scheduled_start_at', instantOrNull(row.scheduled_start_at), instantOrNull(fields.scheduledStartAt)]
  ];
  for (const [field, canonical, observed] of pairs) {
    if (observed == null && canonical == null) continue;
    if (!sameScalar(canonical, observed)) pushMismatch(mismatches, 'race', row.race_id, field, canonical, observed);
  }
}

export async function assertAnalysisPackTargetStateAsOf(env, roundId, { raceObservations, entryObservations } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!(raceObservations instanceof Map) || !(entryObservations instanceof Map)) throw new Error('as-of observations are required');
  const { results } = await env.DB.prepare(`
    SELECT gl.leg_number,r.id AS race_id,r.distance_m,r.start_method,r.scheduled_start_at,
      re.id AS race_entry_id,re.start_number,re.actual_lane,re.start_tier,re.handicap_m,re.actual_start_distance_m,re.scratched,
      (SELECT external_id FROM horse_external_ids x WHERE x.horse_id=re.horse_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS horse_external_id,
      (SELECT external_id FROM driver_external_ids x WHERE x.driver_id=re.driver_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS driver_external_id,
      (SELECT external_id FROM trainer_external_ids x WHERE x.trainer_id=re.trainer_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS trainer_external_id
    FROM game_legs gl
    JOIN races r ON r.id=gl.race_id
    JOIN race_entries re ON re.race_id=r.id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number,re.start_number,re.id
  `).bind(String(roundId)).all();
  const mismatches = [];
  const seenRaces = new Set();
  for (const row of results || []) {
    const entryObservation = entryObservations.get(String(row.race_entry_id));
    if (!entryObservation) throw new Error(`missing as-of entry observation for ${row.race_entry_id}`);
    compareEntry(row, entryObservation, mismatches);
    if (!seenRaces.has(row.race_id)) {
      seenRaces.add(row.race_id);
      const raceObservation = raceObservations.get(String(row.race_id));
      if (!raceObservation) throw new Error(`missing as-of race observation for ${row.race_id}`);
      compareRace(row, raceObservation, mismatches);
    }
  }
  if (mismatches.length) {
    const sample = mismatches.slice(0, 8).map((item) => `${item.scope}:${item.id}:${item.field}`).join(', ');
    throw new Error(`target canonical state differs from the selected as-of official observations; refusing a potentially contaminated replay (${sample})`);
  }
  return { checked_entries: results.length, checked_races: seenRaces.size };
}
