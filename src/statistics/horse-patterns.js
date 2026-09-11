function requiredHorseId(value) {
  const id = String(value || '').trim();
  if (!id) throw new Error('horse id is required');
  return id;
}

function dateOnly(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('asOfDate must be YYYY-MM-DD');
  return text;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function paceSeconds(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = /^(\d+)\.(\d{2}),(\d)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 10;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function startPointPattern(rows) {
  if (!rows.length) {
    return {
      current: null,
      previousDifferent: null,
      latestChange: null,
      status: 'unavailable'
    };
  }
  const current = rows[0];
  const previousIndex = rows.findIndex((row) => Number(row.points) !== Number(current.points));
  if (previousIndex < 0) {
    return {
      current: { points: Number(current.points), observedAt: current.observed_at },
      previousDifferent: null,
      latestChange: null,
      status: 'verified'
    };
  }
  const previous = rows[previousIndex];
  const changeObservation = rows[Math.max(0, previousIndex - 1)];
  const delta = Number(current.points) - Number(previous.points);
  return {
    current: { points: Number(current.points), observedAt: current.observed_at },
    previousDifferent: { points: Number(previous.points), observedAt: previous.observed_at },
    latestChange: {
      points: delta,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged',
      observedAt: changeObservation.observed_at
    },
    status: 'verified'
  };
}

function xlabsPattern(rows) {
  const first200 = rows.map((row) => paceSeconds(row.first_200_time));
  const last400 = rows.map((row) => paceSeconds(row.last_400_time));
  const extraDistance = rows.map((row) => row.extra_distance_m == null ? null : Number(row.extra_distance_m));
  return {
    measuredStarts: rows.length,
    openingPace: {
      averageSecondsPerKm: average(first200),
      measurements: first200.filter((value) => value != null).length
    },
    closingPace: {
      averageSecondsPerKm: average(last400),
      measurements: last400.filter((value) => value != null).length
    },
    extraDistance: {
      averageMeters: average(extraDistance),
      measurements: extraDistance.filter((value) => Number.isFinite(value)).length
    },
    sampleLimit: 10,
    status: rows.length ? 'verified_xlabs' : 'unavailable'
  };
}

async function loadPatternRows(env, horseIds, cutoff, historicalOnly) {
  if (!horseIds.length) return { pointsByHorse: new Map(), xlabsByHorse: new Map() };
  const slots = placeholders(horseIds);
  const historyDateCondition = historicalOnly ? 'r.race_date < ?' : 'r.race_date <= ?';
  const [{ results: pointRows }, { results: xlabsRows }] = await Promise.all([
    env.DB.prepare(`
      WITH ranked AS (
        SELECT horse_id, points, observed_at,
               ROW_NUMBER() OVER (
                 PARTITION BY horse_id
                 ORDER BY observed_at DESC, id DESC
               ) AS rn
        FROM horse_start_points
        WHERE horse_id IN (${slots})
          AND substr(observed_at, 1, 10) <= ?
      )
      SELECT horse_id, points, observed_at
      FROM ranked
      WHERE rn <= 50
      ORDER BY horse_id, rn
    `).bind(...horseIds, cutoff).all(),
    env.DB.prepare(`
      WITH latest_x AS (
        SELECT x.*,
               ROW_NUMBER() OVER (
                 PARTITION BY x.race_entry_id
                 ORDER BY sr.fetched_at DESC, x.id DESC
               ) AS observation_rank
        FROM xlabs_data x
        JOIN source_records sr ON sr.id = x.source_record_id
        WHERE x.quality_status = 'xlabs-telemetry-v1'
      ), recent AS (
        SELECT re.horse_id, x.first_200_time, x.last_400_time, x.extra_distance_m,
               ROW_NUMBER() OVER (
                 PARTITION BY re.horse_id
                 ORDER BY r.race_date DESC, COALESCE(r.race_number, 0) DESC, re.id DESC
               ) AS recent_rank
        FROM races r
        JOIN race_entries re ON re.race_id = r.id
        JOIN race_results rr ON rr.race_entry_id = re.id
        JOIN latest_x x ON x.race_entry_id = re.id AND x.observation_rank = 1
        WHERE re.horse_id IN (${slots})
          AND re.scratched = 0
          AND rr.result_status = 'official'
          AND ${historyDateCondition}
      )
      SELECT horse_id, first_200_time, last_400_time, extra_distance_m
      FROM recent
      WHERE recent_rank <= 10
      ORDER BY horse_id, recent_rank
    `).bind(...horseIds, cutoff).all()
  ]);

  const pointsByHorse = new Map(horseIds.map((id) => [id, []]));
  for (const row of pointRows || []) pointsByHorse.get(row.horse_id)?.push(row);
  const xlabsByHorse = new Map(horseIds.map((id) => [id, []]));
  for (const row of xlabsRows || []) xlabsByHorse.get(row.horse_id)?.push(row);
  return { pointsByHorse, xlabsByHorse };
}

export async function getHorseRelevantPatternsBatch(env, horseIds, asOfDate, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const cutoff = dateOnly(asOfDate);
  const ids = [...new Set((horseIds || []).map(requiredHorseId))];
  const { pointsByHorse, xlabsByHorse } = await loadPatternRows(env, ids, cutoff, options.historicalOnly === true);
  const result = new Map();
  for (const id of ids) {
    result.set(id, {
      asOfDate: cutoff,
      startPoints: startPointPattern(pointsByHorse.get(id) || []),
      xlabs: xlabsPattern(xlabsByHorse.get(id) || []),
      interpretationRule: 'facts_only'
    });
  }
  return result;
}

export async function getHorseRelevantPatterns(env, horseId, asOfDate) {
  const id = requiredHorseId(horseId);
  const rows = await getHorseRelevantPatternsBatch(env, [id], asOfDate);
  return rows.get(id) || null;
}
