import { XLABS_INTERVALS_V2_POLICY, XLABS_INTERVALS_V2_VERSION } from '../xlabs-intervals-v2.js';

function parsePaceSeconds(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s*min\/km$/i, '');
  const match = text.match(/^(\d+)[.:](\d{2})[,.](\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const tenths = Number(match[3]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || !Number.isInteger(tenths) || seconds > 59) return null;
  return (minutes * 60) + seconds + (tenths / 10);
}

function segmentPace(rows, startM, endM) {
  const expectedStarts = [];
  for (let m = startM; m < endM; m += 100) expectedStarts.push(m);
  const byStart = new Map(rows.map((row) => [Number(row.interval_start_m), row]));
  const picked = expectedStarts.map((m) => byStart.get(m)).filter(Boolean);
  if (picked.length !== expectedStarts.length) return null;
  if (picked.some((row) => row.eligibility_status !== 'valid' || !(Number(row.elapsed_ms) > 0) || !(Number(row.measured_distance_m) > 0))) return null;
  const elapsed = picked.reduce((sum, row) => sum + Number(row.elapsed_ms), 0);
  const distance = picked.reduce((sum, row) => sum + Number(row.measured_distance_m), 0);
  return distance > 0 ? (elapsed / 1000) * (1000 / distance) : null;
}

function plausiblePace(value) {
  return Number.isFinite(value) && value * 1000 >= XLABS_INTERVALS_V2_POLICY.minPlausibleKmPaceMs;
}

function best(values) {
  const measured = values.filter((value) => plausiblePace(value));
  return measured.length ? Math.min(...measured) : null;
}

export async function getHorseTopSpeedProfile(env, horseId, asOfDate) {
  const asOf = String(asOfDate || '').slice(0, 10);
  const { results: intervalRows } = await env.DB.prepare(`
    WITH source_candidates AS (
      SELECT xi.race_entry_id, xi.source_record_id, sr.fetched_at
      FROM xlabs_intervals xi
      JOIN source_records sr ON sr.id = xi.source_record_id
      JOIN race_entries re ON re.id = xi.race_entry_id
      JOIN races r ON r.id = re.race_id
      WHERE re.horse_id = ?
        AND re.scratched = 0
        AND xi.mapper_version = ?
        AND sr.source_type = 'xlabs_race_json'
        AND substr(sr.fetched_at,1,10) <= ?
      GROUP BY xi.race_entry_id, xi.source_record_id, sr.fetched_at
    ),
    ranked_sources AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY race_entry_id
        ORDER BY julianday(fetched_at) DESC, source_record_id DESC
      ) rn
      FROM source_candidates
    )
    SELECT xi.race_entry_id, xi.interval_start_m, xi.interval_end_m, xi.elapsed_ms,
           xi.measured_distance_m, xi.eligibility_status
    FROM ranked_sources rs
    JOIN xlabs_intervals xi
      ON xi.race_entry_id = rs.race_entry_id
     AND xi.source_record_id = rs.source_record_id
     AND xi.mapper_version = ?
    WHERE rs.rn = 1
    ORDER BY xi.race_entry_id, xi.interval_start_m
  `).bind(horseId, XLABS_INTERVALS_V2_VERSION, asOf, XLABS_INTERVALS_V2_VERSION).all();

  const { results: wholeRows } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT x.race_entry_id, x.last_400_time, x.last_1000_time,
        ROW_NUMBER() OVER (
          PARTITION BY x.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC, x.source_record_id DESC
        ) rn
      FROM xlabs_data x
      JOIN source_records sr ON sr.id = x.source_record_id
      JOIN race_entries re ON re.id = x.race_entry_id
      WHERE re.horse_id = ?
        AND re.scratched = 0
        AND x.quality_status = 'xlabs-telemetry-v1'
        AND sr.source_type = 'xlabs_race_json'
        AND substr(sr.fetched_at,1,10) <= ?
    )
    SELECT race_entry_id, last_400_time, last_1000_time
    FROM ranked
    WHERE rn = 1
  `).bind(horseId, asOf).all();

  const byEntry = new Map();
  for (const row of intervalRows || []) {
    if (!byEntry.has(row.race_entry_id)) byEntry.set(row.race_entry_id, []);
    byEntry.get(row.race_entry_id).push(row);
  }

  const first100 = [];
  const first200 = [];
  const first500 = [];
  for (const rows of byEntry.values()) {
    const p100 = segmentPace(rows, 0, 100);
    const p200 = segmentPace(rows, 0, 200);
    const p500 = segmentPace(rows, 0, 500);
    if (plausiblePace(p100)) first100.push(p100);
    if (plausiblePace(p200)) first200.push(p200);
    if (plausiblePace(p500)) first500.push(p500);
  }

  const last400 = [];
  const last1000 = [];
  for (const row of wholeRows || []) {
    const p400 = parsePaceSeconds(row.last_400_time);
    const p1000 = parsePaceSeconds(row.last_1000_time);
    if (plausiblePace(p400)) last400.push(p400);
    if (plausiblePace(p1000)) last1000.push(p1000);
  }

  return {
    asOf,
    first100: { bestSecondsPerKm: best(first100), measurements: first100.length },
    first200: { bestSecondsPerKm: best(first200), measurements: first200.length },
    first500: { bestSecondsPerKm: best(first500), measurements: first500.length },
    last400: { bestSecondsPerKm: best(last400), measurements: last400.length },
    last1000: { bestSecondsPerKm: best(last1000), measurements: last1000.length }
  };
}
