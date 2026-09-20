import {
  addCanonicalRaceScopeCondition,
  canonicalStartMethodSql,
  coreMetricSelectSql,
  mapCoreMetricRow,
  monteRaceCondition
} from './statistics/core.js';

const DISTANCE_STANDARDS = [640,1640,2140,2640,3140,3640,4140];
const DISTANCE_TOLERANCE_M = 100;

function addYearCondition(conditions, bindings, filters) {
  const currentYear = Number(filters.asOfDate.slice(0, 4));
  conditions.push('r.race_date >= ?');
  bindings.push(`${filters.year}-01-01`);
  if (filters.year === currentYear) {
    conditions.push('r.race_date <= ?');
    bindings.push(filters.asOfDate);
  } else {
    conditions.push('r.race_date < ?');
    bindings.push(`${filters.year + 1}-01-01`);
  }
}

function addDistanceCondition(conditions, bindings, distance) {
  if (distance === 'all') return;
  if (distance === 'other-long') {
    const standards = DISTANCE_STANDARDS.filter((value) => value >= 2640);
    conditions.push(`r.distance_m > 2640 AND ${standards.map(() => 'NOT (r.distance_m BETWEEN ? AND ?)').join(' AND ')}`);
    for (const standard of standards) bindings.push(standard - DISTANCE_TOLERANCE_M, standard + DISTANCE_TOLERANCE_M);
    return;
  }
  const meters = Number(distance);
  conditions.push('r.distance_m BETWEEN ? AND ?');
  bindings.push(meters - DISTANCE_TOLERANCE_M, meters + DISTANCE_TOLERANCE_M);
}

function addFilters(conditions, bindings, filters) {
  addYearCondition(conditions, bindings, filters);
  if (filters.trackId) {
    conditions.push('r.track_id = ?');
    bindings.push(filters.trackId);
  }
  if (filters.startMethod !== 'all') conditions.push(`${canonicalStartMethodSql('r')} = '${filters.startMethod}'`);
  if (filters.raceType === 'monte') conditions.push(monteRaceCondition('r'));
  if (filters.raceType === 'sulky') conditions.push(`NOT ${monteRaceCondition('r')}`);
  if (filters.breedType === 'warmblood') conditions.push("(LOWER(COALESCE(h.breed,'')) LIKE '%varmblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%warmblood%')");
  if (filters.breedType === 'coldblood') conditions.push("(LOWER(COALESCE(h.breed,'')) LIKE '%kallblod%' OR LOWER(COALESCE(h.breed,'')) LIKE '%coldblood%')");
  if (filters.sex === 'mare') conditions.push("LOWER(COALESCE(h.sex,'')) IN ('sto','mare','female','f')");
  if (filters.sex === 'stallion') conditions.push("LOWER(COALESCE(h.sex,'')) IN ('hingst','stallion','male','m')");
  if (filters.sex === 'gelding') conditions.push("LOWER(COALESCE(h.sex,'')) IN ('valack','gelding')");
  if (filters.age != null) {
    conditions.push('? - h.birth_year = ?');
    bindings.push(filters.year, filters.age);
  }
  addDistanceCondition(conditions, bindings, filters.distanceGroup);
  addCanonicalRaceScopeCondition(conditions, filters.raceScope, 'r');
  if (filters.voltLane !== 'all') {
    conditions.push(`${canonicalStartMethodSql('r')} = 'volt'`);
    conditions.push(filters.voltLane === 'good' ? 're.actual_lane IN (1,6,7)' : 're.actual_lane IS NOT NULL AND re.actual_lane NOT IN (1,6,7)');
  }
  if (filters.handicapM != null) {
    conditions.push(
      `${canonicalStartMethodSql('r')} = 'volt'`,
      're.handicap_m = ?',
      're.actual_start_distance_m IS NOT NULL',
      'r.distance_m IS NOT NULL',
      're.actual_start_distance_m - r.distance_m = re.handicap_m'
    );
    bindings.push(filters.handicapM);
  }
}

function verifiedHomeTrackCte() {
  return `latest_trainer_observation AS (
    SELECT o.entity_id AS trainer_id,o.fields_json,
      ROW_NUMBER() OVER(PARTITION BY o.entity_id ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC) AS rn
    FROM normalized_observations o
    JOIN source_records sr ON sr.id=o.source_record_id
    WHERE o.entity_type='trainer' AND o.entity_id=? AND sr.source_type='official_provider'
  ), trainer_home AS (
    SELECT lto.trainer_id,tei.track_id AS home_track_id
    FROM latest_trainer_observation lto
    JOIN track_external_ids tei
      ON tei.source_type='official'
      AND tei.external_id=CAST(json_extract(lto.fields_json,'$.homeTrackExternalId') AS TEXT)
    WHERE lto.rn=1
      AND json_valid(lto.fields_json)
      AND json_extract(lto.fields_json,'$.homeTrackExternalId') IS NOT NULL
  )`;
}

async function loadSummary(env, trainerId, filters, home) {
  const conditions = ['re.scratched = 0', 're.trainer_id = ?'];
  const bindings = [trainerId, trainerId];
  addFilters(conditions, bindings, filters);
  conditions.push(home
    ? 'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id=r.track_id)'
    : 'EXISTS (SELECT 1 FROM trainer_home th WHERE th.trainer_id=re.trainer_id AND th.home_track_id IS NOT NULL AND th.home_track_id<>r.track_id)');
  const row = await env.DB.prepare(`WITH ${verifiedHomeTrackCte()}
    SELECT ${coreMetricSelectSql('rr')}
    FROM race_entries re INDEXED BY idx_entries_trainer
    JOIN races r ON r.id=re.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN horses h ON h.id=re.horse_id
    WHERE ${conditions.join(' AND ')}`).bind(...bindings).first();
  return mapCoreMetricRow(row || {});
}

export async function getTrainerCalendarHomeTrackResults(env, trainerId, filters) {
  const [homeTrackResults, otherTrackResults] = await Promise.all([
    loadSummary(env, trainerId, filters, true),
    loadSummary(env, trainerId, filters, false)
  ]);
  return { homeTrackResults, otherTrackResults };
}
