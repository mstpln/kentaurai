export const DATA_COVERAGE_VERSION = 'kentaurai-data-coverage-v1';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function count(env, sql, ...args) {
  const row = await env.DB.prepare(sql).bind(...args).first();
  return finiteNumber(row?.n);
}

function metric(covered, eligible, note = null) {
  const safeCovered = finiteNumber(covered);
  const safeEligible = finiteNumber(eligible);
  return {
    covered: safeCovered,
    eligible: safeEligible,
    percent: safeEligible > 0 ? Number(((safeCovered / safeEligible) * 100).toFixed(1)) : null,
    ...(note ? { note } : {})
  };
}

async function fieldMetric(env, table, field, eligibleSql, eligibleArgs = []) {
  const eligible = await count(env, eligibleSql, ...eligibleArgs);
  const covered = await count(
    env,
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${field} IS NOT NULL AND rowid IN (${eligibleSql.replace(/^SELECT COUNT\(\*\) AS n FROM [^ ]+ WHERE /, 'SELECT rowid FROM ' + table + ' WHERE ')})`,
    ...eligibleArgs
  );
  return metric(covered, eligible);
}

async function simpleFieldMetrics(env, table, fields, where = '1=1') {
  const eligible = await count(env, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  const result = {};
  for (const field of fields) {
    const covered = await count(env, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where} AND ${field} IS NOT NULL`);
    result[field] = metric(covered, eligible);
  }
  return result;
}

async function entryFieldMetrics(env) {
  const where = 'scratched = 0';
  return simpleFieldMetrics(env, 'race_entries', [
    'driver_id',
    'trainer_id',
    'start_number',
    'actual_lane',
    'start_tier',
    'actual_start_distance_m',
    'springspar',
    'inner_lane',
    'back_row'
  ], where);
}

async function resultFieldMetrics(env) {
  return simpleFieldMetrics(env, 'race_results', [
    'placing',
    'finish_time',
    'km_time',
    'prize_sek',
    'gallop',
    'disqualified',
    'distance_behind_winner_m',
    'official_odds',
    'result_status'
  ]);
}

async function equipmentMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n
    FROM race_entries re
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithEquipment = await count(env, `
    SELECT COUNT(DISTINCT e.race_entry_id) AS n
    FROM equipment e
    JOIN race_entries re ON re.id = e.race_entry_id
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const rows = await count(env, 'SELECT COUNT(*) AS n FROM equipment');
  const fields = await simpleFieldMetrics(env, 'equipment', [
    'shoes_front',
    'shoes_rear',
    'barefoot_front',
    'barefoot_rear',
    'sulky_type',
    'exact_sulky',
    'headgear',
    'earplugs',
    'other_equipment',
    'change_from_previous_json',
    'verification_status'
  ]);
  return {
    rows,
    completed_entry_coverage: metric(entriesWithEquipment, completedEntries),
    fields
  };
}

async function xlabsMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n
    FROM race_entries re
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithXlabs = await count(env, `
    SELECT COUNT(DISTINCT x.race_entry_id) AS n
    FROM xlabs_data x
    JOIN race_entries re ON re.id = x.race_entry_id
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const rows = await count(env, 'SELECT COUNT(*) AS n FROM xlabs_data');
  const fields = await simpleFieldMetrics(env, 'xlabs_data', [
    'first_200_time',
    'last_200_time',
    'last_400_time',
    'last_500_time',
    'last_800_time',
    'last_1000_time',
    'actual_distance_m',
    'extra_distance_m',
    'converted_km_time',
    'slipstream_m',
    'segments_json',
    'quality_status'
  ]);
  const validSegments = await count(env, `
    SELECT COUNT(*) AS n
    FROM xlabs_data
    WHERE segments_json IS NOT NULL AND json_valid(segments_json)
  `);
  fields.segments_json_valid = metric(validSegments, rows, 'Valid JSON among all X-Labs rows.');
  return {
    rows,
    completed_entry_coverage: metric(entriesWithXlabs, completedEntries),
    fields
  };
}

