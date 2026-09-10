const STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const OTHER_LONG_DISTANCE_KEY = 'other-long';
const DISTANCE_TOLERANCE_M = 100;

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000);
}

function sanitizeQuery(value) {
  return String(value || '').trim().slice(0, 80);
}

function escapedLike(value) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function parseYear(value) {
  if (value == null || value === '' || value === 'all') return null;
  const text = String(value).trim();
  if (!/^\d{4}$/.test(text)) throw new Error('year must be all or a four-digit year');
  const year = Number(text);
  if (year < 1900 || year > 2200) throw new Error('year is outside the supported range');
  return year;
}

function normalizeStartMethod(value) {
  const method = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'autostart'].includes(method)) return 'auto';
  if (['volt', 'volte', 'voltstart'].includes(method)) return 'volt';
  throw new Error('start method must be auto or volt');
}

function canonicalStartMethodSql() {
  return `CASE
    WHEN LOWER(COALESCE(r.start_method, '')) IN ('auto','autostart') THEN 'auto'
    WHEN LOWER(COALESCE(r.start_method, '')) IN ('volt','volte','voltstart') THEN 'volt'
    WHEN r.start_method IS NULL OR TRIM(r.start_method) = '' THEN 'unknown'
    ELSE LOWER(r.start_method)
  END`;
}

export function trackDistanceGroup(value) {
  if (value === null || value === undefined || value === '') return null;
  const distance = Number(value);
  if (!Number.isFinite(distance)) return null;
  for (const standard of STANDARD_DISTANCE_GROUPS) {
    if (Math.abs(distance - standard) <= DISTANCE_TOLERANCE_M) return String(standard);
  }
  if (distance > 2640) return OTHER_LONG_DISTANCE_KEY;
  return String(Math.round(distance));
}

function normalizeDistanceGroup(value) {
  const raw = String(value || '2140').trim();
  if (raw === OTHER_LONG_DISTANCE_KEY || raw === 'Övrigt >2640') return OTHER_LONG_DISTANCE_KEY;
  if (STANDARD_DISTANCE_GROUPS.some((distance) => String(distance) === raw)) return raw;
  throw new Error('unsupported distance group');
}

function distanceCondition(group, bindings) {
  if (group === OTHER_LONG_DISTANCE_KEY) {
    const excluded = STANDARD_DISTANCE_GROUPS.filter((distance) => distance > 2640);
    let sql = 'r.distance_m > 2640';
    for (const distance of excluded) {
      sql += ' AND NOT (r.distance_m BETWEEN ? AND ?)';
      bindings.push(distance - DISTANCE_TOLERANCE_M, distance + DISTANCE_TOLERANCE_M);
    }
    return sql;
  }
  const distance = Number(group);
  bindings.push(distance - DISTANCE_TOLERANCE_M, distance + DISTANCE_TOLERANCE_M);
  return 'r.distance_m BETWEEN ? AND ?';
}

async function trackExists(env, id) {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(id).first();
  return Boolean(row?.ok);
}

function trackDescription(track) {
  const sentences = [];
  if (track.city) sentences.push(`${track.canonical_name} ligger i ${track.city}.`);
  const dimensions = [];
  if (track.lap_length_m != null) dimensions.push(`banlängd ${Number(track.lap_length_m)} m`);
  if (track.home_stretch_m != null) dimensions.push(`upplopp ${Number(track.home_stretch_m)} m`);
  if (track.curve_radius_m != null) dimensions.push(`kurvradie ${Number(track.curve_radius_m)} m`);
  if (track.width_m != null) dimensions.push(`banbredd ${Number(track.width_m)} m`);
  if (dimensions.length) sentences.push(`Verifierade mått: ${dimensions.join(', ')}.`);
  if (Number(track.open_stretch_lanes || 0) > 0) sentences.push(`Banan har ${Number(track.open_stretch_lanes)} open-stretch-spår.`);
  if (track.angled_mobile_wing === 1) sentences.push('Startbilen har vinklad vinge.');
  if (track.track_notes) sentences.push(String(track.track_notes).trim());
  return sentences.join(' ') || 'Faktaunderlaget för banprofilen är ännu begränsat. KentaurAI visar bara verifierade lagrade uppgifter.';
}

function mapDistanceGroups(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = trackDistanceGroup(row.distance_m);
    if (!key) continue;
    grouped.set(key, (grouped.get(key) || 0) + Number(row.starts || 0));
  }
  const order = [...STANDARD_DISTANCE_GROUPS.map(String), OTHER_LONG_DISTANCE_KEY];
  return order
    .filter((key) => grouped.has(key))
    .map((key) => ({
      key,
      label: key === OTHER_LONG_DISTANCE_KEY ? 'Övrigt >2640' : `${key} m`,
      starts: grouped.get(key)
    }));
}

