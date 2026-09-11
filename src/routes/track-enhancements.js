import { getTrackDetail, trackDistanceGroup } from './tracks.js';

export const STL_CLASS_OPTIONS = Object.freeze([
  ['class_iii', 'Klass III'],
  ['class_ii', 'Klass II'],
  ['class_i', 'Klass I'],
  ['bronze', 'Bronsdivisionen'],
  ['silver', 'Silverdivisionen'],
  ['gold', 'Gulddivisionen'],
  ['mares', 'Stodivisionen'],
  ['diamond_mares', 'Diamantstoet'],
  ['cold_blood', 'Kallblodsdivisionen']
]);

export const RACE_TYPE_OPTIONS = Object.freeze([
  ['mares', 'Stolopp'],
  ['cold_blood', 'Kallblodslopp'],
  ['lane_ladder', 'Spårtrappa'],
  ['apprentice', 'Lärlingslopp'],
  ['amateur', 'Amatörlopp'],
  ['monte', 'Montélopp'],
  ['young_horse', 'Unghästlopp'],
  ['age_group', 'Årgångslopp'],
  ['stayer', 'Stayerlopp / långlopp'],
  ['sprint', 'Snabblopp'],
  ['advantage', 'Fördelslopp / Fördel ston'],
  ['p21', 'P21-lopp'],
  ['grassroots', 'Breddlopp'],
  ['double_class', 'Dubbelklasslopp']
]);

const STL_KEYS = new Set(STL_CLASS_OPTIONS.map(([key]) => key));
const RACE_TYPE_KEYS = new Set(RACE_TYPE_OPTIONS.map(([key]) => key));
const STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
const OTHER_LONG_DISTANCE_KEY = 'other-long';
const DISTANCE_TOLERANCE_M = 100;

function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseFlags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sourceClassificationText(row) {
  return normalizedText([
    row.main_class,
    row.stl_class,
    ...parseFlags(row.class_flags_json),
    ...parseFlags(row.race_types_json)
  ].filter(Boolean).join(' '));
}

export function classifyStlClass(row) {
  const explicit = normalizedText(row?.stl_class).replaceAll(' ', '_');
  if (STL_KEYS.has(explicit)) return explicit;
  const text = sourceClassificationText(row || {});
  if (!text) return null;
  if (/\bklass\s*iii\b/.test(text)) return 'class_iii';
  if (/\bklass\s*ii\b/.test(text)) return 'class_ii';
  if (/\bklass\s*i\b/.test(text)) return 'class_i';
  if (text.includes('bronsdivision')) return 'bronze';
  if (text.includes('silverdivision')) return 'silver';
  if (text.includes('gulddivision')) return 'gold';
  if (text.includes('stodivision')) return 'mares';
  if (text.includes('diamantsto')) return 'diamond_mares';
  if (text.includes('kallblodsdivision')) return 'cold_blood';
  return null;
}

