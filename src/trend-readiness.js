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

async function verifiedDateCoverage(env, windowStart, asOf) {
  const row = await env.DB.prepare(`
    WITH RECURSIVE dates(day) AS (
      SELECT date(?)
      UNION ALL
      SELECT date(day, '+1 day') FROM dates WHERE day < date(?)
    ), covered AS (
      SELECT d.day,
             EXISTS (
               SELECT 1
               FROM historical_backfill_jobs hb
               WHERE hb.start_date <= d.day
                 AND hb.end_date >= d.day
                 AND (hb.status = 'completed' OR hb.next_date < d.day)
             ) AS is_covered
      FROM dates d
    )
    SELECT COUNT(*) AS required_days,
           SUM(is_covered) AS covered_days
    FROM covered
  `).bind(windowStart, asOf).first();
  const requiredDays = Number(row?.required_days ?? 0);
  const coveredDays = Number(row?.covered_days ?? 0);
  return { requiredDays, coveredDays, fullWindowCovered: requiredDays > 0 && coveredDays === requiredDays };
}

export async function assessTrendReadiness(env, entityType, period, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const { entityColumn, periodPolicy, minStarts } = policy(entityType, period);
  const asOf = dateOnly(options.asOf || new Date().toISOString());
  const windowStart = subtractDays(asOf, periodPolicy.days);
  const dateCoverage = await verifiedDateCoverage(env, windowStart, asOf);

  const resultCoverage = await env.DB.prepare(`
    SELECT MIN(r.race_date) AS earliest_date,
           MAX(r.race_date) AS latest_date,
           COUNT(DISTINCT r.race_date) AS result_dates,
           COUNT(*) AS completed_starts
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.scratched = 0
      AND rr.result_status = 'official'
      AND r.race_date BETWEEN ? AND ?
  `).bind(windowStart, asOf).first();

  const entityCounts = await env.DB.prepare(`
    WITH entity_starts AS (
      SELECT ${entityColumn} AS entity_id, COUNT(*) AS starts
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      WHERE re.scratched = 0
        AND rr.result_status = 'official'
        AND ${entityColumn} IS NOT NULL
        AND r.race_date BETWEEN ? AND ?
      GROUP BY ${entityColumn}
    )
    SELECT COUNT(*) AS entities_with_results,
           SUM(CASE WHEN starts >= ? THEN 1 ELSE 0 END) AS eligible_entities
    FROM entity_starts
  `).bind(windowStart, asOf, minStarts).first();

  const eligibleEntities = Number(entityCounts?.eligible_entities ?? 0);
  const enoughEntities = eligibleEntities >= TREND_MIN_ELIGIBLE_ENTITIES;
  const ready = dateCoverage.fullWindowCovered && enoughEntities;

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
      requiredDays: dateCoverage.requiredDays,
      coveredDays: dateCoverage.coveredDays,
      fullWindowCovered: dateCoverage.fullWindowCovered,
      earliestResultDate: resultCoverage?.earliest_date ?? null,
      latestResultDate: resultCoverage?.latest_date ?? null,
      resultDates: Number(resultCoverage?.result_dates ?? 0),
      completedStarts: Number(resultCoverage?.completed_starts ?? 0)
    },
    entities: {
      withResults: Number(entityCounts?.entities_with_results ?? 0),
      eligible: eligibleEntities,
      enough: enoughEntities
    },
    ready,
    reason: ready ? null : !dateCoverage.fullWindowCovered ? 'insufficient_verified_date_coverage' : 'insufficient_eligible_entities'
  };
}
