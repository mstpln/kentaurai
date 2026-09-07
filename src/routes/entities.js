const ENTITY_CONFIG = {
  horses: { table: 'horses', idColumn: 'id', nameColumn: 'canonical_name', label: 'häst' },
  trainers: { table: 'trainers', idColumn: 'id', nameColumn: 'canonical_name', label: 'tränare' },
  drivers: { table: 'drivers', idColumn: 'id', nameColumn: 'canonical_name', label: 'kusk' }
};

function configFor(type) {
  const config = ENTITY_CONFIG[type];
  if (!config) throw new Error('unsupported entity type');
  return config;
}

function sanitizeQuery(value) {
  return String(value || '').trim().slice(0, 80);
}

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100000);
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function numeric(value) {
  return value == null ? null : Number(value);
}

function escapedLike(value) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

export async function getEntitySummary(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM horses) AS horses,
      (SELECT COUNT(*) FROM trainers) AS trainers,
      (SELECT COUNT(*) FROM drivers) AS drivers,
      (SELECT COUNT(*) FROM races) AS races,
      (SELECT COUNT(*) FROM race_entries) AS entries,
      (SELECT COUNT(*) FROM race_results) AS results
  `).first();
  const results = Number(row?.results ?? 0);
  return {
    counts: {
      horses: Number(row?.horses ?? 0),
      trainers: Number(row?.trainers ?? 0),
      drivers: Number(row?.drivers ?? 0),
      races: Number(row?.races ?? 0),
      entries: Number(row?.entries ?? 0),
      results
    },
    trends: {
      available: results > 0,
      reason: results > 0 ? null : 'Historiska resultat är ännu inte importerade.'
    }
  };
}

export async function searchEntities(env, query, limitValue) {
  const q = sanitizeQuery(query);
  if (!q) return [];
  const limit = clampLimit(limitValue, 20, 40);
  const like = escapedLike(q);
  const { results } = await env.DB.prepare(`
    SELECT type, id, name FROM (
      SELECT 'horse' AS type, id, canonical_name AS name FROM horses WHERE canonical_name LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'trainer' AS type, id, canonical_name AS name FROM trainers WHERE canonical_name LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'driver' AS type, id, canonical_name AS name FROM drivers WHERE canonical_name LIKE ? ESCAPE '\\'
    )
    ORDER BY name COLLATE NOCASE ASC, type ASC, id ASC
    LIMIT ?
  `).bind(like, like, like, limit).all();
  return results;
}

export async function listEntities(env, type, options = {}) {
  const config = configFor(type);
  const q = sanitizeQuery(options.q);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const like = escapedLike(q);
  const filter = q ? `WHERE ${config.nameColumn} LIKE ? ESCAPE '\\'` : '';

  const listStatement = env.DB.prepare(`
    SELECT ${config.idColumn} AS id, ${config.nameColumn} AS name
    FROM ${config.table}
    ${filter}
    ORDER BY ${config.nameColumn} COLLATE NOCASE ASC, ${config.idColumn} ASC
    LIMIT ? OFFSET ?
  `);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total FROM ${config.table} ${filter}`);

  const [{ results }, countRow] = q
    ? await Promise.all([listStatement.bind(like, limit, offset).all(), countStatement.bind(like).first()])
    : await Promise.all([listStatement.bind(limit, offset).all(), countStatement.first()]);

  const total = Number(countRow?.total ?? 0);
  return { type, label: config.label, items: results, total, limit, offset, hasMore: offset + results.length < total };
}

async function latestObservation(env, entityType, id) {
  const row = await env.DB.prepare(`
    SELECT observed_at, fields_json, quality_status
    FROM normalized_observations
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY observed_at DESC, created_at DESC, id DESC
    LIMIT 1
  `).bind(entityType, id).first();
  if (!row) return null;
  return { observedAt: row.observed_at, qualityStatus: row.quality_status, fields: parseJson(row.fields_json) || {} };
}