export function classifyRaceTypes(row) {
  const explicit = parseFlags(row?.race_types_json)
    .map((value) => normalizedText(value).replaceAll(' ', '_'))
    .filter((key) => RACE_TYPE_KEYS.has(key));
  const found = new Set(explicit);
  const text = sourceClassificationText(row || {});
  if (!text) return [...found];
  if (text.includes('stolopp') || text.includes('sto lopp')) found.add('mares');
  if (text.includes('kallblod')) found.add('cold_blood');
  if (text.includes('spartrappa')) found.add('lane_ladder');
  if (text.includes('larlingslopp') || text.includes('larling')) found.add('apprentice');
  if (text.includes('amatorlopp') || text.includes('amator')) found.add('amateur');
  if (text.includes('montelopp') || text.includes('monte')) found.add('monte');
  if (text.includes('unghast')) found.add('young_horse');
  if (text.includes('argangslopp') || text.includes('argang')) found.add('age_group');
  if (text.includes('stayer') || text.includes('langlopp')) found.add('stayer');
  if (text.includes('snabblopp')) found.add('sprint');
  if (text.includes('fordelslopp') || text.includes('fordel ston')) found.add('advantage');
  if (/\bp21\b/.test(text)) found.add('p21');
  if (text.includes('breddlopp') || text.includes('breddplus')) found.add('grassroots');
  if (text.includes('dubbelklass')) found.add('double_class');
  return [...found];
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

function normalizeDistanceGroup(value) {
  const raw = String(value || '2140').trim();
  if (raw === OTHER_LONG_DISTANCE_KEY || raw === 'Övrigt >2640') return OTHER_LONG_DISTANCE_KEY;
  if (STANDARD_DISTANCE_GROUPS.some((distance) => String(distance) === raw)) return raw;
  throw new Error('unsupported distance group');
}

function normalizeOptionalFilter(value, allowed, label) {
  const key = String(value || '').trim();
  if (!key || key === 'all') return null;
  if (!allowed.has(key)) throw new Error(`unsupported ${label}`);
  return key;
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

function startMethodCondition(bindings, method) {
  if (method === 'auto') {
    return "LOWER(COALESCE(r.start_method, '')) IN ('auto','autostart')";
  }
  bindings.push('volt', 'volte', 'voltstart');
  return "LOWER(COALESCE(r.start_method, '')) IN (?,?,?)";
}

function distanceCondition(bindings, group) {
  if (group === OTHER_LONG_DISTANCE_KEY) {
    let sql = 'r.distance_m > 2640';
    for (const standard of STANDARD_DISTANCE_GROUPS.filter((distance) => distance >= 2640)) {
      sql += ' AND NOT (r.distance_m BETWEEN ? AND ?)';
      bindings.push(standard - DISTANCE_TOLERANCE_M, standard + DISTANCE_TOLERANCE_M);
    }
    return sql;
  }
  const standard = Number(group);
  bindings.push(standard - DISTANCE_TOLERANCE_M, standard + DISTANCE_TOLERANCE_M);
  return 'r.distance_m BETWEEN ? AND ?';
}

export async function getEnhancedTrackDetail(env, id) {
  const detail = await getTrackDetail(env, id);
  if (!detail) return null;
  const metadata = await env.DB.prepare(`
    SELECT street_address, postal_code, website_url
    FROM tracks
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
  return {
    ...detail,
    address: {
      street: metadata?.street_address || null,
      postalCode: metadata?.postal_code || null,
      city: detail.city || null
    },
    websiteUrl: safeWebsiteUrl(metadata?.website_url)
  };
}

export async function getEnhancedTrackLaneStats(env, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const track = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(id).first();
  if (!track?.ok) return null;

  const year = parseYear(options.year);
  const startMethod = normalizeStartMethod(options.startMethod);
  const distanceGroup = normalizeDistanceGroup(options.distanceGroup);
  const stlClass = normalizeOptionalFilter(options.stlClass, STL_KEYS, 'STL class');
  const raceType = normalizeOptionalFilter(options.raceType, RACE_TYPE_KEYS, 'race type');

  const conditions = ['r.track_id = ?', 're.scratched = 0', 're.actual_lane IS NOT NULL', 're.actual_lane > 0'];
  const bindings = [id];
  if (year != null) {
    conditions.push('r.race_date >= ? AND r.race_date < ?');
    bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
  }
  conditions.push(startMethodCondition(bindings, startMethod));
  conditions.push(distanceCondition(bindings, distanceGroup));

  const { results } = await env.DB.prepare(`
    SELECT
      r.main_class,
      r.class_flags_json,
      r.stl_class,
      r.race_types_json,
      re.actual_lane AS lane,
      rr.race_entry_id AS result_entry_id,
      rr.placing,
      rr.gallop
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.race_date ASC, r.id ASC, re.actual_lane ASC, re.id ASC
  `).bind(...bindings).all();

  const grouped = new Map();
  for (const row of results || []) {
    if (stlClass && classifyStlClass(row) !== stlClass) continue;
    if (raceType && !classifyRaceTypes(row).includes(raceType)) continue;

    const lane = Number(row.lane);
    if (!grouped.has(lane)) grouped.set(lane, { lane, starts: 0, resultStarts: 0, wins: 0, top3: 0, gallops: 0 });
    const item = grouped.get(lane);
    item.starts += 1;
    if (row.result_entry_id != null) {
      item.resultStarts += 1;
      if (Number(row.placing) === 1) item.wins += 1;
      if (Number(row.placing) >= 1 && Number(row.placing) <= 3) item.top3 += 1;
      if (Number(row.gallop) === 1) item.gallops += 1;
    }
  }

  const rows = [...grouped.values()]
    .sort((a, b) => a.lane - b.lane)
    .map((row) => ({
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
