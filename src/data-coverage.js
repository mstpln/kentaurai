export const DATA_COVERAGE_VERSION = 'kentaurai-data-coverage-v1';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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

async function aggregateFieldMetrics(env, table, fields, where = '1=1') {
  const projections = fields.map((field, index) =>
    `SUM(CASE WHEN ${quoteIdentifier(field)} IS NOT NULL THEN 1 ELSE 0 END) AS c${index}`
  );
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS eligible${projections.length ? `, ${projections.join(', ')}` : ''}
    FROM ${quoteIdentifier(table)}
    WHERE ${where}
  `).first();
  const eligible = finiteNumber(row?.eligible);
  const result = {};
  fields.forEach((field, index) => { result[field] = metric(row?.[`c${index}`], eligible); });
  return { eligible, fields: result };
}

async function raceMetrics(env) {
  return aggregateFieldMetrics(env, 'races', [
    'track_id','race_number','scheduled_start_at','distance_m','start_method','field_size',
    'starters_declared','first_prize_sek','race_name','main_class','class_flags_json','status'
  ]);
}

async function roundMetrics(env) {
  return aggregateFieldMetrics(env, 'game_rounds', [
    'primary_track_id','scheduled_start_at','bet_stop_at','jackpot_sek','turnover_sek','payout_json','status'
  ], "game_type IN ('V85','V86')");
}

async function horseMetrics(env) {
  return aggregateFieldMetrics(env, 'horses', [
    'sex','birth_year','breed','career_earnings_sek','record_text','current_trainer_id',
    'home_track_id','country_code','current_start_points','current_start_points_observed_at'
  ]);
}

async function driverMetrics(env) {
  return aggregateFieldMetrics(env, 'drivers', ['country_code','home_track_id','active']);
}

async function trainerMetrics(env) {
  return aggregateFieldMetrics(env, 'trainers', ['country_code','active']);
}

async function entryMetrics(env) {
  return aggregateFieldMetrics(env, 'race_entries', [
    'horse_id','driver_id','trainer_id','source_start_id','start_number','actual_lane','start_tier',
    'actual_start_distance_m','springspar','inner_lane','back_row'
  ], 'COALESCE(scratched, 0) = 0');
}

async function resultMetrics(env) {
  return aggregateFieldMetrics(env, 'race_results', [
    'placing','placing_text','finish_time','km_time','prize_sek','gallop','disqualified',
    'distance_behind_winner_m','official_odds','result_status'
  ]);
}

async function equipmentMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n FROM race_entries re
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithEquipment = await count(env, `
    SELECT COUNT(DISTINCT e.race_entry_id) AS n
    FROM equipment e JOIN race_entries re ON re.id = e.race_entry_id
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const aggregate = await aggregateFieldMetrics(env, 'equipment', [
    'shoes_front','shoes_rear','barefoot_front','barefoot_rear','sulky_type','exact_sulky',
    'headgear','earplugs','other_equipment','change_from_previous_json','verification_status'
  ]);
  return { rows: aggregate.eligible, completed_entry_coverage: metric(entriesWithEquipment, completedEntries), fields: aggregate.fields };
}

async function xlabsMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n FROM race_entries re
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithXlabs = await count(env, `
    SELECT COUNT(DISTINCT x.race_entry_id) AS n
    FROM xlabs_data x JOIN race_entries re ON re.id = x.race_entry_id
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const aggregate = await aggregateFieldMetrics(env, 'xlabs_data', [
    'first_200_time','last_200_time','last_400_time','last_500_time','last_800_time','last_1000_time',
    'actual_distance_m','extra_distance_m','converted_km_time','slipstream_m','segments_json','quality_status'
  ]);
  const validSegments = await count(env, `SELECT COUNT(*) AS n FROM xlabs_data WHERE segments_json IS NOT NULL AND json_valid(segments_json)`);
  return {
    rows: aggregate.eligible,
    completed_entry_coverage: metric(entriesWithXlabs, completedEntries),
    fields: { ...aggregate.fields, segments_json_valid: metric(validSegments, aggregate.eligible, 'Valid JSON among all X-Labs rows.') }
  };
}

async function positionMetrics(env) {
  const completedEntries = await count(env, `
    SELECT COUNT(*) AS n FROM race_entries re
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const entriesWithPositions = await count(env, `
    SELECT COUNT(DISTINCT rp.race_entry_id) AS n
    FROM race_positions rp JOIN race_entries re ON re.id = rp.race_entry_id
    WHERE COALESCE(re.scratched, 0) = 0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id = re.id)
  `);
  const aggregate = await aggregateFieldMetrics(env, 'race_positions', [
    'observed_at_m','position','lane','leader','pocket','death_seat','second_over','third_over',
    'wide_trip','uncovered_move','traffic_event','event_json'
  ]);
  return { rows: aggregate.eligible, completed_entry_coverage: metric(entriesWithPositions, completedEntries), fields: aggregate.fields };
}

