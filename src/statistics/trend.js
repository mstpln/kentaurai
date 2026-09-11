import {
  addTrendRaceFilters,
  coreMetricSelectSql,
  mapCoreMetricRow,
  normalizeTrackId,
  normalizeTrendBreed,
  normalizeTrendCategory,
  normalizeTrendRaceScope,
  normalizeTrendRaceType,
  normalizeTrendStartMethod,
  trendDateWindow
} from './core.js';

const CATEGORY_CONFIG = Object.freeze({
  horses: { entityTable: 'horses', relationColumn: 'horse_id' },
  trainers: { entityTable: 'trainers', relationColumn: 'trainer_id' },
  drivers: { entityTable: 'drivers', relationColumn: 'driver_id' }
});

async function validateTrack(env, trackId) {
  if (!trackId) return;
  const found = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
  if (!found?.ok) throw new Error('track_id does not identify a stored track');
}

export async function getTrendLeaderboard(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');

  const category = normalizeTrendCategory(options.category);
  const raceScope = normalizeTrendRaceScope(options.raceScope);
  const raceType = normalizeTrendRaceType(options.raceType);
  const breedType = normalizeTrendBreed(options.breedType);
  const startMethod = normalizeTrendStartMethod(options.startMethod);
  const trackId = normalizeTrackId(options.trackId);
  const window = trendDateWindow(options.period, options.asOfDate);
  await validateTrack(env, trackId);

  const config = CATEGORY_CONFIG[category];
  const conditions = [
    're.scratched = 0',
    'r.race_date >= ?',
    'r.race_date <= ?'
  ];
  const bindings = [window.startDate, window.endDate];
  const filters = { raceScope, raceType, breedType, startMethod, trackId };
  addTrendRaceFilters(conditions, bindings, filters);

  const sql = `
    WITH trend_stats AS (
      SELECT
        entity.id AS entity_id,
        entity.canonical_name AS name,
        ${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      JOIN ${config.entityTable} entity ON entity.id = re.${config.relationColumn}
      WHERE ${conditions.join(' AND ')}
      GROUP BY entity.id, entity.canonical_name
    )
    SELECT * FROM trend_stats
    WHERE starts > 0
    ORDER BY (wins * 1.0 / starts) DESC, wins DESC, starts DESC, entity_id ASC
    LIMIT 10
  `;

  const { results } = await env.DB.prepare(sql).bind(...bindings).all();
  return {
    category,
    filters: {
      period: window.period,
      startDate: window.startDate,
      endDate: window.endDate,
      raceScope,
      trackId,
      raceType,
      breedType,
      startMethod
    },
    items: results.map((row, index) => ({
      rank: index + 1,
      id: row.entity_id,
      name: row.name,
      ...mapCoreMetricRow(row)
    }))
  };
}

export async function getTrendFilterOptions(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT t.id, t.canonical_name AS name
    FROM tracks t
    JOIN races r ON r.track_id = t.id
    JOIN race_entries re ON re.race_id = r.id AND re.scratched = 0
    JOIN race_results rr ON rr.race_entry_id = re.id
    ORDER BY t.canonical_name COLLATE NOCASE ASC, t.id ASC
  `).all();
  return { tracks: results };
}
