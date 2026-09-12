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

function sortStartMethods(rows) {
  return rows.sort((a, b) => b.starts - a.starts || String(a.label).localeCompare(String(b.label)));
}

function sortDistances(rows) {
  return rows.sort((a, b) => {
    if (b.starts !== a.starts) return b.starts - a.starts;
    const left = Number(a.label);
    const right = Number(b.label);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    if (Number.isFinite(left)) return -1;
    if (Number.isFinite(right)) return 1;
    return String(a.label).localeCompare(String(b.label));
  });
}

function sortTracks(rows) {
  return rows.sort((a, b) => b.starts - a.starts || String(a.label).localeCompare(String(b.label), 'sv', { sensitivity: 'base' })).slice(0, 50);
}

async function loadBreakdownRows(env, { relationColumn, id, year, raceScope, distanceStartMethod, trackStartMethod }) {
  const conditions = [`re.${relationColumn} = ?`, 're.scratched = 0'];
  const bindings = [id];
  addPeriodFilter(conditions, bindings, year);
  addRaceScopeFilter(conditions, raceScope);

  const canonicalMethod = canonicalStartMethodSql('r');
  const metricSql = coreMetricSelectSql('f');
  const sql = `
    WITH filtered AS MATERIALIZED (
      SELECT
        rr.race_entry_id,
        rr.placing,
        rr.gallop,
        rr.disqualified,
        rr.prize_sek,
        r.distance_m,
        ${canonicalMethod} AS start_method_group,
        COALESCE(t.canonical_name, 'Okänd bana') AS track_label
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      LEFT JOIN tracks t ON t.id = r.track_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      WHERE ${conditions.join(' AND ')}
    )
    SELECT 'summary' AS section, 'all' AS label, ${metricSql}
    FROM filtered f
    UNION ALL
    SELECT 'method' AS section, f.start_method_group AS label, ${metricSql}
    FROM filtered f
    GROUP BY f.start_method_group
    UNION ALL
    SELECT 'distance' AS section, COALESCE(CAST(f.distance_m AS TEXT), 'unknown') AS label, ${metricSql}
    FROM filtered f
    WHERE (? = 'all' OR f.start_method_group = ?)
    GROUP BY f.distance_m
    UNION ALL
    SELECT 'track' AS section, f.track_label AS label, ${metricSql}
    FROM filtered f
    WHERE (? = 'all' OR f.start_method_group = ?)
    GROUP BY f.track_label
  `;
  const distanceMethod = distanceStartMethod || 'all';
  const trackMethod = trackStartMethod || 'all';
  const { results } = await env.DB.prepare(sql).bind(
    ...bindings,
    distanceMethod,
    distanceMethod,
    trackMethod,
    trackMethod
  ).all();
  return results || [];
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
  const rows = await loadBreakdownRows(env, {
    relationColumn: config.relationColumn,
    id: normalizedId,
    year,
    raceScope,
    distanceStartMethod,
    trackStartMethod
  });

  const summaryRow = rows.find((row) => row.section === 'summary');
  const summary = summaryRow ? mapCoreMetricRow(summaryRow) : emptySummary();
  const startMethods = sortStartMethods(mapRows(rows.filter((row) => row.section === 'method')));
  const distances = sortDistances(mapRows(rows.filter((row) => row.section === 'distance')));
  const tracks = sortTracks(mapRows(rows.filter((row) => row.section === 'track')));

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
