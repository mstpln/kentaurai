import { normalizeRaceScope, raceScopeCondition } from '../race-scope.js';
import { canonicalStartMethodSql, coreMetricSelectSql, mapCoreMetricRow } from '../statistics/core.js';

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

function addPeriodFilter(conditions, bindings, year) {
  if (year == null) return;
  conditions.push('r.race_date >= ? AND r.race_date < ?');
  bindings.push(`${year}-01-01`, `${year + 1}-01-01`);
}

function addMethodFilter(conditions, method) {
  if (!method) return;
  conditions.push(`${canonicalStartMethodSql('r')} = '${method}'`);
}

function addRaceScopeFilter(conditions, scope) {
  const condition = raceScopeCondition(scope);
  if (condition) conditions.push(condition);
}

async function entityExists(env, config, id) {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM ${config.table} WHERE id = ? LIMIT 1`).bind(id).first();
  return Boolean(row?.ok);
}

function mapRows(rows) {
  return rows.map((row) => ({ label: row.label, ...mapCoreMetricRow(row) }));
}

async function groupedRows(env, { relationColumn, id, year, raceScope, method, groupExpression, orderBy, limit = null }) {
  const conditions = [`re.${relationColumn} = ?`, 're.scratched = 0'];
  const bindings = [id];
  addPeriodFilter(conditions, bindings, year);
  addRaceScopeFilter(conditions, raceScope);
  addMethodFilter(conditions, method);
  const sql = `
    SELECT ${groupExpression} AS label,
      ${coreMetricSelectSql('rr')}
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ${groupExpression}
    ORDER BY ${orderBy}
    ${limit == null ? '' : `LIMIT ${Number(limit)}`}
  `;
  const { results } = await env.DB.prepare(sql).bind(...bindings).all();
  return mapRows(results);
}

function emptySummary() {
  return {
    starts: 0,
    resultStarts: 0,
    wins: 0,
    losses: 0,
    seconds: 0,
    thirds: 0,
    top3: 0,
    gallops: 0,
    gallopVerifiedStarts: 0,
    disqualifications: 0,
    prizeVerifiedStarts: 0,
    prizeSek: null,
    winRate: null,
    top3Rate: null,
    gallopRate: null
  };
}

export async function getFilteredEntityStatBreakdowns(env, type, id, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const config = configFor(type);
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  if (!(await entityExists(env, config, normalizedId))) return null;

  const year = parseYear(options.year);
  const raceScope = normalizeRaceScope(options.raceScope);
  const distanceStartMethod = normalizeStartMethod(options.distanceStartMethod);
  const trackStartMethod = normalizeStartMethod(options.trackStartMethod);
  const canonicalMethod = canonicalStartMethodSql('r');

  const [summaryRows, startMethods, distances, tracks] = await Promise.all([
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      raceScope,
      method: null,
      groupExpression: `'all'`,
      orderBy: 'label'
    }),
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      raceScope,
      method: null,
      groupExpression: canonicalMethod,
      orderBy: 'starts DESC, label ASC'
    }),
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      raceScope,
      method: distanceStartMethod,
      groupExpression: `COALESCE(CAST(r.distance_m AS TEXT), 'unknown')`,
      orderBy: 'starts DESC, r.distance_m ASC'
    }),
    groupedRows(env, {
      relationColumn: config.relationColumn,
      id: normalizedId,
      year,
      raceScope,
      method: trackStartMethod,
      groupExpression: `COALESCE(t.canonical_name, 'Okänd bana')`,
      orderBy: 'starts DESC, label COLLATE NOCASE ASC',
      limit: 50
    })
  ]);

  const summary = summaryRows[0] ? { ...summaryRows[0] } : emptySummary();
  delete summary.label;

  return {
    filters: {
      year,
      raceScope,
      distanceStartMethod: distanceStartMethod || 'all',
      trackStartMethod: trackStartMethod || 'all'
    },
    summary,
    startMethods,
    distances,
    tracks
  };
}