async function getStats(env, relationColumn, id) {
  const row = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN re.scratched = 0 THEN 1 ELSE 0 END) AS database_starts,
      SUM(CASE WHEN re.scratched = 1 THEN 1 ELSE 0 END) AS scratched_entries,
      COUNT(DISTINCT re.horse_id) AS linked_horses,
      SUM(CASE WHEN re.scratched = 0 AND rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN re.scratched = 0 AND rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN re.scratched = 0 AND rr.placing = 2 THEN 1 ELSE 0 END) AS seconds,
      SUM(CASE WHEN re.scratched = 0 AND rr.placing = 3 THEN 1 ELSE 0 END) AS thirds,
      SUM(CASE WHEN re.scratched = 0 AND rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN re.scratched = 0 AND rr.gallop = 1 THEN 1 ELSE 0 END) AS gallops,
      SUM(CASE WHEN re.scratched = 0 AND rr.disqualified = 1 THEN 1 ELSE 0 END) AS disqualifications,
      SUM(CASE WHEN re.scratched = 0 AND rr.race_entry_id IS NOT NULL THEN COALESCE(rr.prize_sek, 0) ELSE 0 END) AS prize_sek,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (
        SELECT 1 FROM game_legs gl JOIN game_rounds gr ON gr.id = gl.game_round_id
        WHERE gl.race_id = re.race_id AND gr.game_type = 'V85'
      ) THEN 1 ELSE 0 END) AS v85_starts,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (
        SELECT 1 FROM game_legs gl JOIN game_rounds gr ON gr.id = gl.game_round_id
        WHERE gl.race_id = re.race_id AND gr.game_type = 'V86'
      ) THEN 1 ELSE 0 END) AS v86_starts
    FROM race_entries re
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ?
  `).bind(id).first();
  const resultStarts = Number(row?.result_starts ?? 0);
  const wins = Number(row?.wins ?? 0);
  const top3 = Number(row?.top3 ?? 0);
  return {
    databaseStarts: Number(row?.database_starts ?? 0),
    scratchedEntries: Number(row?.scratched_entries ?? 0),
    linkedHorses: Number(row?.linked_horses ?? 0),
    resultStarts,
    wins,
    seconds: Number(row?.seconds ?? 0),
    thirds: Number(row?.thirds ?? 0),
    top3,
    gallops: Number(row?.gallops ?? 0),
    disqualifications: Number(row?.disqualifications ?? 0),
    prizeSek: Number(row?.prize_sek ?? 0),
    v85Starts: Number(row?.v85_starts ?? 0),
    v86Starts: Number(row?.v86_starts ?? 0),
    winRate: resultStarts ? wins / resultStarts : null,
    top3Rate: resultStarts ? top3 / resultStarts : null
  };
}

async function getBreakdowns(env, relationColumn, id) {
  const { results: methods } = await env.DB.prepare(`
    SELECT COALESCE(r.start_method, 'unknown') AS label,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ? AND re.scratched = 0
    GROUP BY COALESCE(r.start_method, 'unknown')
    ORDER BY starts DESC, label ASC
  `).bind(id).all();

  const { results: distances } = await env.DB.prepare(`
    SELECT COALESCE(CAST(r.distance_m AS TEXT), 'unknown') AS label,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ? AND re.scratched = 0
    GROUP BY r.distance_m
    ORDER BY starts DESC, r.distance_m ASC
  `).bind(id).all();

  const { results: tracks } = await env.DB.prepare(`
    SELECT COALESCE(t.canonical_name, 'Okänd bana') AS label,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ? AND re.scratched = 0
    GROUP BY t.id, t.canonical_name
    ORDER BY starts DESC, label COLLATE NOCASE ASC
    LIMIT 20
  `).bind(id).all();

  const map = (rows) => rows.map((row) => {
    const resultStarts = Number(row.result_starts ?? 0);
    const wins = Number(row.wins ?? 0);
    const top3 = Number(row.top3 ?? 0);
    return {
      label: row.label,
      starts: Number(row.starts ?? 0),
      resultStarts,
      wins,
      top3,
      winRate: resultStarts ? wins / resultStarts : null,
      top3Rate: resultStarts ? top3 / resultStarts : null
    };
  });
  return { startMethods: map(methods), distances: map(distances), tracks: map(tracks) };
}

async function getBaseStarts(env, relationColumn, id) {
  const { results } = await env.DB.prepare(`
    SELECT
      re.id AS entry_id,
      r.id AS race_id,
      r.race_date,
      r.race_number,
      r.scheduled_start_at,
      r.distance_m,
      r.start_method,
      r.field_size,
      r.starters_declared,
      r.first_prize_sek,
      r.race_name,
      r.main_class,
      r.class_flags_json,
      r.status AS race_status,
      r.source_quality,
      h.id AS horse_id,
      h.canonical_name AS horse_name,
      t.canonical_name AS track_name,
      d.id AS driver_id,
      d.canonical_name AS driver_name,
      trn.id AS trainer_id,
      trn.canonical_name AS trainer_name,
      re.start_number,
      re.actual_lane,
      re.start_tier,
      re.handicap_m,
      re.actual_start_distance_m,
      re.springspar,
      re.inner_lane,
      re.back_row,
      re.scratched,
      re.scratch_reason,
      re.data_quality,
      rr.placing,
      rr.placing_text,
      rr.finish_time,
      rr.km_time,
      rr.prize_sek,
      rr.gallop,
      rr.disqualified,
      rr.distance_behind_winner_m,
      rr.official_odds,
      rr.result_status,
      rc.track_status,
      rc.temperature_c,
      rc.wind_mps,
      rc.wind_direction,
      rc.precipitation_mm,
      rc.weather_text,
      rc.day_profile_json,
      gr.game_type,
      gl.leg_number
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN horses h ON h.id = re.horse_id
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN trainers trn ON trn.id = re.trainer_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    LEFT JOIN race_conditions rc ON rc.race_id = r.id
    LEFT JOIN game_legs gl ON gl.race_id = r.id
    LEFT JOIN game_rounds gr ON gr.id = gl.game_round_id
    WHERE re.${relationColumn} = ?
    ORDER BY r.race_date DESC, r.race_number DESC, re.start_number ASC
    LIMIT 100
  `).bind(id).all();
  return results.map((row) => ({
    ...row,
    class_flags: parseJson(row.class_flags_json),
    day_profile: parseJson(row.day_profile_json)
  }));
}

async function rowsByEntry(env, tableSql, entryIds) {
  if (!entryIds.length) return [];
  const placeholders = entryIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(tableSql.replaceAll('__IDS__', placeholders)).bind(...entryIds).all();
  return results;
}

function groupBy(rows, keyName) {
  const map = new Map();
  for (const row of rows) {
    const key = row[keyName];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function latestPer(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function equipmentItem(row) {
  return {
    shoesFront: row.shoes_front,
    shoesRear: row.shoes_rear,
    barefootFront: row.barefoot_front == null ? null : Boolean(row.barefoot_front),
    barefootRear: row.barefoot_rear == null ? null : Boolean(row.barefoot_rear),
    sulkyType: row.sulky_type,
    exactSulky: row.exact_sulky,
    headgear: row.headgear,
    earplugs: row.earplugs,
    otherEquipment: row.other_equipment,
    changes: parseJson(row.change_from_previous_json),
    verificationStatus: row.verification_status,
    observedAt: row.observed_at
  };
}

function xlabsItem(row) {
  return {
    first200Time: row.first_200_time,
    last200Time: row.last_200_time,
    last400Time: row.last_400_time,
    last500Time: row.last_500_time,
    last800Time: row.last_800_time,
    last1000Time: row.last_1000_time,
    actualDistanceM: numeric(row.actual_distance_m),
    extraDistanceM: numeric(row.extra_distance_m),
    convertedKmTime: row.converted_km_time,
    slipstreamM: numeric(row.slipstream_m),
    segments: parseJson(row.segments_json),
    qualityStatus: row.quality_status,
    observedAt: row.observed_at
  };
}

async function enrichStarts(env, starts) {
  const entryIds = starts.map((row) => row.entry_id);
  if (!entryIds.length) return starts;

  const [bettingRows, oddsRows, equipmentRows, xlabsRows, positionRows, featureRows, predictionRows, editorialRows] = await Promise.all([
    rowsByEntry(env, `
      SELECT race_entry_id, captured_at, bet_percent, market_rank
      FROM betting_snapshots WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, captured_at DESC, id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, captured_at, market_type, odds
      FROM odds_snapshots WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, captured_at DESC, market_type ASC, id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT e.race_entry_id, e.shoes_front, e.shoes_rear, e.barefoot_front, e.barefoot_rear, e.sulky_type,
             e.exact_sulky, e.headgear, e.earplugs, e.other_equipment, e.change_from_previous_json,
             e.verification_status, sr.fetched_at AS observed_at
      FROM equipment e LEFT JOIN source_records sr ON sr.id = e.source_record_id
      WHERE e.race_entry_id IN (__IDS__)
      ORDER BY e.race_entry_id, COALESCE(sr.fetched_at, '') DESC, e.id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT x.race_entry_id, x.first_200_time, x.last_200_time, x.last_400_time, x.last_500_time, x.last_800_time,
             x.last_1000_time, x.actual_distance_m, x.extra_distance_m, x.converted_km_time, x.slipstream_m,
             x.segments_json, x.quality_status, sr.fetched_at AS observed_at
      FROM xlabs_data x LEFT JOIN source_records sr ON sr.id = x.source_record_id
      WHERE x.race_entry_id IN (__IDS__)
      ORDER BY x.race_entry_id, COALESCE(sr.fetched_at, '') DESC, x.id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, observed_at_m, position, lane, leader, pocket, death_seat, second_over, third_over,
             wide_trip, uncovered_move, traffic_event, event_json
      FROM race_positions WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, observed_at_m ASC, id ASC
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, feature_name, numeric_value, text_value, uncertainty_low, uncertainty_high,
             data_quality, provenance_json, as_of, feature_version
      FROM analysis_features WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, feature_name ASC, as_of DESC, id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT ahp.race_entry_id, ara.id AS analysis_id, ara.data_snapshot_at, ara.market_blind,
             ara.scenarios_json, ara.race_shape_summary, ara.conclusion, ara.data_quality AS analysis_data_quality,
             ara.analysis_origin, ara.method_note, ara.created_at,
             mv.id AS model_version_id, mv.feature_version, mv.prompt_version, mv.ai_provider, mv.ai_model,
             ahp.win_probability, ahp.uncertainty_low, ahp.uncertainty_high, ahp.raw_rank, ahp.abcd_group,
             ahp.value_ratio, ahp.scenario_robustness, ahp.reasoning_json
      FROM ai_horse_predictions ahp
      JOIN ai_race_analyses ara ON ara.id = ahp.ai_race_analysis_id
      LEFT JOIN model_versions mv ON mv.id = ara.model_version_id
      WHERE ahp.race_entry_id IN (__IDS__)
      ORDER BY ahp.race_entry_id, ara.data_snapshot_at DESC, ara.created_at DESC, ara.id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT ei.race_entry_id, ei.race_id, ei.horse_id, ei.published_at, ei.summary_text,
             es.signal_type, es.value_text, es.polarity, es.strength, es.fact_or_opinion, es.confidence,
             es.evidence_excerpt
      FROM editorial_items ei
      JOIN editorial_signals es ON es.editorial_item_id = ei.id
      WHERE ei.race_entry_id IN (__IDS__)
      ORDER BY ei.race_entry_id, COALESCE(ei.published_at, '') DESC, es.created_at DESC, es.id DESC
    `, entryIds)
  ]);

  const betting = groupBy(bettingRows, 'race_entry_id');
  const odds = groupBy(oddsRows, 'race_entry_id');
  const equipment = groupBy(equipmentRows, 'race_entry_id');
  const xlabs = groupBy(xlabsRows, 'race_entry_id');
  const positions = groupBy(positionRows, 'race_entry_id');
  const features = groupBy(featureRows, 'race_entry_id');
  const predictions = groupBy(predictionRows, 'race_entry_id');
  const editorial = groupBy(editorialRows, 'race_entry_id');

  return starts.map((row) => {
    const betHistory = (betting.get(row.entry_id) || []).map((item) => ({
      capturedAt: item.captured_at,
      betPercent: numeric(item.bet_percent),
      marketRank: numeric(item.market_rank)
    }));
    const oddsHistory = (odds.get(row.entry_id) || []).map((item) => ({
      capturedAt: item.captured_at,
      marketType: item.market_type,
      odds: numeric(item.odds)
    }));
    const equipmentHistory = (equipment.get(row.entry_id) || []).map(equipmentItem);
    const xlabsHistory = (xlabs.get(row.entry_id) || []).map(xlabsItem);
    const featureHistory = (features.get(row.entry_id) || []).map((item) => ({
      name: item.feature_name,
      numericValue: numeric(item.numeric_value),
      textValue: item.text_value,
      uncertaintyLow: numeric(item.uncertainty_low),
      uncertaintyHigh: numeric(item.uncertainty_high),
      dataQuality: item.data_quality,
      provenance: parseJson(item.provenance_json),
      asOf: item.as_of,
      featureVersion: item.feature_version
    }));
    const aiAnalyses = (predictions.get(row.entry_id) || []).map((item) => ({
      analysisId: item.analysis_id,
      dataSnapshotAt: item.data_snapshot_at,
      marketBlind: Boolean(item.market_blind),
      scenarios: parseJson(item.scenarios_json),
      raceShapeSummary: item.race_shape_summary,
      conclusion: item.conclusion,
      dataQuality: item.analysis_data_quality,
      analysisOrigin: item.analysis_origin,
      methodNote: item.method_note,
      createdAt: item.created_at,
      modelVersionId: item.model_version_id,
      featureVersion: item.feature_version,
      promptVersion: item.prompt_version,
      aiProvider: item.ai_provider,
      aiModel: item.ai_model,
      winProbability: numeric(item.win_probability),
      uncertaintyLow: numeric(item.uncertainty_low),
      uncertaintyHigh: numeric(item.uncertainty_high),
      rawRank: numeric(item.raw_rank),
      abcdGroup: item.abcd_group,
      valueRatio: numeric(item.value_ratio),
      scenarioRobustness: numeric(item.scenario_robustness),
      reasoning: parseJson(item.reasoning_json)
    }));
    const editorialSignals = (editorial.get(row.entry_id) || []).map((item) => ({
      publishedAt: item.published_at,
      summary: item.summary_text,
      signalType: item.signal_type,
      valueText: item.value_text,
      polarity: item.polarity,
      strength: numeric(item.strength),
      factOrOpinion: item.fact_or_opinion,
      confidence: numeric(item.confidence),
      evidenceExcerpt: item.evidence_excerpt
    }));

    return {
      ...row,
      scratched: Boolean(row.scratched),
      gallop: row.gallop == null ? null : Boolean(row.gallop),
      disqualified: row.disqualified == null ? null : Boolean(row.disqualified),
      betting: betHistory[0] || null,
      bettingHistory: betHistory,
      odds: latestPer(oddsHistory, (item) => item.marketType),
      oddsHistory,
      equipment: equipmentHistory[0] || null,
      equipmentHistory,
      xlabs: xlabsHistory[0] || null,
      xlabsHistory,
      positions: (positions.get(row.entry_id) || []).map((item) => ({
        observedAtM: numeric(item.observed_at_m),
        position: numeric(item.position),
        lane: numeric(item.lane),
        leader: item.leader == null ? null : Boolean(item.leader),
        pocket: item.pocket == null ? null : Boolean(item.pocket),
        deathSeat: item.death_seat == null ? null : Boolean(item.death_seat),
        secondOver: item.second_over == null ? null : Boolean(item.second_over),
        thirdOver: item.third_over == null ? null : Boolean(item.third_over),
        wideTrip: item.wide_trip == null ? null : Boolean(item.wide_trip),
        uncoveredMove: item.uncovered_move == null ? null : Boolean(item.uncovered_move),
        trafficEvent: item.traffic_event,
        event: parseJson(item.event_json)
      })),
      features: latestPer(featureHistory, (item) => item.name),
      featureHistory,
      aiAnalyses,
      editorialSignals
    };
  });
}

async function getCoverage(env, relationColumn, id) {
  const row = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN re.scratched = 0 THEN 1 ELSE 0 END) AS starts,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM betting_snapshots bs WHERE bs.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_market,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM odds_snapshots os WHERE os.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_odds,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM equipment eq WHERE eq.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_equipment,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM xlabs_data xd WHERE xd.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_xlabs,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM race_positions rp WHERE rp.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_positions,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM analysis_features af WHERE af.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_features,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM ai_horse_predictions ahp WHERE ahp.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_ai,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM editorial_items ei WHERE ei.race_entry_id = re.id) THEN 1 ELSE 0 END) AS starts_with_editorial,
      SUM(CASE WHEN re.scratched = 0 AND EXISTS (SELECT 1 FROM race_conditions rc WHERE rc.race_id = re.race_id) THEN 1 ELSE 0 END) AS starts_with_conditions
    FROM race_entries re
    WHERE re.${relationColumn} = ?
  `).bind(id).first();
  return {
    starts: Number(row?.starts ?? 0),
    startsWithMarket: Number(row?.starts_with_market ?? 0),
    startsWithOdds: Number(row?.starts_with_odds ?? 0),
    startsWithEquipment: Number(row?.starts_with_equipment ?? 0),
    startsWithXLabs: Number(row?.starts_with_xlabs ?? 0),
    startsWithPositions: Number(row?.starts_with_positions ?? 0),
    startsWithFeatures: Number(row?.starts_with_features ?? 0),
    startsWithAi: Number(row?.starts_with_ai ?? 0),
    startsWithEditorial: Number(row?.starts_with_editorial ?? 0),
    startsWithConditions: Number(row?.starts_with_conditions ?? 0)
  };
}