async function startPointsMetrics(env) {
  const horses = await count(env, 'SELECT COUNT(*) AS n FROM horses');
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS observations, COUNT(DISTINCT horse_id) AS horses_with_history,
           SUM(CASE WHEN race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_observations
    FROM horse_start_points
  `).first();
  const current = await count(env, 'SELECT COUNT(*) AS n FROM horses WHERE current_start_points IS NOT NULL');
  const observations = finiteNumber(row?.observations);
  return {
    observations,
    horses_with_current: metric(current, horses),
    horses_with_history: metric(row?.horses_with_history, horses),
    observations_linked_to_entry: metric(row?.linked_observations, observations)
  };
}

async function trackMetrics(env) {
  const aggregate = await aggregateFieldMetrics(env, 'tracks', [
    'country_code','lap_length_m','home_stretch_m','curve_radius_m','banking_degrees','width_m','surface',
    'open_stretch_lanes','angled_mobile_wing','start_notes','track_notes'
  ]);
  return { total: aggregate.eligible, fields: aggregate.fields };
}

async function raceConditionMetrics(env) {
  const races = await count(env, 'SELECT COUNT(*) AS n FROM races');
  const aggregate = await aggregateFieldMetrics(env, 'race_conditions', [
    'track_status','temperature_c','wind_mps','wind_direction','precipitation_mm','weather_text','day_profile_json'
  ]);
  const coveredRaces = await count(env, 'SELECT COUNT(DISTINCT race_id) AS n FROM race_conditions');
  return { rows: aggregate.eligible, race_coverage: metric(coveredRaces, races), fields: aggregate.fields };
}

async function observationMetrics(env) {
  const total = await count(env, 'SELECT COUNT(*) AS n FROM normalized_observations');
  const { results } = await env.DB.prepare(`
    SELECT entity_type, COUNT(*) AS n FROM normalized_observations GROUP BY entity_type ORDER BY entity_type
  `).all();
  const byEntityType = {};
  for (const row of results || []) byEntityType[String(row.entity_type)] = finiteNumber(row.n);
  const paths = await env.DB.prepare(`
    SELECT COUNT(*) AS valid_json,
      SUM(CASE WHEN entity_type='race' AND json_type(fields_json,'$.prizeText')='text' THEN 1 ELSE 0 END) AS race_prize_text,
      SUM(CASE WHEN entity_type='race' AND json_type(fields_json,'$.terms')='array' THEN 1 ELSE 0 END) AS race_terms,
      SUM(CASE WHEN entity_type='horse' AND json_type(fields_json,'$.ageYears') IN ('integer','real') THEN 1 ELSE 0 END) AS horse_age_years,
      SUM(CASE WHEN entity_type='horse' AND json_type(fields_json,'$.careerEarningsSek') IN ('integer','real') THEN 1 ELSE 0 END) AS horse_career_earnings,
      SUM(CASE WHEN entity_type='horse' AND json_type(fields_json,'$.homeTrackExternalId')='text' THEN 1 ELSE 0 END) AS horse_home_track,
      SUM(CASE WHEN entity_type='driver' AND json_type(fields_json,'$.homeTrackExternalId')='text' THEN 1 ELSE 0 END) AS driver_home_track,
      SUM(CASE WHEN entity_type='trainer' AND json_type(fields_json,'$.homeTrackExternalId')='text' THEN 1 ELSE 0 END) AS trainer_home_track,
      SUM(CASE WHEN entity_type='race_entry' AND json_type(fields_json,'$.scratchSemanticsVerified') IN ('true','false') THEN 1 ELSE 0 END) AS entry_scratch_semantics
    FROM (SELECT entity_type, fields_json FROM normalized_observations WHERE json_valid(fields_json))
  `).first();
  return {
    total,
    by_entity_type: byEntityType,
    valid_fields_json: metric(paths?.valid_json, total),
    race_prize_text: metric(paths?.race_prize_text, byEntityType.race),
    race_terms: metric(paths?.race_terms, byEntityType.race),
    horse_age_years: metric(paths?.horse_age_years, byEntityType.horse),
    horse_career_earnings: metric(paths?.horse_career_earnings, byEntityType.horse),
    horse_home_track: metric(paths?.horse_home_track, byEntityType.horse),
    driver_home_track: metric(paths?.driver_home_track, byEntityType.driver),
    trainer_home_track: metric(paths?.trainer_home_track, byEntityType.trainer),
    race_entry_scratch_semantics: metric(paths?.entry_scratch_semantics, byEntityType.race_entry)
  };
}

async function marketMetrics(env) {
  const eligibleGameEntries = await count(env, `
    SELECT COUNT(DISTINCT re.id) AS n
    FROM game_rounds gr JOIN game_legs gl ON gl.game_round_id=gr.id JOIN race_entries re ON re.race_id=gl.race_id
    WHERE gr.game_type IN ('V85','V86') AND COALESCE(re.scratched,0)=0
  `);
  const bettingRow = await env.DB.prepare(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT bs.race_entry_id) AS covered_entries
    FROM betting_snapshots bs
    JOIN game_rounds gr ON gr.id=bs.game_round_id
    JOIN race_entries re ON re.id=bs.race_entry_id
    JOIN game_legs gl ON gl.game_round_id=bs.game_round_id AND gl.leg_number=bs.leg_number AND gl.race_id=re.race_id
    WHERE gr.game_type IN ('V85','V86') AND COALESCE(re.scratched,0)=0
  `).first();
  const oddsRow = await env.DB.prepare(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT os.race_entry_id) AS covered_entries
    FROM odds_snapshots os JOIN race_entries re ON re.id=os.race_entry_id
    WHERE COALESCE(re.scratched,0)=0 AND EXISTS (
      SELECT 1 FROM game_legs gl JOIN game_rounds gr ON gr.id=gl.game_round_id
      WHERE gl.race_id=re.race_id AND gr.game_type IN ('V85','V86')
    )
  `).first();
  return {
    eligible_v85_v86_entries: eligibleGameEntries,
    betting_snapshots: { rows: finiteNumber(bettingRow?.rows), entry_coverage: metric(bettingRow?.covered_entries, eligibleGameEntries) },
    odds_snapshots: { rows: finiteNumber(oddsRow?.rows), entry_coverage: metric(oddsRow?.covered_entries, eligibleGameEntries) }
  };
}

async function classificationMetrics(env) {
  const races = await count(env, 'SELECT COUNT(*) AS n FROM races');
  const row = await env.DB.prepare(`
    SELECT (SELECT COUNT(DISTINCT race_id) FROM race_stl_classifications) AS stl,
           (SELECT COUNT(DISTINCT race_id) FROM race_type_classifications) AS typed
  `).first();
  return { stl_classification: metric(row?.stl, races), race_type_classification: metric(row?.typed, races) };
}

async function analysisFeatureMetrics(env) {
  const entries = await count(env, 'SELECT COUNT(*) AS n FROM race_entries WHERE COALESCE(scratched,0)=0');
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS rows,
      COUNT(DISTINCT CASE WHEN COALESCE(re.scratched,0)=0 THEN af.race_entry_id END) AS covered_entries,
      COUNT(DISTINCT CASE WHEN COALESCE(re.scratched,0)=0 AND af.feature_version='form-v2' THEN af.race_entry_id END) AS form_entries,
      COUNT(DISTINCT CASE WHEN COALESCE(re.scratched,0)=0 AND af.feature_version='class-exposure-v2' THEN af.race_entry_id END) AS class_entries,
      COUNT(DISTINCT CASE WHEN COALESCE(re.scratched,0)=0 AND af.feature_version='development-v2' THEN af.race_entry_id END) AS development_entries
    FROM analysis_features af JOIN race_entries re ON re.id=af.race_entry_id
  `).first();
  return {
    rows: finiteNumber(row?.rows),
    any_feature_entry_coverage: metric(row?.covered_entries, entries),
    known_versions: {
      'form-v2': metric(row?.form_entries, entries),
      'class-exposure-v2': metric(row?.class_entries, entries),
      'development-v2': metric(row?.development_entries, entries)
    }
  };
}

