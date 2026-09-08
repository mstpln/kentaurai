const ENTITY_RELATIONS = {
  horses: { relationColumn: 'horse_id', entityType: 'horse' },
  trainers: { relationColumn: 'trainer_id', entityType: 'trainer' },
  drivers: { relationColumn: 'driver_id', entityType: 'driver' }
};

function configFor(type) {
  const config = ENTITY_RELATIONS[type];
  if (!config) throw new Error('unsupported entity type');
  return config;
}

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000);
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function numeric(value) {
  return value == null ? null : Number(value);
}

function booleanOrNull(value) {
  return value == null ? null : Boolean(value);
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

async function rowsByEntry(env, sql, entryIds) {
  if (!entryIds.length) return [];
  const placeholders = entryIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(sql.replaceAll('__IDS__', placeholders)).bind(...entryIds).all();
  return results;
}

function equipmentItem(row) {
  return {
    shoesFront: row.shoes_front,
    shoesRear: row.shoes_rear,
    barefootFront: booleanOrNull(row.barefoot_front),
    barefootRear: booleanOrNull(row.barefoot_rear),
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

async function enrichPage(env, starts) {
  const entryIds = starts.map((row) => row.entry_id);
  if (!entryIds.length) return [];

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
             data_quality, as_of, feature_version
      FROM analysis_features WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, feature_name ASC, as_of DESC, id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT ahp.race_entry_id, ara.data_snapshot_at, ara.market_blind, ara.scenarios_json,
             ara.race_shape_summary, ara.conclusion, ara.data_quality AS analysis_data_quality,
             ara.analysis_origin, ara.method_note, ara.created_at,
             mv.feature_version, mv.prompt_version, mv.ai_model,
             ahp.win_probability, ahp.uncertainty_low, ahp.uncertainty_high, ahp.raw_rank,
             ahp.abcd_group, ahp.value_ratio, ahp.scenario_robustness, ahp.reasoning_json
      FROM ai_horse_predictions ahp
      JOIN ai_race_analyses ara ON ara.id = ahp.ai_race_analysis_id
      LEFT JOIN model_versions mv ON mv.id = ara.model_version_id
      WHERE ahp.race_entry_id IN (__IDS__)
      ORDER BY ahp.race_entry_id, ara.data_snapshot_at DESC, ara.created_at DESC, ara.id DESC
    `, entryIds),
    rowsByEntry(env, `
      SELECT ei.race_entry_id, ei.published_at, ei.summary_text,
             es.signal_type, es.value_text, es.polarity, es.strength, es.fact_or_opinion,
             es.confidence, es.evidence_excerpt
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
      asOf: item.as_of,
      featureVersion: item.feature_version
    }));
    const aiAnalyses = (predictions.get(row.entry_id) || []).map((item) => ({
      dataSnapshotAt: item.data_snapshot_at,
      marketBlind: Boolean(item.market_blind),
      scenarios: parseJson(item.scenarios_json),
      raceShapeSummary: item.race_shape_summary,
      conclusion: item.conclusion,
      dataQuality: item.analysis_data_quality,
      analysisOrigin: item.analysis_origin,
      methodNote: item.method_note,
      createdAt: item.created_at,
      featureVersion: item.feature_version,
      promptVersion: item.prompt_version,
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

    const { entry_id: _entryId, race_id: _raceId, class_flags_json: _classFlagsJson, day_profile_json: _dayProfileJson, ...safe } = row;
    return {
      ...safe,
      class_flags: parseJson(row.class_flags_json),
      day_profile: parseJson(row.day_profile_json),
      scratched: Boolean(row.scratched),
      gallop: booleanOrNull(row.gallop),
      disqualified: booleanOrNull(row.disqualified),
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
        leader: booleanOrNull(item.leader),
        pocket: booleanOrNull(item.pocket),
        deathSeat: booleanOrNull(item.death_seat),
        secondOver: booleanOrNull(item.second_over),
        thirdOver: booleanOrNull(item.third_over),
        wideTrip: booleanOrNull(item.wide_trip),
        uncoveredMove: booleanOrNull(item.uncovered_move),
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

export async function getEntityStartHistory(env, type, id, options = {}) {
  const { relationColumn, entityType } = configFor(type);
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('entity id is required');
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM race_entries WHERE ${relationColumn} = ?
  `).bind(entityId).first();
  const total = Number(count?.total ?? 0);

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
      d.canonical_name AS driver_name,
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
      (SELECT gr.game_type
       FROM game_legs gl JOIN game_rounds gr ON gr.id = gl.game_round_id
       WHERE gl.race_id = r.id
       ORDER BY gr.round_date DESC, gr.id DESC LIMIT 1) AS game_type,
      (SELECT gl.leg_number
       FROM game_legs gl JOIN game_rounds gr ON gr.id = gl.game_round_id
       WHERE gl.race_id = r.id
       ORDER BY gr.round_date DESC, gr.id DESC LIMIT 1) AS leg_number
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN horses h ON h.id = re.horse_id
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN trainers trn ON trn.id = re.trainer_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    LEFT JOIN race_conditions rc ON rc.race_id = r.id
    WHERE re.${relationColumn} = ?
    ORDER BY r.race_date DESC, r.race_number DESC, re.start_number ASC, re.id ASC
    LIMIT ? OFFSET ?
  `).bind(entityId, limit, offset).all();

  const items = await enrichPage(env, results);
  return {
    type: entityType,
    entityId,
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total
  };
}
