import { getTrackDetail } from './tracks.js';
import {
  matchesRaceClassification,
  normalizeRaceType,
  normalizeStlClass
} from '../race-classification.js';

const STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const OTHER_LONG_DISTANCE_KEY = 'other-long';
const DISTANCE_TOLERANCE_M = 100;

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

function normalizeDistanceGroup(value) {
  const raw = String(value || '2140').trim();
  if (raw === OTHER_LONG_DISTANCE_KEY || raw === 'Övrigt >2640') return OTHER_LONG_DISTANCE_KEY;
  if (STANDARD_DISTANCE_GROUPS.some((distance) => String(distance) === raw)) return raw;
  throw new Error('unsupported distance group');
}

function distanceCondition(group, bindings) {
  if (group === OTHER_LONG_DISTANCE_KEY) {
    const excluded = STANDARD_DISTANCE_GROUPS.filter((distance) => distance >= 2640);
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

function safeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWebsiteUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getTrackDetailV064(env, id) {
  const detail = await getTrackDetail(env, id);
  if (!detail) return null;
  const metadata = await env.DB.prepare(`
    SELECT street_address, postal_code, website_url
    FROM tracks WHERE id = ? LIMIT 1
  `).bind(id).first();
  return {
    ...detail,
    address: {
      street: metadata?.street_address || null,
      postalCode: metadata?.postal_code || null
    },
    websiteUrl: safeWebsiteUrl(metadata?.website_url)
  };
}

export async function getTrackLaneStatsV064(env, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const trackId = String(id || '').trim();
  if (!trackId) return null;
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
  if (!exists?.ok) return null;

  const year = parseYear(options.year);
  const startMethod = normalizeStartMethod(options.startMethod);
  const distanceGroup = normalizeDistanceGroup(options.distanceGroup);
  const stlClass = normalizeStlClass(options.stlClass);
  const raceType = normalizeRaceType(options.raceType);
  if (options.stlClass && options.stlClass !== 'all' && !stlClass) throw new Error('unsupported STL class');
  if (options.raceType && options.raceType !== 'all' && !raceType) throw new Error('unsupported race type');

  const conditions = [
    'r.track_id = ?',
    're.scratched = 0',
    're.actual_lane IS NOT NULL',
    're.actual_lane > 0',
    `${canonicalStartMethodSql()} = ?`
  ];
  const bindings = [trackId, startMethod];
  if (year != null) {
    conditions.push('r.race_date >= ? AND r.race_date < ?');
    bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
  }
  conditions.push(distanceCondition(distanceGroup, bindings));

  const { results } = await env.DB.prepare(`
    SELECT
      r.id AS race_id,
      r.race_name,
      r.main_class,
      r.class_flags_json,
      re.actual_lane AS lane,
      rr.race_entry_id AS result_entry_id,
      rr.placing,
      rr.gallop
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY re.actual_lane ASC, r.race_date ASC, r.id ASC, re.id ASC
  `).bind(...bindings).all();

  const grouped = new Map();
  for (const row of results || []) {
    const race = {
      raceName: row.race_name || null,
      mainClass: row.main_class || null,
      classFlags: safeJsonArray(row.class_flags_json)
    };
    if (!matchesRaceClassification(race, { stlClass, raceType })) continue;
    const lane = Number(row.lane);
    if (!grouped.has(lane)) grouped.set(lane, { lane, starts: 0, resultStarts: 0, wins: 0, top3: 0, gallops: 0 });
    const bucket = grouped.get(lane);
    bucket.starts += 1;
    if (row.result_entry_id) {
      bucket.resultStarts += 1;
      if (Number(row.placing) === 1) bucket.wins += 1;
      if (Number(row.placing) >= 1 && Number(row.placing) <= 3) bucket.top3 += 1;
      if (Number(row.gallop) === 1) bucket.gallops += 1;
    }
  }

  const rows = [...grouped.values()].sort((a, b) => a.lane - b.lane).map((row) => ({
    ...row,
    winRate: row.resultStarts ? row.wins / row.resultStarts : null,
    top3Rate: row.resultStarts ? row.top3 / row.resultStarts : null,
    gallopRate: row.resultStarts ? row.gallops / row.resultStarts : null
  }));

  return {
    filters: { year, startMethod, distanceGroup, stlClass, raceType },
    totals: {
      starts: rows.reduce((sum, row) => sum + row.starts, 0),
      resultStarts: rows.reduce((sum, row) => sum + row.resultStarts, 0)
    },
    rows
  };
}
