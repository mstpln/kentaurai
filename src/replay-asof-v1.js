function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function sameScalar(left, right) {
  if (left == null && right == null) return true;
  if (typeof left === 'number' || typeof right === 'number') return finiteOrNull(left) === finiteOrNull(right);
  return String(left) === String(right);
}

function observationBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function requiredInstant(value, field) {
  const ms = Date.parse(String(value ?? ''));
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function parseFields(row) {
  try { return JSON.parse(row?.fields_json || '{}'); } catch { throw new Error('stored normalized observation fields_json is invalid'); }
}

async function canonicalRaceState(env, raceId) {
  const { results } = await env.DB.prepare(`
    SELECT r.id AS race_id,r.race_date,r.race_name,r.distance_m,r.start_method,r.scheduled_start_at,
      (SELECT external_id FROM track_external_ids x WHERE x.track_id=r.track_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS track_external_id,
      re.id AS race_entry_id,re.start_number,re.actual_lane,re.start_tier,re.handicap_m,re.actual_start_distance_m,re.scratched,
      (SELECT external_id FROM horse_external_ids x WHERE x.horse_id=re.horse_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS horse_external_id,
      (SELECT external_id FROM driver_external_ids x WHERE x.driver_id=re.driver_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS driver_external_id,
      (SELECT external_id FROM trainer_external_ids x WHERE x.trainer_id=re.trainer_id AND x.source_type='official' ORDER BY external_id LIMIT 1) AS trainer_external_id
    FROM races r
    JOIN race_entries re ON re.race_id=r.id
    WHERE r.id=?
    ORDER BY re.start_number,re.id
  `).bind(String(raceId)).all();
  return results || [];
}

async function latestObservation(env, entityType, entityId, asOf) {
  const row = await env.DB.prepare(`
    SELECT o.*,sr.fetched_at
    FROM normalized_observations o
    JOIN source_records sr ON sr.id=o.source_record_id
    WHERE o.entity_type=? AND o.entity_id=?
      AND sr.source_type='official_provider'
      AND julianday(o.observed_at)<=julianday(?)
      AND julianday(sr.fetched_at)<=julianday(?)
    ORDER BY julianday(o.observed_at) DESC,o.id DESC
    LIMIT 1
  `).bind(entityType, String(entityId), asOf, asOf).first();
  return row ? { ...row, fields: parseFields(row) } : null;
}

function compareRace(row, observation, mismatches) {
  const fields = observation.fields || {};
  const pairs = [
    ['track_external_id', row.track_external_id || null, fields.trackExternalId == null ? null : String(fields.trackExternalId)],
    ['race_date', row.race_date || null, fields.date || null],
    ['race_name', row.race_name || null, fields.raceName || null],
    ['distance_m', finiteOrNull(row.distance_m), finiteOrNull(fields.distanceM)],
    ['start_method', normalizeMethod(row.start_method), normalizeMethod(fields.startMethod)],
    ['scheduled_start_at', instantOrNull(row.scheduled_start_at), instantOrNull(fields.scheduledStartAt)]
  ];
  for (const [field, canonical, observed] of pairs) {
    if (canonical == null && observed == null) continue;
    if (!sameScalar(canonical, observed)) mismatches.push({ scope: 'race', id: row.race_id, field, canonical, observed });
  }
}

function compareEntry(row, observation, mismatches) {
  const fields = observation.fields || {};
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
  for (const [field, canonical, observed] of pairs) {
    if (!sameScalar(canonical, observed)) mismatches.push({ scope: 'race_entry', id: row.race_entry_id, field, canonical, observed });
  }
  if (fields.scratchSemanticsVerified === true) {
    const canonicalScratch = Number(row.scratched) === 1;
    const observedScratch = observationBoolean(fields.scratched);
    if (canonicalScratch !== observedScratch) {
      mismatches.push({ scope: 'race_entry', id: row.race_entry_id, field: 'scratched', canonical: canonicalScratch, observed: observedScratch });
    }
  }
}

export async function assertRaceTargetStateAsOfV1(env, raceId, forecastAsOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  const asOf = requiredInstant(forecastAsOf, 'forecast_as_of');
  const rows = await canonicalRaceState(env, raceId);
  if (!rows.length) throw new Error('replay target race was not found');

  const raceObservation = await latestObservation(env, 'race', raceId, asOf);
  if (!raceObservation) throw new Error('missing_asof_race_observation');
  const mismatches = [];
  compareRace(rows[0], raceObservation, mismatches);

  for (const row of rows) {
    const observation = await latestObservation(env, 'race_entry', row.race_entry_id, asOf);
    if (!observation) throw new Error(`missing_asof_entry_observation:${row.race_entry_id}`);
    compareEntry(row, observation, mismatches);
  }
  if (mismatches.length) {
    const sample = mismatches.slice(0, 8).map((item) => `${item.scope}:${item.id}:${item.field}`).join(', ');
    throw new Error(`replay_target_state_drift:${sample}`);
  }
  return {
    race_id: String(raceId),
    forecast_as_of: asOf,
    checked_entries: rows.length,
    race_source_record_id: raceObservation.source_record_id,
    race_observed_at: raceObservation.observed_at
  };
}

export async function assertFeatureProvenanceAsOfV1(featureDocument, forecastAsOf) {
  const cutoff = Date.parse(requiredInstant(forecastAsOf, 'forecast_as_of'));
  const violations = [];
  for (const [familyName, family] of Object.entries(featureDocument?.families || {})) {
    for (const ref of family?.provenance?.source_refs || []) {
      const selectedMs = Date.parse(String(ref?.selected_at ?? ''));
      if (!Number.isFinite(selectedMs) || selectedMs > cutoff) {
        violations.push(`${familyName}:${ref?.source_record_id || 'unknown'}:${ref?.selected_at || 'invalid'}`);
      }
    }
    const familyAsOfMs = Date.parse(String(family?.provenance?.as_of ?? ''));
    if (!Number.isFinite(familyAsOfMs) || familyAsOfMs > cutoff) {
      violations.push(`${familyName}:family_as_of:${family?.provenance?.as_of || 'invalid'}`);
    }
  }
  if (violations.length) throw new Error(`future_source_row_in_feature_provenance:${violations.slice(0, 8).join(',')}`);
  return true;
}