async function getHorseDetail(env, id) {
  const horse = await env.DB.prepare(`
    SELECT
      h.id, h.canonical_name AS name, h.sex, h.birth_year, h.breed, h.color, h.sire_name, h.dam_name,
      h.damsire_name, h.breeder, h.owner, h.country_code, h.active, h.career_earnings_sek, h.record_text,
      t.id AS trainer_id, t.canonical_name AS trainer_name, tr.canonical_name AS home_track_name
    FROM horses h
    LEFT JOIN trainers t ON t.id = h.current_trainer_id
    LEFT JOIN tracks tr ON tr.id = h.home_track_id
    WHERE h.id = ? LIMIT 1
  `).bind(id).first();
  if (!horse) return null;

  const [observation, stats, breakdowns, coverage, baseStarts] = await Promise.all([
    latestObservation(env, 'horse', id),
    getStats(env, 'horse_id', id),
    getBreakdowns(env, 'horse_id', id),
    getCoverage(env, 'horse_id', id),
    getBaseStarts(env, 'horse_id', id)
  ]);
  const starts = await enrichStarts(env, baseStarts);
  return { type: 'horse', entity: horse, latestObservation: observation, stats, breakdowns, coverage, starts };
}

async function getPersonDetail(env, type, id) {
  const driver = type === 'drivers';
  const table = driver ? 'drivers' : 'trainers';
  const entityType = driver ? 'driver' : 'trainer';
  const relationColumn = driver ? 'driver_id' : 'trainer_id';
  const person = await env.DB.prepare(`
    SELECT p.id, p.canonical_name AS name, p.country_code, p.active,
      ${driver ? 'tr.canonical_name AS home_track_name' : 'NULL AS home_track_name'}
    FROM ${table} p
    ${driver ? 'LEFT JOIN tracks tr ON tr.id = p.home_track_id' : ''}
    WHERE p.id = ? LIMIT 1
  `).bind(id).first();
  if (!person) return null;

  const [observation, stats, breakdowns, coverage, baseStarts] = await Promise.all([
    latestObservation(env, entityType, id),
    getStats(env, relationColumn, id),
    getBreakdowns(env, relationColumn, id),
    getCoverage(env, relationColumn, id),
    getBaseStarts(env, relationColumn, id)
  ]);
  const starts = await enrichStarts(env, baseStarts);
  return { type: entityType, entity: person, latestObservation: observation, stats, breakdowns, coverage, starts };
}

export async function getEntityDetail(env, type, id) {
  configFor(type);
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  if (type === 'horses') return getHorseDetail(env, normalizedId);
  return getPersonDetail(env, type, normalizedId);
}
