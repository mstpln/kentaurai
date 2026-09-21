const PROFILE_FACT_TYPES = new Set([
  'lap_length_m',
  'home_stretch_m',
  'open_stretch_lanes',
  'angled_mobile_wing',
  'width_1640_m',
  'width_2140_m',
  'large_curve_radius_m',
  'first_turn_radius_m',
  'second_turn_radius_m',
  'first_turn_banking_percent',
  'second_turn_banking_percent'
]);

const SOURCE_TYPES = new Set(['official_track','official_sport','measurement','secondary','calculation']);
const EVIDENCE_TYPES = new Set(['verified','calculated']);
const START_METHODS = new Set(['auto','volt','unknown']);

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function profileFactNumber(type, value, label) {
  const number = finiteNumber(value, label);
  if (type === 'open_stretch_lanes') {
    if (!Number.isInteger(number) || number < 0 || number > 2) throw new Error(`${label} must be 0, 1 or 2`);
    return number;
  }
  if (type === 'angled_mobile_wing') {
    if (number !== 0 && number !== 1) throw new Error(`${label} must be 0 or 1`);
    return number;
  }
  if (number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function httpsUrl(value, label) {
  const raw = text(value);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must be a valid HTTPS URL`);
  return url.toString();
}

function isoTime(value, label) {
  const raw = text(value);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO date/time`);
  return date.toISOString();
}

function isoDate(value, label) {
  const raw = text(value);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return raw;
}

function evidenceType(value) {
  const result = text(value);
  if (!EVIDENCE_TYPES.has(result)) throw new Error('evidence_type must be verified or calculated');
  return result;
}

function sourceFor(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label}.source is required`);
  const type = text(value.type);
  if (!SOURCE_TYPES.has(type)) throw new Error(`${label}.source.type is unsupported`);
  const url = httpsUrl(value.url, `${label}.source.url`);
  if (!url) throw new Error(`${label}.source.url is required`);
  return { sourceType:type, sourceUrl:url };
}

function calculationNote(item, type, label) {
  const note = text(item.calculation_note);
  if (type === 'calculated' && !note) throw new Error(`${label}.calculation_note is required for calculated values`);
  return note;
}

async function digestId(prefix, parts) {
  const bytes = new TextEncoder().encode(parts.map((value) => value ?? '').join('\u001f'));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `${prefix}-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sameLayoutSql() {
  return "COALESCE(layout_effective_from, '') = COALESCE(?, '')";
}

async function profileFactStatus(env, trackId, factType, layoutEffectiveFrom, value) {
  const row = await env.DB.prepare(`
    SELECT numeric_value
    FROM track_profile_fact_observations
    WHERE track_id = ? AND fact_type = ? AND status = 'active' AND ${sameLayoutSql()}
    ORDER BY CASE evidence_type WHEN 'verified' THEN 0 ELSE 1 END, verified_at DESC, id DESC
    LIMIT 1
  `).bind(trackId, factType, layoutEffectiveFrom).first();
  if (!row) return 'active';
  return Number(row.numeric_value) === Number(value) ? 'active' : 'conflict';
}

async function firstTurnStatus(env, trackId, distanceM, startMethod, layoutEffectiveFrom, value) {
  const row = await env.DB.prepare(`
    SELECT distance_to_first_turn_m
    FROM track_first_turn_distances
    WHERE track_id = ? AND race_distance_m = ? AND start_method = ? AND status = 'active'
      AND ${sameLayoutSql()}
    ORDER BY CASE evidence_type WHEN 'verified' THEN 0 ELSE 1 END, verified_at DESC, id DESC
    LIMIT 1
  `).bind(trackId, distanceM, startMethod, layoutEffectiveFrom).first();
  if (!row) return 'active';
  return Number(row.distance_to_first_turn_m) === Number(value) ? 'active' : 'conflict';
}

export async function listTrackProfileTargets(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const { results } = await env.DB.prepare(`
    SELECT id, canonical_name AS name, city, country_code,
      lap_length_m, home_stretch_m, open_stretch_lanes, angled_mobile_wing
    FROM tracks
    ORDER BY canonical_name COLLATE NOCASE, id
  `).all();
  return { items:results || [], total:(results || []).length };
}

export async function applyTrackProfileEnrichment(env, payload) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!payload || !Array.isArray(payload.tracks) || payload.tracks.length < 1 || payload.tracks.length > 100) {
    throw new Error('tracks must contain between 1 and 100 items');
  }

  const summary = { tracks:0, profileFacts:0, firstTurnDistances:0, conflicts:0, results:[] };
  for (const raw of payload.tracks) {
    const trackId = text(raw?.track_id);
    if (!trackId) throw new Error('track_id is required');
    const track = await env.DB.prepare('SELECT id, canonical_name FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
    if (!track) throw new Error(`unknown track_id: ${trackId}`);
    const expectedName = text(raw.canonical_name);
    if (expectedName && expectedName !== track.canonical_name) throw new Error(`canonical_name mismatch for track_id: ${trackId}`);

    const verifiedAt = isoTime(raw.verified_at, 'verified_at');
    const layoutEffectiveFrom = isoDate(raw.layout_effective_from, 'layout_effective_from');
    const facts = Array.isArray(raw.facts) ? raw.facts : [];
    const firstTurns = Array.isArray(raw.first_turn_distances) ? raw.first_turn_distances : [];
    if (!facts.length && !firstTurns.length) throw new Error('each track must contain facts or first_turn_distances');

    const result = { trackId, name:track.canonical_name, profileFacts:0, firstTurnDistances:0, conflicts:0 };

    for (const item of facts) {
      const factType = text(item?.type);
      if (!PROFILE_FACT_TYPES.has(factType)) throw new Error(`unsupported track profile fact type: ${factType || 'missing'}`);
      const value = profileFactNumber(factType, item.value, `facts.${factType}.value`);
      const type = evidenceType(item.evidence_type);
      const source = sourceFor(item.source, `facts.${factType}`);
      const note = calculationNote(item, type, `facts.${factType}`);
      const status = await profileFactStatus(env, trackId, factType, layoutEffectiveFrom, value);
      const id = await digestId('track-profile', [trackId,factType,value,type,source.sourceType,source.sourceUrl,verifiedAt,layoutEffectiveFrom]);
      await env.DB.prepare(`
        INSERT INTO track_profile_fact_observations (
          id, track_id, fact_type, numeric_value, evidence_type, source_type, source_url,
          verified_at, layout_effective_from, status, calculation_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          verified_at = excluded.verified_at,
          status = excluded.status,
          calculation_note = excluded.calculation_note,
          updated_at = CURRENT_TIMESTAMP
      `).bind(id,trackId,factType,value,type,source.sourceType,source.sourceUrl,verifiedAt,layoutEffectiveFrom,status,note).run();
      result.profileFacts += 1;
      summary.profileFacts += 1;
      if (status === 'conflict') { result.conflicts += 1; summary.conflicts += 1; }
    }

    for (const item of firstTurns) {
      const distanceM = positiveInteger(item.race_distance_m, 'first_turn_distances.race_distance_m');
      const method = text(item.start_method) || 'unknown';
      if (!START_METHODS.has(method)) throw new Error('first_turn_distances.start_method must be auto, volt or unknown');
      const distanceToTurn = finiteNumber(item.distance_to_first_turn_m, 'first_turn_distances.distance_to_first_turn_m');
      if (distanceToTurn <= 0) throw new Error('first_turn_distances.distance_to_first_turn_m must be a positive number');
      const type = evidenceType(item.evidence_type);
      const source = sourceFor(item.source, 'first_turn_distances');
      const note = calculationNote(item, type, 'first_turn_distances');
      const status = await firstTurnStatus(env, trackId, distanceM, method, layoutEffectiveFrom, distanceToTurn);
      const id = await digestId('track-first-turn', [trackId,distanceM,method,distanceToTurn,type,source.sourceType,source.sourceUrl,verifiedAt,layoutEffectiveFrom]);
      await env.DB.prepare(`
        INSERT INTO track_first_turn_distances (
          id, track_id, race_distance_m, start_method, distance_to_first_turn_m,
          evidence_type, source_type, source_url, verified_at, layout_effective_from,
          status, calculation_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          verified_at = excluded.verified_at,
          status = excluded.status,
          calculation_note = excluded.calculation_note,
          updated_at = CURRENT_TIMESTAMP
      `).bind(id,trackId,distanceM,method,distanceToTurn,type,source.sourceType,source.sourceUrl,verifiedAt,layoutEffectiveFrom,status,note).run();
      result.firstTurnDistances += 1;
      summary.firstTurnDistances += 1;
      if (status === 'conflict') { result.conflicts += 1; summary.conflicts += 1; }
    }

    summary.tracks += 1;
    summary.results.push(result);
  }
  return summary;
}
