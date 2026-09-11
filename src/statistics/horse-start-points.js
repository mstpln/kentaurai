import {
  addCanonicalRaceScopeCondition,
  canonicalStartMethodSql,
  monteRaceCondition
} from './core.js';

const DISTANCE_TOLERANCE_M = 100;
const DISTANCE_STANDARDS = [640, 1640, 2140, 2640, 3140, 3640, 4140];

function addEligibilityFilters(conditions, bindings, filters) {
  if (filters.period !== 'all') {
    const periodDays = filters.period === '2w' ? 13 : filters.period === '4w' ? 27 : null;
    if (periodDays != null) {
      conditions.push(`r.race_date >= date(?, '-${periodDays} days')`, 'r.race_date <= ?');
      bindings.push(filters.asOfDate, filters.asOfDate);
    } else {
      const months = filters.period === '3m' ? 3 : filters.period === '6m' ? 6 : 12;
      conditions.push(`r.race_date >= date(?, '-${months} months')`, 'r.race_date <= ?');
      bindings.push(filters.asOfDate, filters.asOfDate);
    }
  }
  if (filters.trackId) {
    conditions.push('r.track_id = ?');
    bindings.push(filters.trackId);
  }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql('r')} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition('r'));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition('r')}`);
  if (filters.breedType === 'warmblood') conditions.push(`(LOWER(COALESCE(h.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%warmblood%')`);
  if (filters.breedType === 'coldblood') conditions.push(`(LOWER(COALESCE(h.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%coldblood%')`);
  if (filters.sex === 'mare') conditions.push(`LOWER(COALESCE(h.sex,'')) IN ('sto','mare','female','f')`);
  if (filters.sex === 'stallion') conditions.push(`LOWER(COALESCE(h.sex,'')) IN ('hingst','stallion','male','m')`);
  if (filters.sex === 'gelding') conditions.push(`LOWER(COALESCE(h.sex,'')) IN ('valack','gelding')`);
  if (filters.age != null) {
    conditions.push(`CAST(substr(?,1,4) AS INTEGER) - h.birth_year = ?`);
    bindings.push(filters.asOfDate, filters.age);
  }
  if (filters.distanceGroup !== 'all') {
    if (filters.distanceGroup === 'other-long') {
      const standards = DISTANCE_STANDARDS.filter((value) => value >= 2640);
      conditions.push(`r.distance_m > 2640 AND ${standards.map(() => 'NOT (r.distance_m BETWEEN ? AND ?)').join(' AND ')}`);
      for (const standard of standards) bindings.push(standard - DISTANCE_TOLERANCE_M, standard + DISTANCE_TOLERANCE_M);
    } else {
      const meters = Number(filters.distanceGroup);
      conditions.push('r.distance_m BETWEEN ? AND ?');
      bindings.push(meters - DISTANCE_TOLERANCE_M, meters + DISTANCE_TOLERANCE_M);
    }
  }
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, 'r');
}

export async function getHorseStartPointRanking(env, filters) {
  const conditions = ['re.scratched = 0'];
  const bindings = [];
  addEligibilityFilters(conditions, bindings, filters);
  bindings.push(filters.asOfDate);
  const { results } = await env.DB.prepare(`
    WITH eligible AS (
      SELECT DISTINCT h.id AS horse_id, h.canonical_name AS name
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      WHERE ${conditions.join(' AND ')}
    ), point_history AS (
      SELECT horse_id, points, observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY horse_id
          ORDER BY observed_at DESC, id DESC
        ) AS rn
      FROM horse_start_points
      WHERE substr(observed_at, 1, 10) <= ?
    )
    SELECT e.horse_id AS id, e.name, p.points, p.observed_at
    FROM eligible e
    JOIN point_history p ON p.horse_id = e.horse_id AND p.rn = 1
    ORDER BY p.points DESC, p.observed_at DESC, e.horse_id ASC
    LIMIT 10
  `).bind(...bindings).all();
  return (results || []).map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    points: Number(row.points),
    observedAt: row.observed_at
  }));
}

export async function getHorseStartPointHistory(env, horseId, asOfDate) {
  const { results } = await env.DB.prepare(`
    SELECT id, points, observed_at, race_entry_id, source_record_id
    FROM horse_start_points
    WHERE horse_id = ? AND substr(observed_at, 1, 10) <= ?
    ORDER BY observed_at DESC, id DESC
    LIMIT 250
  `).bind(horseId, asOfDate).all();
  const history = (results || []).map((row) => ({
    id: row.id,
    points: Number(row.points),
    observedAt: row.observed_at,
    raceEntryId: row.race_entry_id || null,
    sourceRecordId: row.source_record_id
  }));
  return {
    current: history[0] || null,
    history
  };
}