export async function listTracks(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const q = sanitizeQuery(options.q);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const like = escapedLike(q);
  const filter = q ? `WHERE t.canonical_name LIKE ? ESCAPE '\\' OR COALESCE(t.city, '') LIKE ? ESCAPE '\\'` : '';
  const list = env.DB.prepare(`
    SELECT t.id, t.canonical_name AS name, t.city, t.country_code,
      (SELECT COUNT(*) FROM races r WHERE r.track_id = t.id) AS races
    FROM tracks t
    ${filter}
    ORDER BY t.canonical_name COLLATE NOCASE ASC, t.id ASC
    LIMIT ? OFFSET ?
  `);
  const count = env.DB.prepare(`SELECT COUNT(*) AS total FROM tracks t ${filter}`);
  const [{ results }, countRow] = q
    ? await Promise.all([list.bind(like, like, limit, offset).all(), count.bind(like, like).first()])
    : await Promise.all([list.bind(limit, offset).all(), count.first()]);
  const total = Number(countRow?.total ?? 0);
  return {
    items: (results || []).map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      countryCode: row.country_code,
      races: Number(row.races ?? 0)
    })),
    total,
    limit,
    offset,
    hasMore: offset + (results?.length || 0) < total
  };
}

export async function getTrackDetail(env, id) {
  if (!env.DB) throw new Error('DB is not configured');
  const trackId = String(id || '').trim();
  if (!trackId) return null;
  const track = await env.DB.prepare(`
    SELECT id, canonical_name, city, country_code, lap_length_m, home_stretch_m,
      curve_radius_m, banking_degrees, width_m, surface, open_stretch_lanes,
      angled_mobile_wing, start_notes, track_notes
    FROM tracks WHERE id = ? LIMIT 1
  `).bind(trackId).first();
  if (!track) return null;

  const [summary, distanceRows, homeTrainerCountRow] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(DISTINCT r.id) AS races,
        COUNT(DISTINCT CASE WHEN rr.race_entry_id IS NOT NULL THEN r.id END) AS races_with_results,
        SUM(CASE WHEN re.scratched = 0 THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN re.scratched = 0 AND rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
        MIN(r.race_date) AS first_race_date,
        MAX(r.race_date) AS last_race_date
      FROM races r
      LEFT JOIN race_entries re ON re.race_id = r.id
      LEFT JOIN race_results rr ON rr.race_entry_id = re.id
      WHERE r.track_id = ?
    `).bind(trackId).first(),
    env.DB.prepare(`
      SELECT r.distance_m, COUNT(*) AS starts
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      WHERE r.track_id = ? AND re.scratched = 0 AND r.distance_m IS NOT NULL
      GROUP BY r.distance_m
      ORDER BY r.distance_m ASC
    `).bind(trackId).all(),
    countHomeTrainers(env, trackId, track.canonical_name)
  ]);

  return {
    id: track.id,
    name: track.canonical_name,
    city: track.city,
    countryCode: track.country_code,
    description: trackDescription(track),
    profile: {
      lapLengthM: track.lap_length_m == null ? null : Number(track.lap_length_m),
      homeStretchM: track.home_stretch_m == null ? null : Number(track.home_stretch_m),
      curveRadiusM: track.curve_radius_m == null ? null : Number(track.curve_radius_m),
      bankingDegrees: track.banking_degrees == null ? null : Number(track.banking_degrees),
      widthM: track.width_m == null ? null : Number(track.width_m),
      surface: track.surface,
      openStretchLanes: track.open_stretch_lanes == null ? null : Number(track.open_stretch_lanes),
      angledMobileWing: track.angled_mobile_wing == null ? null : Boolean(track.angled_mobile_wing),
      startNotes: track.start_notes,
      trackNotes: track.track_notes
    },
    coverage: {
      races: Number(summary?.races ?? 0),
      racesWithResults: Number(summary?.races_with_results ?? 0),
      starts: Number(summary?.starts ?? 0),
      resultStarts: Number(summary?.result_starts ?? 0),
      firstRaceDate: summary?.first_race_date || null,
      lastRaceDate: summary?.last_race_date || null,
      homeTrainers: Number(homeTrainerCountRow?.total ?? 0)
    },
    distanceGroups: mapDistanceGroups(distanceRows?.results || [])
  };
}

function homeTrainerCte() {
  return `
    WITH latest_trainer_observation AS (
      SELECT o.entity_id AS trainer_id, o.fields_json,
        ROW_NUMBER() OVER (
          PARTITION BY o.entity_id
          ORDER BY o.observed_at DESC, o.created_at DESC, o.id DESC
        ) AS row_number
      FROM normalized_observations o
      JOIN source_records sr ON sr.id = o.source_record_id
      WHERE o.entity_type = 'trainer' AND sr.source_type = 'official_provider'
    ), official_track_ids AS (
      SELECT external_id FROM track_external_ids
      WHERE track_id = ? AND source_type = 'official'
    )
  `;
}

async function countHomeTrainers(env, trackId, trackName) {
  return env.DB.prepare(`${homeTrainerCte()}
    SELECT COUNT(*) AS total
    FROM latest_trainer_observation o
    JOIN trainers tr ON tr.id = o.trainer_id
    WHERE o.row_number = 1
      AND json_valid(o.fields_json)
      AND (
        CAST(json_extract(o.fields_json, '$.homeTrackExternalId') AS TEXT) IN (SELECT external_id FROM official_track_ids)
        OR (
          json_extract(o.fields_json, '$.homeTrackExternalId') IS NULL
          AND LOWER(TRIM(COALESCE(json_extract(o.fields_json, '$.homeTrackName'), ''))) = LOWER(TRIM(?))
        )
      )
  `).bind(trackId, trackName).first();
}

export async function getTrackHomeTrainers(env, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const trackId = String(id || '').trim();
  if (!trackId) return null;
  const track = await env.DB.prepare('SELECT canonical_name FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
  if (!track) return null;
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const countRow = await countHomeTrainers(env, trackId, track.canonical_name);
  const { results } = await env.DB.prepare(`${homeTrainerCte()}
    SELECT tr.id, tr.canonical_name AS name,
      json_extract(o.fields_json, '$.location') AS location
    FROM latest_trainer_observation o
    JOIN trainers tr ON tr.id = o.trainer_id
    WHERE o.row_number = 1
      AND json_valid(o.fields_json)
      AND (
        CAST(json_extract(o.fields_json, '$.homeTrackExternalId') AS TEXT) IN (SELECT external_id FROM official_track_ids)
        OR (
          json_extract(o.fields_json, '$.homeTrackExternalId') IS NULL
          AND LOWER(TRIM(COALESCE(json_extract(o.fields_json, '$.homeTrackName'), ''))) = LOWER(TRIM(?))
        )
      )
    ORDER BY tr.canonical_name COLLATE NOCASE ASC, tr.id ASC
    LIMIT ? OFFSET ?
  `).bind(trackId, track.canonical_name, limit, offset).all();
  const total = Number(countRow?.total ?? 0);
  return {
    trackId,
    items: (results || []).map((row) => ({ id: row.id, name: row.name, location: row.location || null })),
    total,
    limit,
    offset,
    hasMore: offset + (results?.length || 0) < total
  };
}

export async function getTrackLaneStats(env, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const trackId = String(id || '').trim();
  if (!trackId || !(await trackExists(env, trackId))) return null;
  const year = parseYear(options.year);
  const startMethod = normalizeStartMethod(options.startMethod);
  const distanceGroup = normalizeDistanceGroup(options.distanceGroup);
  const conditions = ['r.track_id = ?', 're.scratched = 0', 're.actual_lane IS NOT NULL', 're.actual_lane > 0'];
  const bindings = [trackId];
  if (year != null) {
    conditions.push('r.race_date >= ? AND r.race_date < ?');
    bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
  }
  conditions.push(`${canonicalStartMethodSql()} = ?`);
  bindings.push(startMethod);
  conditions.push(distanceCondition(distanceGroup, bindings));
  const { results } = await env.DB.prepare(`
    SELECT re.actual_lane AS lane,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN rr.gallop = 1 THEN 1 ELSE 0 END) AS gallops
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY re.actual_lane
    ORDER BY re.actual_lane ASC
  `).bind(...bindings).all();
  const rows = (results || []).map((row) => {
    const resultStarts = Number(row.result_starts ?? 0);
    const wins = Number(row.wins ?? 0);
    const top3 = Number(row.top3 ?? 0);
    const gallops = Number(row.gallops ?? 0);
    return {
      lane: Number(row.lane),
      starts: Number(row.starts ?? 0),
      resultStarts,
      wins,
      top3,
      gallops,
      winRate: resultStarts ? wins / resultStarts : null,
      top3Rate: resultStarts ? top3 / resultStarts : null,
      gallopRate: resultStarts ? gallops / resultStarts : null
    };
  });
  return {
    filters: { year, startMethod, distanceGroup },
    totals: {
      starts: rows.reduce((sum, row) => sum + row.starts, 0),
      resultStarts: rows.reduce((sum, row) => sum + row.resultStarts, 0)
    },
    rows
  };
}

export const TRACK_STANDARD_DISTANCE_GROUPS = STANDARD_DISTANCE_GROUPS;
export const TRACK_OTHER_LONG_DISTANCE_KEY = OTHER_LONG_DISTANCE_KEY;
