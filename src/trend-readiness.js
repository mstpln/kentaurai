export const TREND_READINESS_VERSION = 'trend-readiness-v1';

export const TREND_PERIODS = Object.freeze({
  '2w': Object.freeze({ days: 14, label: '2 veckor' }),
  '4w': Object.freeze({ days: 28, label: '4 veckor' }),
  '3m': Object.freeze({ days: 90, label: '3 mån' }),
  '6m': Object.freeze({ days: 180, label: '6 mån' }),
  '1y': Object.freeze({ days: 365, label: '1 år' })
});

export const TREND_MIN_STARTS = Object.freeze({
  horses: Object.freeze({ '2w': 2, '4w': 3, '3m': 5, '6m': 8, '1y': 12 }),
  trainers: Object.freeze({ '2w': 5, '4w': 8, '3m': 20, '6m': 35, '1y': 60 }),
  drivers: Object.freeze({ '2w': 8, '4w': 12, '3m': 30, '6m': 50, '1y': 90 })
});

export const TREND_MIN_ELIGIBLE_ENTITIES = 10;

const ENTITY_COLUMNS = Object.freeze({
  horses: 're.horse_id',
  trainers: 're.trainer_id',
  drivers: 're.driver_id'
});

function dateOnly(value) {
  const text = String(value || '').slice(0, 10);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error('asOf must contain a valid YYYY-MM-DD date');
  }
  return text;
}

function subtractDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days + 1);
  return value.toISOString().slice(0, 10);
}

function policy(entityType, period) {
  const entityColumn = ENTITY_COLUMNS[entityType];
  const periodPolicy = TREND_PERIODS[period];
  const minStarts = TREND_MIN_STARTS[entityType]?.[period];
  if (!entityColumn) throw new Error('entityType must be horses, trainers or drivers');
  if (!periodPolicy || !Number.isInteger(minStarts)) throw new Error('period must be 2w, 4w, 3m, 6m or 1y');
  return { entityColumn, periodPolicy, minStarts };
}

export async function assessTrendReadiness(env, entityType, period, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const { entityColumn, periodPolicy, minStarts } = policy(entityType, period);
  const asOf = dateOnly(options.asOf || new Date().toISOString());
  const windowStart = subtractDays(asOf, periodPolicy.days);

  const coverage = await env.DB.prepare(`
    SELECT MIN(r.race_date) AS earliest_date,
           MAX(r.race_date) AS latest_date,
           COUNT(DISTINCT r.race_date) AS result_dates,
           COUNT(*) AS completed_starts
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.scratched = 0
      AND rr.result_status IS NOT NULL
      AND r.race_date <= ?
  `).bind(asOf).first();

  const entityCounts = await env.DB.prepare(`
    WITH entity_starts AS (
      SELECT ${entityColumn} AS entity_id, COUNT(*) AS starts
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      WHERE re.scratched = 0
        AND rr.result_status IS NOT NULL
        AND ${entityColumn} IS NOT NULL
        AND r.race_date BETWEEN ? AND ?
      GROUP BY ${entityColumn}
    )
    SELECT COUNT(*) AS entities_with_results,
           SUM(CASE WHEN starts >= ? THEN 1 ELSE 0 END) AS eligible_entities
    FROM entity_starts
  `).bind(windowStart, asOf, minStarts).first();

  const earliestDate = coverage?.earliest_date ?? null;
  const latestDate = coverage?.latest_date ?? null;
  const fullWindowCovered = earliestDate != null && earliestDate <= windowStart && latestDate != null && latestDate >= asOf;
  const eligibleEntities = Number(entityCounts?.eligible_entities ?? 0);
  const enoughEntities = eligibleEntities >= TREND_MIN_ELIGIBLE_ENTITIES;
  const ready = fullWindowCovered && enoughEntities;

  return {
    version: TREND_READINESS_VERSION,
    entityType,
    period,
    periodDays: periodPolicy.days,
    asOf,
    windowStart,
    minStartsPerEntity: minStarts,
    minEligibleEntities: TREND_MIN_ELIGIBLE_ENTITIES,
    coverage: {
      earliestDate,
      latestDate,
      resultDates: Number(coverage?.result_dates ?? 0),
      completedStarts: Number(coverage?.completed_starts ?? 0),
      fullWindowCovered
    },
    entities: {
      withResults: Number(entityCounts?.entities_with_results ?? 0),
      eligible: eligibleEntities,
      enough: enoughEntities
    },
    ready,
    reason: ready ? null : !fullWindowCovered ? 'insufficient_history_window' : 'insufficient_eligible_entities'
  };
}