async function backfillMetrics(env) {
  const historical = await env.DB.prepare(`
    SELECT status, COUNT(*) AS jobs, COALESCE(SUM(processed_dates),0) AS processed_dates,
           COALESCE(SUM(processed_races),0) AS processed_races, COALESCE(SUM(reused_races),0) AS reused_races
    FROM historical_backfill_jobs GROUP BY status ORDER BY status
  `).all();
  const xlabs = await env.DB.prepare(`
    SELECT status, scope, COUNT(*) AS jobs, COALESCE(SUM(processed_dates),0) AS processed_dates,
           COALESCE(SUM(processed_races),0) AS processed_races, COALESCE(SUM(reused_races),0) AS reused_races,
           COALESCE(SUM(unavailable_races),0) AS unavailable_races
    FROM xlabs_backfill_jobs GROUP BY status,scope ORDER BY scope,status
  `).all();
  const clean = (row) => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
  return { historical: (historical.results||[]).map(clean), xlabs: (xlabs.results||[]).map(clean) };
}

export async function buildDataCoverageReport(env, generatedAt = new Date().toISOString()) {
  if (!env.DB) throw new Error('DB is not configured');
  const population = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM races) AS races,
      (SELECT COUNT(DISTINCT re.race_id) FROM race_entries re JOIN race_results rr ON rr.race_entry_id=re.id) AS completed_races,
      (SELECT COUNT(*) FROM race_entries) AS race_entries,
      (SELECT COUNT(*) FROM race_entries WHERE COALESCE(scratched,0)=0) AS non_scratched_entries,
      (SELECT COUNT(*) FROM race_results) AS race_result_rows,
      (SELECT COUNT(*) FROM horses) AS horses,
      (SELECT COUNT(*) FROM drivers) AS drivers,
      (SELECT COUNT(*) FROM trainers) AS trainers,
      (SELECT COUNT(*) FROM tracks) AS tracks,
      (SELECT COUNT(*) FROM game_rounds WHERE game_type IN ('V85','V86')) AS v85_v86_rounds
  `).first();
  const [races,rounds,horses,drivers,trainers,entries,results,equipment,xlabs,positions,startPoints,tracks,raceConditions,observations,market,classifications,analysisFeatures,backfills] = await Promise.all([
    raceMetrics(env),roundMetrics(env),horseMetrics(env),driverMetrics(env),trainerMetrics(env),entryMetrics(env),resultMetrics(env),
    equipmentMetrics(env),xlabsMetrics(env),positionMetrics(env),startPointsMetrics(env),trackMetrics(env),raceConditionMetrics(env),
    observationMetrics(env),marketMetrics(env),classificationMetrics(env),analysisFeatureMetrics(env),backfillMetrics(env)
  ]);
  return {
    contract_version: DATA_COVERAGE_VERSION,
    generated_at: generatedAt,
    scope: {
      storage: 'D1 aggregate coverage only',
      privacy: 'No row-level racing data, names, IDs, URLs, raw payloads or editorial provenance are included.',
      purpose: 'Measure what KentaurAI already stores before designing new derived analysis features.',
      denominator_note: 'Field coverage uses the table population unless a more specific eligible population is named.',
      entry_eligibility_note: 'Entry-based coverage excludes only entries explicitly marked scratched. NULL scratch status remains eligible and is separately audited.'
    },
    population: Object.fromEntries(Object.entries(population||{}).map(([key,value]) => [key,finiteNumber(value)])),
    coverage: {
      races: races.fields, game_rounds: rounds.fields, horses: horses.fields, drivers: drivers.fields, trainers: trainers.fields,
      race_entries: entries.fields, race_results: results.fields, equipment, xlabs, race_positions: positions, start_points: startPoints,
      tracks, race_conditions: raceConditions, normalized_observations: observations, market, classifications, analysis_features: analysisFeatures
    },
    backfills
  };
}

export async function createDataCoverageExportResponse(env, generatedAt = new Date().toISOString()) {
  const report = await buildDataCoverageReport(env, generatedAt);
  const stamp = generatedAt.slice(0,10);
  return new Response(JSON.stringify(report,null,2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="kentaurai-data-coverage_${stamp}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
