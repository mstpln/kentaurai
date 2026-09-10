const ENTITY_STATS_CONFIG = {
  horses: { table: 'horses', relationColumn: 'horse_id' },
  trainers: { table: 'trainers', relationColumn: 'trainer_id' },
  drivers: { table: 'drivers', relationColumn: 'driver_id' }
};

function configFor(type) {
  const config = ENTITY_STATS_CONFIG[type];
  if (!config) throw new Error('unsupported entity type');
  return config;
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

function addPeriodFilter(conditions, bindings, year) {
  if (year == null) return;
  conditions.push('r.race_date >= ? AND r.race_date < ?');
  bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
}

function addMethodFilter(conditions, method) {
  if (!method) return;
  conditions.push(`${canonicalStartMethodSql()} = '${method}'`);
}

async function entityExists(env, config, id) {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM ${config.table} WHERE id = ? LIMIT 1`).bind(id).first();
  return Boolean(row?.ok);
}

function mapRows(rows) {
  return rows.map((row) => {
    const resultStarts = Number(row.result_starts ?? 0);
    const wins = Number(row.wins ?? 0);
    const top3 = Number(row.top3 ?? 0);
    const gallops = Number(row.gallops ?? 0);
    return {
      label: row.label,
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
}

async function groupedRows(env, { relationColumn, id, year, method, groupExpression, orderBy, limit = null }) {
  const conditions = [`re.${relationColumn} = ?`, 're.scratched = 0'];
  const bindings = [id];
  addPeriodFilter(conditions, bindings, year);
  addMethodFilter(conditions, method);
  const sql = `
    SELECT ${groupExpression} AS label,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN rr.gallop = 1 THEN 1 ELSE 0 END) AS gallops
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ${groupExpression}
    ORDER BY ${orderBy}
    ${limit == null ? '' : `LIMIT ${Number(limit)}`}
  `;
  const { results } = await env.DB.prepare(sql).bind(...bindings).all();
  return mapRows(results);
}

export async function getFilteredEntityStatBreakdowns(env, type, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const config = configFor(type);
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  if (!(await entityExists(env, config, normalizedId))) return null;

  const year = parseYear(options.year);
  const distanceStartMethod = normalizeStartMethod(options.distanceStartMethod);
  const trackStartMethod = normalizeStartMethod(options.trackStartMethod);
  const canonicalMethod = canonicalStartMethodSql();

  const [startMethods, distances, tracks] = await Promise.all([
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      method: null,
      groupExpression: canonicalMethod,
      orderBy: 'starts DESC, label ASC'
    }),
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      method: distanceStartMethod,
      groupExpression: `COALESCE(CAST(r.distance_m AS TEXT), 'unknown')`,
      orderBy: 'starts DESC, r.distance_m ASC'
    }),
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      method: trackStartMethod,
      groupExpression: `COALESCE(t.canonical_name, 'Okänd bana')`,
      orderBy: 'starts DESC, label COLLATE NOCASE ASC',
      limit: 50
    })
  ]);

  return {
    filters: {
      year,
      distanceStartMethod: distanceStartMethod || 'all',
      trackStartMethod: trackStartMethod || 'all'
    },
    startMethods,
    distances,
    tracks
  };
}
