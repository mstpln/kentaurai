import { getTrackDetail } from './tracks.js';
import { normalizeRaceType, normalizeStlClass } from '../race-classification.js';
import { normalizeRaceScope, raceScopeCondition } from '../race-scope.js';

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
  const method = String(value || 'all').trim().toLowerCase();
  if (method === 'all') return null;
  if (['auto', 'autostart'].includes(method)) return 'auto';
  if (['volt', 'volte', 'voltstart'].includes(method)) return 'volt';
  throw new Error('start method must be all, auto or volt');
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
  const raceScope = normalizeRaceScope(options.raceScope);
  const stlClass = normalizeStlClass(options.stlClass);
  const raceType = normalizeRaceType(options.raceType);
  if (options.stlClass && options.stlClass !== 'all' && !stlClass) throw new Error('unsupported STL class');
  if (options.raceType && options.raceType !== 'all' && !raceType) throw new Error('unsupported race type');

  const conditions = [
    'r.track_id = ?',
    're.scratched = 0',
    're.actual_lane IS NOT NULL',
    're.actual_lane > 0'
  ];
  const bindings = [trackId];
  if (startMethod) {
    conditions.push(`${canonicalStartMethodSql()} = ?`);
    bindings.push(startMethod);
  }
  if (year != null) {
    conditions.push('r.race_date >= ? AND r.race_date < ?');
    bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
  }
  conditions.push(distanceCondition(distanceGroup, bindings));
  const scopeCondition = raceScopeCondition(raceScope);
  if (scopeCondition) conditions.push(scopeCondition);
  if (stlClass) {
    conditions.push(`EXISTS (
      SELECT 1 FROM race_stl_classifications rsc
      WHERE rsc.race_id = r.id AND rsc.stl_class = ?
    )`);
    bindings.push(stlClass);
  }
  if (raceType) {
    conditions.push(`EXISTS (
      SELECT 1 FROM race_type_classifications rtc
      WHERE rtc.race_id = r.id AND rtc.race_type = ?
    )`);
    bindings.push(raceType);
  }

  const { results } = await env.DB.prepare(`
    SELECT
      re.actual_lane AS lane,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL AND rr.gallop = 1 THEN 1 ELSE 0 END) AS gallops
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY re.actual_lane
    ORDER BY re.actual_lane ASC
  `).bind(...bindings).all();

  const rows = (results || []).map((row) => {
    const resultStarts = Number(row.result_starts || 0);
    const wins = Number(row.wins || 0);
    const top3 = Number(row.top3 || 0);
    const gallops = Number(row.gallops || 0);
    return {
      lane: Number(row.lane),
      starts: Number(row.starts || 0),
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
    filters: { year, startMethod: startMethod || 'all', distanceGroup, raceScope, stlClass, raceType },
    totals: {
      starts: rows.reduce((sum, row) => sum + row.starts, 0),
      resultStarts: rows.reduce((sum, row) => sum + row.resultStarts, 0)
    },
    rows
  };
}