async function positionMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n
    FROM race_entries re
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithPositions = await count(env, `
    SELECT COUNT(DISTINCT rp.race_entry_id) AS n
    FROM race_positions rp
    JOIN race_entries re ON re.id = rp.race_entry_id
    WHERE re.scratched = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const rows = await count(env, 'SELECT COUNT(*) AS n FROM race_positions');
  return {
    rows,
    completed_entry_coverage: metric(entriesWithPositions, completedEntries),
    fields: await simpleFieldMetrics(env, 'race_positions', [
      'observed_at_m',
      'position',
      'lane',
      'leader',
      'pocket',
      'death_seat',
      'second_over',
      'third_over',
      'wide_trip',
      'uncovered_move',
      'traffic_event',
      'event_json'
    ])
  };
}

async function startPointsMetrics(env) {
  const horses = await count(env, 'SELECT COUNT(*) AS n FROM horses');
  const current = await count(env, 'SELECT COUNT(*) AS n FROM horses WHERE current_start_points IS NOT NULL');
  const withHistory = await count(env, 'SELECT COUNT(DISTINCT horse_id) AS n FROM horse_start_points');
  const observations = await count(env, 'SELECT COUNT(*) AS n FROM horse_start_points');
  const linked = await count(env, 'SELECT COUNT(*) AS n FROM horse_start_points WHERE race_entry_id IS NOT NULL');
  return {
    observations,
    horses_with_current: metric(current, horses),
    horses_with_history: metric(withHistory, horses),
    observations_linked_to_entry: metric(linked, observations)
  };
}

async function trackMetrics(env) {
  const fields = await simpleFieldMetrics(env, 'tracks', [
    'country_code',
    'lap_length_m',
    'home_stretch_m',
    'curve_radius_m',
    'banking_degrees',
    'width_m',
    'surface',
    'open_stretch_lanes',
    'angled_mobile_wing',
    'start_notes',
    'track_notes'
  ]);
  return { total: await count(env, 'SELECT COUNT(*) AS n FROM tracks'), fields };
}

async function observationMetrics(env) {
  const total = await count(env, 'SELECT COUNT(*) AS n FROM normalized_observations');
  const { results } = await env.DB.prepare(`
    SELECT entity_type, COUNT(*) AS n
    FROM normalized_observations
    GROUP BY entity_type
    ORDER BY entity_type
  `).all();
  const byEntityType = {};
  for (const row of results || []) byEntityType[String(row.entity_type)] = finiteNumber(row.n);
  const validJson = await count(env, 'SELECT COUNT(*) AS n FROM normalized_observations WHERE json_valid(fields_json)');
  const prizeText = await count(env, `
    SELECT COUNT(*) AS n
    FROM normalized_observations
    WHERE entity_type = 'race'
      AND json_valid(fields_json)
      AND json_type(fields_json, '$.prizeText') = 'text'
  `);
  const raceObservations = finiteNumber(byEntityType.race);
  return {
    total,
    by_entity_type: byEntityType,
    valid_fields_json: metric(validJson, total),
    race_prize_text: metric(prizeText, raceObservations)
  };
}

async function marketMetrics(env) {
  const allEntries = await count(env, 'SELECT COUNT(*) AS n FROM race_entries WHERE scratched = 0');
  const bettingRows = await count(env, 'SELECT COUNT(*) AS n FROM betting_snapshots');
  const bettingEntries = await count(env, 'SELECT COUNT(DISTINCT race_entry_id) AS n FROM betting_snapshots');
  const oddsRows = await count(env, 'SELECT COUNT(*) AS n FROM odds_snapshots');
  const oddsEntries = await count(env, 'SELECT COUNT(DISTINCT race_entry_id) AS n FROM odds_snapshots');
  return {
    betting_snapshots: { rows: bettingRows, entry_coverage: metric(bettingEntries, allEntries) },
    odds_snapshots: { rows: oddsRows, entry_coverage: metric(oddsEntries, allEntries) }
  };
}

async function classificationMetrics(env) {
  const races = await count(env, 'SELECT COUNT(*) AS n FROM races');
  const stl = await count(env, 'SELECT COUNT(DISTINCT race_id) AS n FROM race_stl_classifications');
  const typed = await count(env, 'SELECT COUNT(DISTINCT race_id) AS n FROM race_type_classifications');
  return {
    stl_classification: metric(stl, races),
    race_type_classification: metric(typed, races)
  };
}

async function backfillMetrics(env) {
  const historical = await env.DB.prepare(`
    SELECT status, COUNT(*) AS jobs, COALESCE(SUM(processed_dates),0) AS processed_dates,
           COALESCE(SUM(processed_races),0) AS processed_races,
           COALESCE(SUM(reused_races),0) AS reused_races
    FROM historical_backfill_jobs
    GROUP BY status
    ORDER BY status
  `).all();
  const xlabs = await env.DB.prepare(`
    SELECT status, scope, COUNT(*) AS jobs, COALESCE(SUM(processed_dates),0) AS processed_dates,
           COALESCE(SUM(processed_races),0) AS processed_races,
           COALESCE(SUM(reused_races),0) AS reused_races,
           COALESCE(SUM(unavailable_races),0) AS unavailable_races
    FROM xlabs_backfill_jobs
    GROUP BY status, scope
    ORDER BY scope, status
  `).all();
  const clean = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
  return {
    historical: (historical.results || []).map(clean),
    xlabs: (xlabs.results || []).map(clean)
  };
}

export async function buildDataCoverageReport(env, generatedAt = new Date().toISOString()) {
  if (!env.DB) throw new Error('DB is not configured');

  const [
    races,
    completedRaces,
    entries,
    activeEntries,
    resultRows,
    horses,
    drivers,
    trainers,
    tracks,
    rounds,
    raceFields,
    entryFields,
    resultFields,
    equipment,
    xlabs,
    positions,
    startPoints,
    trackCoverage,
    observations,
    market,
    classifications,
    backfills
  ] = await Promise.all([
    count(env, 'SELECT COUNT(*) AS n FROM races'),
    count(env, 'SELECT COUNT(DISTINCT re.race_id) AS n FROM race_entries re JOIN race_results rr ON rr.race_entry_id = re.id'),
    count(env, 'SELECT COUNT(*) AS n FROM race_entries'),
    count(env, 'SELECT COUNT(*) AS n FROM race_entries WHERE scratched = 0'),
    count(env, 'SELECT COUNT(*) AS n FROM race_results'),
    count(env, 'SELECT COUNT(*) AS n FROM horses'),
    count(env, 'SELECT COUNT(*) AS n FROM drivers'),
    count(env, 'SELECT COUNT(*) AS n FROM trainers'),
    count(env, 'SELECT COUNT(*) AS n FROM tracks'),
    count(env, "SELECT COUNT(*) AS n FROM game_rounds WHERE game_type IN ('V85','V86')"),
    simpleFieldMetrics(env, 'races', ['track_id','race_number','scheduled_start_at','distance_m','start_method','field_size','first_prize_sek','race_name','main_class','class_flags_json','status']),
    entryFieldMetrics(env),
    resultFieldMetrics(env),
    equipmentMetrics(env),
    xlabsMetrics(env),
    positionMetrics(env),
    startPointsMetrics(env),
    trackMetrics(env),
    observationMetrics(env),
    marketMetrics(env),
    classificationMetrics(env),
    backfillMetrics(env)
  ]);

  return {
    contract_version: DATA_COVERAGE_VERSION,
    generated_at: generatedAt,
    scope: {
      storage: 'D1 aggregate coverage only',
      privacy: 'No row-level racing data, names, IDs, URLs, raw payloads or editorial provenance are included.',
      purpose: 'Measure what KentaurAI already stores before designing new derived analysis features.'
    },
    population: {
      races,
      completed_races: completedRaces,
      race_entries: entries,
      non_scratched_entries: activeEntries,
      race_result_rows: resultRows,
      horses,
      drivers,
      trainers,
      tracks,
      v85_v86_rounds: rounds
    },
    coverage: {
      races: raceFields,
      race_entries: entryFields,
      race_results: resultFields,
      equipment,
      xlabs,
      race_positions: positions,
      start_points: startPoints,
      tracks: trackCoverage,
      normalized_observations: observations,
      market,
      classifications
    },
    backfills
  };
}

export async function createDataCoverageExportResponse(env, generatedAt = new Date().toISOString()) {
  const report = await buildDataCoverageReport(env, generatedAt);
  const stamp = generatedAt.slice(0, 10);
  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="kentaurai-data-coverage_${stamp}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
