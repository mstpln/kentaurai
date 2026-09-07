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
  const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
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
  const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
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
      COUNT(*) AS database_starts,
      COUNT(DISTINCT re.horse_id) AS linked_horses,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS result_starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing = 2 THEN 1 ELSE 0 END) AS seconds,
      SUM(CASE WHEN rr.placing = 3 THEN 1 ELSE 0 END) AS thirds,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(CASE WHEN rr.gallop = 1 THEN 1 ELSE 0 END) AS gallops,
      SUM(CASE WHEN rr.disqualified = 1 THEN 1 ELSE 0 END) AS disqualifications,
      SUM(CASE WHEN rr.race_entry_id IS NOT NULL THEN COALESCE(rr.prize_sek, 0) ELSE 0 END) AS prize_sek,
      SUM(CASE WHEN gr.game_type = 'V85' THEN 1 ELSE 0 END) AS v85_starts,
      SUM(CASE WHEN gr.game_type = 'V86' THEN 1 ELSE 0 END) AS v86_starts
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    LEFT JOIN game_legs gl ON gl.race_id = r.id
    LEFT JOIN game_rounds gr ON gr.id = gl.game_round_id
    WHERE re.${relationColumn} = ?
  `).bind(id).first();
  const resultStarts = Number(row?.result_starts ?? 0);
  const wins = Number(row?.wins ?? 0);
  const top3 = Number(row?.top3 ?? 0);
  return {
    databaseStarts: Number(row?.database_starts ?? 0),
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
    WHERE re.${relationColumn} = ?
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
    WHERE re.${relationColumn} = ?
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
    WHERE re.${relationColumn} = ?
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
  const horseProjection = relationColumn === 'horse_id' ? 'NULL AS horse_id, NULL AS horse_name,' : 'h.id AS horse_id, h.canonical_name AS horse_name,';
  const horseJoin = relationColumn === 'horse_id' ? '' : 'JOIN horses h ON h.id = re.horse_id';
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
      r.first_prize_sek,
      r.race_name,
      r.main_class,
      r.status AS race_status,
      r.source_quality,
      ${horseProjection}
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
      gr.game_type,
      gl.leg_number
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    ${horseJoin}
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN trainers trn ON trn.id = re.trainer_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    LEFT JOIN race_conditions rc ON rc.race_id = r.id
    LEFT JOIN game_legs gl ON gl.race_id = r.id
    LEFT JOIN game_rounds gr ON gr.id = gl.game_round_id
    WHERE re.${relationColumn} = ?
    ORDER BY r.race_date DESC, r.race_number DESC, re.start_number ASC
  `).bind(id).all();
  return results;
}

async function rowsByEntry(env, tableSql, entryIds) {
  if (!entryIds.length) return [];
  const placeholders = entryIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(tableSql.replace('__IDS__', placeholders)).bind(...entryIds).all();
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

async function enrichStarts(env, starts) {
  const entryIds = starts.map((row) => row.entry_id);
  if (!entryIds.length) return starts;

  const [bettingRows, oddsRows, equipmentRows, xlabsRows, positionRows, featureRows] = await Promise.all([
    rowsByEntry(env, `
      SELECT race_entry_id, captured_at, bet_percent, market_rank FROM (
        SELECT bs.*, ROW_NUMBER() OVER (PARTITION BY race_entry_id ORDER BY captured_at DESC, id DESC) AS rn
        FROM betting_snapshots bs WHERE race_entry_id IN (__IDS__)
      ) WHERE rn = 1
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, captured_at, market_type, odds FROM (
        SELECT os.*, ROW_NUMBER() OVER (PARTITION BY race_entry_id, market_type ORDER BY captured_at DESC, id DESC) AS rn
        FROM odds_snapshots os WHERE race_entry_id IN (__IDS__)
      ) WHERE rn = 1 ORDER BY race_entry_id, market_type
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear, sulky_type, exact_sulky,
             headgear, earplugs, other_equipment, change_from_previous_json, verification_status, observed_at
      FROM (
        SELECT e.*, sr.fetched_at AS observed_at,
          ROW_NUMBER() OVER (PARTITION BY e.race_entry_id ORDER BY COALESCE(sr.fetched_at, '') DESC, e.id DESC) AS rn
        FROM equipment e LEFT JOIN source_records sr ON sr.id = e.source_record_id
        WHERE e.race_entry_id IN (__IDS__)
      ) WHERE rn = 1
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, first_200_time, last_200_time, last_400_time, last_500_time, last_800_time,
             last_1000_time, actual_distance_m, extra_distance_m, converted_km_time, slipstream_m,
             segments_json, quality_status, observed_at
      FROM (
        SELECT x.*, sr.fetched_at AS observed_at,
          ROW_NUMBER() OVER (PARTITION BY x.race_entry_id ORDER BY COALESCE(sr.fetched_at, '') DESC, x.id DESC) AS rn
        FROM xlabs_data x LEFT JOIN source_records sr ON sr.id = x.source_record_id
        WHERE x.race_entry_id IN (__IDS__)
      ) WHERE rn = 1
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, observed_at_m, position, lane, leader, pocket, death_seat, second_over, third_over,
             wide_trip, uncovered_move, traffic_event
      FROM race_positions WHERE race_entry_id IN (__IDS__)
      ORDER BY race_entry_id, observed_at_m ASC, id ASC
    `, entryIds),
    rowsByEntry(env, `
      SELECT race_entry_id, feature_name, numeric_value, text_value, uncertainty_low, uncertainty_high,
             data_quality, as_of, feature_version
      FROM (
        SELECT af.*, ROW_NUMBER() OVER (PARTITION BY race_entry_id, feature_name ORDER BY as_of DESC, id DESC) AS rn
        FROM analysis_features af WHERE race_entry_id IN (__IDS__)
      ) WHERE rn = 1 ORDER BY race_entry_id, feature_name
    `, entryIds)
  ]);

  const betting = new Map(bettingRows.map((row) => [row.race_entry_id, row]));
  const odds = groupBy(oddsRows, 'race_entry_id');
  const equipment = new Map(equipmentRows.map((row) => [row.race_entry_id, row]));
  const xlabs = new Map(xlabsRows.map((row) => [row.race_entry_id, row]));
  const positions = groupBy(positionRows, 'race_entry_id');
  const features = groupBy(featureRows, 'race_entry_id');

  return starts.map((row) => {
    const equip = equipment.get(row.entry_id) || null;
    const xlab = xlabs.get(row.entry_id) || null;
    return {
      ...row,
      scratched: Boolean(row.scratched),
      gallop: row.gallop == null ? null : Boolean(row.gallop),
      disqualified: row.disqualified == null ? null : Boolean(row.disqualified),
      betting: betting.has(row.entry_id) ? {
        capturedAt: betting.get(row.entry_id).captured_at,
        betPercent: numeric(betting.get(row.entry_id).bet_percent),
        marketRank: numeric(betting.get(row.entry_id).market_rank)
      } : null,
      odds: (odds.get(row.entry_id) || []).map((item) => ({ capturedAt: item.captured_at, marketType: item.market_type, odds: numeric(item.odds) })),
      equipment: equip ? {
        shoesFront: equip.shoes_front,
        shoesRear: equip.shoes_rear,
        barefootFront: equip.barefoot_front == null ? null : Boolean(equip.barefoot_front),
        barefootRear: equip.barefoot_rear == null ? null : Boolean(equip.barefoot_rear),
        sulkyType: equip.sulky_type,
        exactSulky: equip.exact_sulky,
        headgear: equip.headgear,
        earplugs: equip.earplugs,
        otherEquipment: equip.other_equipment,
        changes: parseJson(equip.change_from_previous_json),
        verificationStatus: equip.verification_status,
        observedAt: equip.observed_at
      } : null,
      xlabs: xlab ? {
        first200Time: xlab.first_200_time,
        last200Time: xlab.last_200_time,
        last400Time: xlab.last_400_time,
        last500Time: xlab.last_500_time,
        last800Time: xlab.last_800_time,
        last1000Time: xlab.last_1000_time,
        actualDistanceM: numeric(xlab.actual_distance_m),
        extraDistanceM: numeric(xlab.extra_distance_m),
        convertedKmTime: xlab.converted_km_time,
        slipstreamM: numeric(xlab.slipstream_m),
        segments: parseJson(xlab.segments_json),
        qualityStatus: xlab.quality_status,
        observedAt: xlab.observed_at
      } : null,
      positions: (positions.get(row.entry_id) || []).map((item) => ({
        observedAtM: numeric(item.observed_at_m), position: numeric(item.position), lane: numeric(item.lane),
        leader: item.leader == null ? null : Boolean(item.leader), pocket: item.pocket == null ? null : Boolean(item.pocket),
        deathSeat: item.death_seat == null ? null : Boolean(item.death_seat), secondOver: item.second_over == null ? null : Boolean(item.second_over),
        thirdOver: item.third_over == null ? null : Boolean(item.third_over), wideTrip: item.wide_trip == null ? null : Boolean(item.wide_trip),
        uncoveredMove: item.uncovered_move == null ? null : Boolean(item.uncovered_move), trafficEvent: item.traffic_event
      })),
      features: (features.get(row.entry_id) || []).map((item) => ({
        name: item.feature_name, numericValue: numeric(item.numeric_value), textValue: item.text_value,
        uncertaintyLow: numeric(item.uncertainty_low), uncertaintyHigh: numeric(item.uncertainty_high),
        dataQuality: item.data_quality, asOf: item.as_of, featureVersion: item.feature_version
      }))
    };
  });
}

async function getCoverage(env, relationColumn, id) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(DISTINCT re.id) AS starts,
      COUNT(DISTINCT CASE WHEN bs.id IS NOT NULL THEN re.id END) AS starts_with_market,
      COUNT(DISTINCT CASE WHEN os.id IS NOT NULL THEN re.id END) AS starts_with_odds,
      COUNT(DISTINCT CASE WHEN eq.id IS NOT NULL THEN re.id END) AS starts_with_equipment,
      COUNT(DISTINCT CASE WHEN xd.id IS NOT NULL THEN re.id END) AS starts_with_xlabs,
      COUNT(DISTINCT CASE WHEN rp.id IS NOT NULL THEN re.id END) AS starts_with_positions,
      COUNT(DISTINCT CASE WHEN af.id IS NOT NULL THEN re.id END) AS starts_with_features
    FROM race_entries re
    LEFT JOIN betting_snapshots bs ON bs.race_entry_id = re.id
    LEFT JOIN odds_snapshots os ON os.race_entry_id = re.id
    LEFT JOIN equipment eq ON eq.race_entry_id = re.id
    LEFT JOIN xlabs_data xd ON xd.race_entry_id = re.id
    LEFT JOIN race_positions rp ON rp.race_entry_id = re.id
    LEFT JOIN analysis_features af ON af.race_entry_id = re.id
    WHERE re.${relationColumn} = ?
  `).bind(id).first();
  return {
    starts: Number(row?.starts ?? 0),
    startsWithMarket: Number(row?.starts_with_market ?? 0),
    startsWithOdds: Number(row?.starts_with_odds ?? 0),
    startsWithEquipment: Number(row?.starts_with_equipment ?? 0),
    startsWithXLabs: Number(row?.starts_with_xlabs ?? 0),
    startsWithPositions: Number(row?.starts_with_positions ?? 0),
    startsWithFeatures: Number(row?.starts_with_features ?? 0)
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
    latestObservation(env, 'horse', id), getStats(env, 'horse_id', id), getBreakdowns(env, 'horse_id', id),
    getCoverage(env, 'horse_id', id), getBaseStarts(env, 'horse_id', id)
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
    latestObservation(env, entityType, id), getStats(env, relationColumn, id), getBreakdowns(env, relationColumn, id),
    getCoverage(env, relationColumn, id), getBaseStarts(env, relationColumn, id)
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
