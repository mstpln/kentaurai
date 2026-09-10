import { stableId } from './ids.js';

export const ANALYSIS_CONTEXT_VERSION = 'kentaurai-analysis-context-v1';
export const ANALYSIS_SUBMISSION_VERSION = 'kentaurai-analysis-v1';
const FEATURE_VERSION = 'analysis-exchange-v1';
const HISTORY_LIMIT = 5;
const PROBABILITY_TOLERANCE = 0.0001;

function requiredText(value, field, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function optionalText(value, field, max = 8000) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return text;
}

function finiteNumber(value, field, { min = -Infinity, max = Infinity, nullable = true } = {}) {
  if (value == null && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field} must be a number between ${min} and ${max}`);
  return number;
}

function integer(value, field, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return number;
}

function isoInstant(value, field) {
  const text = requiredText(value, field, 80);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${field} must be a valid ISO date/time`);
  return text;
}

function fingerprint(value, field = 'context_fingerprint') {
  const text = requiredText(value, field, 80).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be a sha256 fingerprint`);
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function loadRound(env, roundId) {
  const id = requiredText(roundId, 'round_id', 200);
  const round = await env.DB.prepare(`
    SELECT id, game_type, round_date, scheduled_start_at, bet_stop_at, jackpot_sek, turnover_sek, status
    FROM game_rounds
    WHERE id = ? AND game_type IN ('V85','V86')
    LIMIT 1
  `).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');

  const { results: rows } = await env.DB.prepare(`
    SELECT
      gl.leg_number,
      r.id AS race_id,
      r.race_number,
      r.scheduled_start_at,
      r.distance_m,
      r.start_method,
      r.first_prize_sek,
      r.race_name,
      r.main_class,
      r.class_flags_json,
      r.status AS race_status,
      t.id AS track_id,
      t.canonical_name AS track_name,
      t.lap_length_m,
      t.home_stretch_m,
      t.open_stretch_lanes,
      t.angled_mobile_wing,
      t.start_notes,
      t.track_notes,
      re.id AS race_entry_id,
      re.horse_id,
      re.driver_id,
      re.trainer_id,
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
      re.data_quality AS entry_quality,
      h.canonical_name AS horse_name,
      h.sex,
      h.birth_year,
      h.breed,
      h.sire_name,
      h.dam_name,
      h.damsire_name,
      h.career_earnings_sek,
      h.record_text,
      d.canonical_name AS driver_name,
      tr.canonical_name AS trainer_name
    FROM game_legs gl
    JOIN races r ON r.id = gl.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    JOIN race_entries re ON re.race_id = r.id
    JOIN horses h ON h.id = re.horse_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN trainers tr ON tr.id = re.trainer_id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number ASC, re.start_number ASC, re.id ASC
  `).bind(id).all();

  const legNumbers = [...new Set(rows.map((row) => Number(row.leg_number)))];
  if (legNumbers.length !== 8 || legNumbers.some((leg, index) => leg !== index + 1)) throw new Error('round must contain exactly eight ordered legs');
  return { round, rows };
}

function groupCurrentLegs(rows) {
  const legs = new Map();
  for (const row of rows) {
    const legNumber = Number(row.leg_number);
    if (!legs.has(legNumber)) {
      legs.set(legNumber, {
        legNumber,
        race: {
          id: row.race_id,
          raceNumber: row.race_number == null ? null : Number(row.race_number),
          scheduledStartAt: row.scheduled_start_at || null,
          distanceM: row.distance_m == null ? null : Number(row.distance_m),
          startMethod: row.start_method || null,
          firstPrizeSek: row.first_prize_sek == null ? null : Number(row.first_prize_sek),
          raceName: row.race_name || null,
          mainClass: row.main_class || null,
          classFlags: row.class_flags_json ? JSON.parse(row.class_flags_json) : null,
          status: row.race_status || null,
          track: {
            id: row.track_id || null,
            name: row.track_name || null,
            lapLengthM: row.lap_length_m == null ? null : Number(row.lap_length_m),
            homeStretchM: row.home_stretch_m == null ? null : Number(row.home_stretch_m),
            openStretchLanes: row.open_stretch_lanes == null ? null : Number(row.open_stretch_lanes),
            angledMobileWing: row.angled_mobile_wing == null ? null : Number(row.angled_mobile_wing) === 1,
            startNotes: row.start_notes || null,
            trackNotes: row.track_notes || null
          }
        },
        entries: []
      });
    }
    legs.get(legNumber).entries.push({
      raceEntryId: row.race_entry_id,
      horseId: row.horse_id,
      horseName: row.horse_name,
      driverId: row.driver_id || null,
      driverName: row.driver_name || null,
      trainerId: row.trainer_id || null,
      trainerName: row.trainer_name || null,
      startNumber: row.start_number == null ? null : Number(row.start_number),
      actualLane: row.actual_lane == null ? null : Number(row.actual_lane),
      startTier: row.start_tier == null ? null : Number(row.start_tier),
      handicapM: row.handicap_m == null ? null : Number(row.handicap_m),
      actualStartDistanceM: row.actual_start_distance_m == null ? null : Number(row.actual_start_distance_m),
      springspar: row.springspar == null ? null : Number(row.springspar) === 1,
      innerLane: row.inner_lane == null ? null : Number(row.inner_lane) === 1,
      backRow: row.back_row == null ? null : Number(row.back_row) === 1,
      scratched: Number(row.scratched) === 1,
      scratchReason: row.scratch_reason || null,
      dataQuality: row.entry_quality || null,
      horse: {
        sex: row.sex || null,
        birthYear: row.birth_year == null ? null : Number(row.birth_year),
        breed: row.breed || null,
        sireName: row.sire_name || null,
        damName: row.dam_name || null,
        damsireName: row.damsire_name || null,
        careerEarningsSek: row.career_earnings_sek == null ? null : Number(row.career_earnings_sek),
        recordText: row.record_text || null
      },
      equipment: null,
      features: [],
      recentStarts: [],
      editorial: []
    });
  }
  return [...legs.values()];
}

function entryIndex(legs) {
  const index = new Map();
  for (const leg of legs) for (const entry of leg.entries) index.set(entry.raceEntryId, entry);
  return index;
}

async function addCurrentEquipment(env, legs) {
  const ids = [...entryIndex(legs).keys()];
  if (!ids.length) return;
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT e.*, sr.fetched_at,
             ROW_NUMBER() OVER (PARTITION BY e.race_entry_id ORDER BY sr.fetched_at DESC, e.id DESC) AS rn
      FROM equipment e
      LEFT JOIN source_records sr ON sr.id = e.source_record_id
      WHERE e.race_entry_id IN (${placeholders(ids)})
    )
    SELECT * FROM ranked WHERE rn = 1
  `).bind(...ids).all();
  const index = entryIndex(legs);
  for (const row of results) {
    const entry = index.get(row.race_entry_id);
    if (!entry) continue;
    entry.equipment = {
      shoesFront: row.shoes_front || null,
      shoesRear: row.shoes_rear || null,
      barefootFront: row.barefoot_front == null ? null : Number(row.barefoot_front) === 1,
      barefootRear: row.barefoot_rear == null ? null : Number(row.barefoot_rear) === 1,
      sulkyType: row.sulky_type || null,
      exactSulky: row.exact_sulky || null,
      headgear: row.headgear || null,
      earplugs: row.earplugs || null,
      otherEquipment: row.other_equipment || null,
      changeFromPrevious: row.change_from_previous_json ? JSON.parse(row.change_from_previous_json) : null,
      verificationStatus: row.verification_status || null,
      observedAt: row.fetched_at || null
    };
  }
}

async function addCurrentFeatures(env, legs) {
  const ids = [...entryIndex(legs).keys()];
  if (!ids.length) return;
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT af.*,
             ROW_NUMBER() OVER (
               PARTITION BY af.race_entry_id, af.feature_name
               ORDER BY datetime(af.as_of) DESC, af.feature_version DESC, af.id DESC
             ) AS rn
      FROM analysis_features af
      WHERE af.race_entry_id IN (${placeholders(ids)})
    )
    SELECT * FROM ranked WHERE rn = 1
    ORDER BY race_entry_id, feature_name
  `).bind(...ids).all();
  const index = entryIndex(legs);
  for (const row of results) {
    const entry = index.get(row.race_entry_id);
    if (!entry) continue;
    entry.features.push({
      name: row.feature_name,
      version: row.feature_version,
      asOf: row.as_of,
      numericValue: row.numeric_value == null ? null : Number(row.numeric_value),
      textValue: row.text_value || null,
      uncertaintyLow: row.uncertainty_low == null ? null : Number(row.uncertainty_low),
      uncertaintyHigh: row.uncertainty_high == null ? null : Number(row.uncertainty_high),
      dataQuality: row.data_quality || null
    });
  }
}

async function addRecentStarts(env, roundDate, legs) {
  const horses = [...new Set(legs.flatMap((leg) => leg.entries.map((entry) => entry.horseId)))];
  if (!horses.length) return;
  const { results: starts } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        re.horse_id,
        re.id AS race_entry_id,
        r.id AS race_id,
        r.race_date,
        r.race_number,
        r.scheduled_start_at,
        r.distance_m,
        r.start_method,
        r.first_prize_sek,
        r.race_name,
        t.canonical_name AS track_name,
        re.start_number,
        re.actual_start_distance_m,
        re.handicap_m,
        d.canonical_name AS driver_name,
        tr.canonical_name AS trainer_name,
        rr.placing,
        rr.placing_text,
        rr.finish_time,
        rr.km_time,
        rr.prize_sek,
        rr.gallop,
        rr.disqualified,
        ROW_NUMBER() OVER (
          PARTITION BY re.horse_id
          ORDER BY COALESCE(datetime(r.scheduled_start_at), datetime(r.race_date || 'T23:59:59Z')) DESC, r.race_number DESC, re.id ASC
        ) AS rn
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      LEFT JOIN tracks t ON t.id = r.track_id
      LEFT JOIN drivers d ON d.id = re.driver_id
      LEFT JOIN trainers tr ON tr.id = re.trainer_id
      WHERE re.horse_id IN (${placeholders(horses)})
        AND re.scratched = 0
        AND rr.result_status = 'official'
        AND r.race_date < ?
    )
    SELECT * FROM ranked WHERE rn <= ?
    ORDER BY horse_id, rn
  `).bind(...horses, roundDate, HISTORY_LIMIT).all();

  const historicalIds = starts.map((row) => row.race_entry_id);
  const xlabsByEntry = new Map();
  const equipmentByEntry = new Map();
  if (historicalIds.length) {
    const { results: xlabsRows } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT x.*, sr.fetched_at,
               ROW_NUMBER() OVER (PARTITION BY x.race_entry_id ORDER BY sr.fetched_at DESC, x.id DESC) AS rn
        FROM xlabs_data x
        LEFT JOIN source_records sr ON sr.id = x.source_record_id
        WHERE x.race_entry_id IN (${placeholders(historicalIds)})
      )
      SELECT * FROM ranked WHERE rn = 1
    `).bind(...historicalIds).all();
    for (const row of xlabsRows) xlabsByEntry.set(row.race_entry_id, {
      first200Time: row.first_200_time || null,
      last200Time: row.last_200_time || null,
      last400Time: row.last_400_time || null,
      last500Time: row.last_500_time || null,
      last800Time: row.last_800_time || null,
      last1000Time: row.last_1000_time || null,
      actualDistanceM: row.actual_distance_m == null ? null : Number(row.actual_distance_m),
      extraDistanceM: row.extra_distance_m == null ? null : Number(row.extra_distance_m),
      convertedKmTime: row.converted_km_time || null,
      qualityStatus: row.quality_status || null,
      observedAt: row.fetched_at || null
    });

    const { results: equipmentRows } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT e.*, sr.fetched_at,
               ROW_NUMBER() OVER (PARTITION BY e.race_entry_id ORDER BY sr.fetched_at DESC, e.id DESC) AS rn
        FROM equipment e
        LEFT JOIN source_records sr ON sr.id = e.source_record_id
        WHERE e.race_entry_id IN (${placeholders(historicalIds)})
      )
      SELECT * FROM ranked WHERE rn = 1
    `).bind(...historicalIds).all();
    for (const row of equipmentRows) equipmentByEntry.set(row.race_entry_id, {
      shoesFront: row.shoes_front || null,
      shoesRear: row.shoes_rear || null,
      barefootFront: row.barefoot_front == null ? null : Number(row.barefoot_front) === 1,
      barefootRear: row.barefoot_rear == null ? null : Number(row.barefoot_rear) === 1,
      sulkyType: row.sulky_type || null,
      exactSulky: row.exact_sulky || null,
      verificationStatus: row.verification_status || null,
      observedAt: row.fetched_at || null
    });
  }

  const startsByHorse = new Map();
  for (const row of starts) {
    if (!startsByHorse.has(row.horse_id)) startsByHorse.set(row.horse_id, []);
    startsByHorse.get(row.horse_id).push({
      raceEntryId: row.race_entry_id,
      raceId: row.race_id,
      raceDate: row.race_date,
      raceNumber: row.race_number == null ? null : Number(row.race_number),
      scheduledStartAt: row.scheduled_start_at || null,
      trackName: row.track_name || null,
      distanceM: row.distance_m == null ? null : Number(row.distance_m),
      startMethod: row.start_method || null,
      firstPrizeSek: row.first_prize_sek == null ? null : Number(row.first_prize_sek),
      raceName: row.race_name || null,
      startNumber: row.start_number == null ? null : Number(row.start_number),
      actualStartDistanceM: row.actual_start_distance_m == null ? null : Number(row.actual_start_distance_m),
      handicapM: row.handicap_m == null ? null : Number(row.handicap_m),
      driverName: row.driver_name || null,
      trainerName: row.trainer_name || null,
      result: {
        placing: row.placing == null ? null : Number(row.placing),
        placingText: row.placing_text || null,
        finishTime: row.finish_time || null,
        kmTime: row.km_time || null,
        prizeSek: row.prize_sek == null ? null : Number(row.prize_sek),
        gallop: row.gallop == null ? null : Number(row.gallop) === 1,
        disqualified: row.disqualified == null ? null : Number(row.disqualified) === 1
      },
      equipment: equipmentByEntry.get(row.race_entry_id) || null,
      xlabs: xlabsByEntry.get(row.race_entry_id) || null
    });
  }
  for (const leg of legs) for (const entry of leg.entries) entry.recentStarts = startsByHorse.get(entry.horseId) || [];
}

async function addEditorial(env, roundId, legs) {
  const ids = [...entryIndex(legs).keys()];
  if (!ids.length) return;
  const raceIds = legs.map((leg) => leg.race.id);
  const { results } = await env.DB.prepare(`
    SELECT
      ei.id,
      ei.race_entry_id,
      ei.horse_id,
      ei.race_id,
      ei.published_at,
      ei.source_name,
      ei.summary_text,
      es.signal_type,
      es.value_text,
      es.polarity,
      es.strength,
      es.fact_or_opinion,
      es.confidence,
      es.evidence_excerpt
    FROM editorial_items ei
    LEFT JOIN editorial_signals es ON es.editorial_item_id = ei.id
    WHERE ei.game_round_id = ?
       OR ei.race_id IN (${placeholders(raceIds)})
       OR ei.race_entry_id IN (${placeholders(ids)})
    ORDER BY ei.published_at ASC, ei.id ASC, es.id ASC
  `).bind(roundId, ...raceIds, ...ids).all();
  const index = entryIndex(legs);
  for (const row of results) {
    let targets = [];
    if (row.race_entry_id && index.has(row.race_entry_id)) targets = [index.get(row.race_entry_id)];
    else if (row.horse_id) targets = [...index.values()].filter((entry) => entry.horseId === row.horse_id);
    else if (row.race_id) targets = legs.find((leg) => leg.race.id === row.race_id)?.entries || [];
    for (const entry of targets) {
      let item = entry.editorial.find((candidate) => candidate.id === row.id);
      if (!item) {
        item = {
          id: row.id,
          publishedAt: row.published_at || null,
          sourceName: row.source_name,
          summary: row.summary_text || null,
          signals: []
        };
        entry.editorial.push(item);
      }
      if (row.signal_type) item.signals.push({
        type: row.signal_type,
        value: row.value_text || null,
        polarity: row.polarity || null,
        strength: row.strength == null ? null : Number(row.strength),
        factOrOpinion: row.fact_or_opinion || null,
        confidence: row.confidence == null ? null : Number(row.confidence),
        evidence: row.evidence_excerpt || null
      });
    }
  }
}

async function preMarketContext(env, roundId) {
  const { round, rows } = await loadRound(env, roundId);
  const legs = groupCurrentLegs(rows);
  await addCurrentEquipment(env, legs);
  await addCurrentFeatures(env, legs);
  await addRecentStarts(env, round.round_date, legs);
  await addEditorial(env, round.id, legs);
  return {
    contractVersion: ANALYSIS_CONTEXT_VERSION,
    stage: 'pre_market',
    generatedAt: new Date().toISOString(),
    analysisRules: {
      marketBlind: true,
      sourceOrder: ['official_facts', 'xlabs_measurements', 'deterministic_features', 'editorial_signals'],
      note: 'Current market percentages and odds are deliberately excluded. Missing facts remain null.'
    },
    round: {
      id: round.id,
      gameType: round.game_type,
      roundDate: round.round_date,
      scheduledStartAt: round.scheduled_start_at || null,
      betStopAt: round.bet_stop_at || null,
      jackpotSek: round.jackpot_sek == null ? null : Number(round.jackpot_sek),
      turnoverSek: round.turnover_sek == null ? null : Number(round.turnover_sek),
      status: round.status || null
    },
    legs
  };
}

function modelVersionId(roundId, submissionId) {
  return stableId('analysis', roundId, submissionId);
}

async function readSubmissionMetadata(env, roundId, submissionId) {
  const id = modelVersionId(roundId, submissionId);
  const row = await env.DB.prepare(`SELECT id, ai_provider, ai_model, config_json, created_at FROM model_versions WHERE id = ? LIMIT 1`).bind(id).first();
  if (!row) return null;
  let config;
  try { config = JSON.parse(row.config_json || '{}'); } catch { throw new Error('stored analysis submission metadata is invalid'); }
  const meta = config.analysisExchange;
  if (!meta || meta.roundId !== roundId || meta.submissionId !== submissionId) throw new Error('stored model version is not an analysis-exchange submission');
  return { row, config, meta };
}

async function latestMarketAt(env, roundId, asOf) {
  const { results: betting } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT bs.*,
             ROW_NUMBER() OVER (PARTITION BY bs.race_entry_id ORDER BY datetime(bs.captured_at) DESC, bs.id DESC) AS rn
      FROM betting_snapshots bs
      WHERE bs.game_round_id = ? AND datetime(bs.captured_at) <= datetime(?)
    )
    SELECT * FROM ranked WHERE rn = 1 ORDER BY leg_number, race_entry_id
  `).bind(roundId, asOf).all();
  const { results: odds } = await env.DB.prepare(`
    WITH round_entries AS (
      SELECT re.id
      FROM game_legs gl JOIN race_entries re ON re.race_id = gl.race_id
      WHERE gl.game_round_id = ?
    ), ranked AS (
      SELECT os.*,
             ROW_NUMBER() OVER (PARTITION BY os.race_entry_id, os.market_type ORDER BY datetime(os.captured_at) DESC, os.id DESC) AS rn
      FROM odds_snapshots os
      JOIN round_entries re ON re.id = os.race_entry_id
      WHERE datetime(os.captured_at) <= datetime(?)
    )
    SELECT * FROM ranked WHERE rn = 1 ORDER BY race_entry_id, market_type
  `).bind(roundId, asOf).all();
  return {
    betting: betting.map((row) => ({
      legNumber: Number(row.leg_number),
      raceEntryId: row.race_entry_id,
      capturedAt: row.captured_at,
      betPercent: row.bet_percent == null ? null : Number(row.bet_percent),
      marketRank: row.market_rank == null ? null : Number(row.market_rank)
    })),
    odds: odds.map((row) => ({
      raceEntryId: row.race_entry_id,
      capturedAt: row.captured_at,
      marketType: row.market_type,
      odds: row.odds == null ? null : Number(row.odds)
    }))
  };
}

async function marketContext(env, roundId, parentSubmissionId) {
  const parentId = requiredText(parentSubmissionId, 'pre_market_submission_id', 120);
  const parent = await readSubmissionMetadata(env, roundId, parentId);
  if (!parent || parent.meta.stage !== 'pre_market') throw new Error('a stored pre-market submission for this round is required before market data can be exposed');
  const generatedAt = new Date().toISOString();
  const market = await latestMarketAt(env, roundId, generatedAt);
  return {
    contractVersion: ANALYSIS_CONTEXT_VERSION,
    stage: 'market',
    generatedAt,
    analysisRules: {
      marketBlind: false,
      note: 'Use market data for value and system construction only. Do not rewrite the stored market-blind strength assessment.'
    },
    roundId,
    preMarketSubmission: {
      submissionId: parent.meta.submissionId,
      provider: parent.row.ai_provider,
      model: parent.row.ai_model,
      contextFingerprint: parent.meta.contextFingerprint
    },
    market
  };
}

export async function getAnalysisContext(env, roundId, stage = 'pre_market', options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const normalizedStage = String(stage || 'pre_market').toLowerCase();
  let payload;
  if (normalizedStage === 'pre_market') payload = await preMarketContext(env, roundId);
  else if (normalizedStage === 'market') payload = await marketContext(env, requiredText(roundId, 'round_id', 200), options.preMarketSubmissionId);
  else throw new Error('stage must be pre_market or market');
  return { ...payload, contextFingerprint: await sha256(payload) };
}

function normalizePrediction(value, index, allowedEntryIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`predictions[${index}] must be an object`);
  if ('value_ratio' in value || 'valueRatio' in value || 'market_percent' in value || 'marketPercent' in value) {
    throw new Error('value_ratio and market_percent are calculated/stored by KentaurAI and must not be supplied as AI facts');
  }
  const raceEntryId = requiredText(value.race_entry_id ?? value.raceEntryId, `predictions[${index}].race_entry_id`, 200);
  if (!allowedEntryIds.has(raceEntryId)) throw new Error(`prediction race_entry_id ${raceEntryId} does not belong to the leg`);
  const probability = finiteNumber(value.win_probability ?? value.winProbability, `predictions[${index}].win_probability`, { min: 0, max: 1, nullable: false });
  const low = finiteNumber(value.uncertainty_low ?? value.uncertaintyLow, `predictions[${index}].uncertainty_low`, { min: 0, max: 1 });
  const high = finiteNumber(value.uncertainty_high ?? value.uncertaintyHigh, `predictions[${index}].uncertainty_high`, { min: 0, max: 1 });
  if (low != null && low > probability) throw new Error('uncertainty_low cannot exceed win_probability');
  if (high != null && high < probability) throw new Error('uncertainty_high cannot be below win_probability');
  const rawRank = integer(value.raw_rank ?? value.rawRank, `predictions[${index}].raw_rank`, { min: 1, max: allowedEntryIds.size });
  const abcdGroup = requiredText(value.abcd_group ?? value.abcdGroup, `predictions[${index}].abcd_group`, 1).toUpperCase();
  if (!['A','B','C','D'].includes(abcdGroup)) throw new Error('abcd_group must be A, B, C or D');
  return {
    raceEntryId,
    winProbability: probability,
    uncertaintyLow: low,
    uncertaintyHigh: high,
    rawRank,
    abcdGroup,
    scenarioRobustness: finiteNumber(value.scenario_robustness ?? value.scenarioRobustness, `predictions[${index}].scenario_robustness`, { min: 0, max: 1 }),
    reasoning: value.reasoning ?? null
  };
}

function normalizeLeg(value, index, actualLeg) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`legs[${index}] must be an object`);
  const legNumber = integer(value.leg_number ?? value.legNumber, `legs[${index}].leg_number`, { min: 1, max: 8 });
  if (legNumber !== actualLeg.legNumber) throw new Error(`leg ${legNumber} does not match the stored round order`);
  const raceId = requiredText(value.race_id ?? value.raceId, `legs[${index}].race_id`, 200);
  if (raceId !== actualLeg.race.id) throw new Error(`leg ${legNumber} race_id does not match the stored round`);
  const activeEntries = actualLeg.entries.filter((entry) => !entry.scratched);
  const allowed = new Set(activeEntries.map((entry) => entry.raceEntryId));
  if (!Array.isArray(value.predictions) || value.predictions.length !== allowed.size) throw new Error(`leg ${legNumber} predictions must cover every non-scratched stored entry exactly once`);
  const predictions = value.predictions.map((prediction, predictionIndex) => normalizePrediction(prediction, predictionIndex, allowed));
  if (new Set(predictions.map((prediction) => prediction.raceEntryId)).size !== predictions.length) throw new Error(`leg ${legNumber} contains duplicate predictions`);
  const ranks = predictions.map((prediction) => prediction.rawRank).sort((a, b) => a - b);
  if (ranks.some((rank, rankIndex) => rank !== rankIndex + 1)) throw new Error(`leg ${legNumber} raw_rank values must be unique and contiguous from 1`);
  const total = predictions.reduce((sum, prediction) => sum + prediction.winProbability, 0);
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) throw new Error(`leg ${legNumber} win probabilities must sum to 1`);
  return {
    legNumber,
    raceId,
    scenarios: value.scenarios ?? null,
    raceShapeSummary: optionalText(value.race_shape_summary ?? value.raceShapeSummary, `legs[${index}].race_shape_summary`),
    conclusion: optionalText(value.conclusion, `legs[${index}].conclusion`),
    dataQuality: optionalText(value.data_quality ?? value.dataQuality, `legs[${index}].data_quality`, 80) || 'unknown',
    predictions
  };
}

function normalizeSystem(value, index, actualLegs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`systems[${index}] must be an object`);
  const clientId = requiredText(value.system_id ?? value.systemId, `systems[${index}].system_id`, 120);
  const systemType = requiredText(value.system_type ?? value.systemType ?? 'main', `systems[${index}].system_type`, 30).toLowerCase();
  if (!['main','alternative'].includes(systemType)) throw new Error('system_type must be main or alternative');
  if (!Array.isArray(value.selections)) throw new Error(`systems[${index}].selections must be an array`);
  const byLeg = new Map();
  const normalizedSelections = [];
  for (let selectionIndex = 0; selectionIndex < value.selections.length; selectionIndex += 1) {
    const selection = value.selections[selectionIndex];
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error(`systems[${index}].selections[${selectionIndex}] must be an object`);
    if ('own_probability' in selection || 'ownProbability' in selection || 'market_percent' in selection || 'marketPercent' in selection) {
      throw new Error('system own_probability and market_percent are populated by KentaurAI from the stored analysis and market snapshot');
    }
    const legNumber = integer(selection.leg_number ?? selection.legNumber, `systems[${index}].selections[${selectionIndex}].leg_number`, { min: 1, max: 8 });
    const actualLeg = actualLegs[legNumber - 1];
    const raceEntryId = requiredText(selection.race_entry_id ?? selection.raceEntryId, `systems[${index}].selections[${selectionIndex}].race_entry_id`, 200);
    if (!actualLeg.entries.some((entry) => !entry.scratched && entry.raceEntryId === raceEntryId)) throw new Error(`system selection ${raceEntryId} does not belong to active leg ${legNumber}`);
    const normalized = {
      legNumber,
      raceEntryId,
      isSpike: selection.is_spike === true || selection.isSpike === true || Number(selection.is_spike ?? selection.isSpike ?? 0) === 1,
      selectionReason: optionalText(selection.selection_reason ?? selection.selectionReason, `systems[${index}].selections[${selectionIndex}].selection_reason`, 2000)
    };
    normalizedSelections.push(normalized);
    if (!byLeg.has(legNumber)) byLeg.set(legNumber, []);
    byLeg.get(legNumber).push(normalized);
  }
  if (byLeg.size !== 8) throw new Error('every system must select at least one horse in all eight legs');
  for (const selections of byLeg.values()) {
    if (new Set(selections.map((selection) => selection.raceEntryId)).size !== selections.length) throw new Error('system cannot select the same race entry twice in a leg');
    if (selections.some((selection) => selection.isSpike) && !(selections.length === 1 && selections[0].isSpike)) throw new Error('a spike leg must contain exactly one selected horse');
  }
  const spikeLegs = [...byLeg.values()].filter((selections) => selections.length === 1 && selections[0].isSpike);
  if (spikeLegs.length !== 3) throw new Error('every V85/V86 system must contain exactly three spike legs');
  const rowCount = [...byLeg.values()].reduce((rows, selections) => rows * selections.length, 1);
  const budgetSek = finiteNumber(value.budget_sek ?? value.budgetSek, `systems[${index}].budget_sek`, { min: 0.01, max: 1_000_000, nullable: false });
  const linePriceSek = finiteNumber(value.line_price_sek ?? value.linePriceSek, `systems[${index}].line_price_sek`, { min: 0.0001, max: 1000 });
  if (linePriceSek != null && Math.abs(rowCount * linePriceSek - budgetSek) > 0.01) throw new Error('system budget_sek must equal row count multiplied by line_price_sek when line price is supplied');
  return {
    clientId,
    systemType,
    budgetSek,
    linePriceSek,
    rowCount,
    riskProfile: optionalText(value.risk_profile ?? value.riskProfile, `systems[${index}].risk_profile`, 100),
    notes: optionalText(value.notes, `systems[${index}].notes`, 8000),
    selections: normalizedSelections
  };
}

function normalizeSubmission(payload, actualLegs) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('analysis submission must be an object');
  if (payload.contract_version !== ANALYSIS_SUBMISSION_VERSION && payload.contractVersion !== ANALYSIS_SUBMISSION_VERSION) throw new Error(`contract_version must be ${ANALYSIS_SUBMISSION_VERSION}`);
  const submissionId = requiredText(payload.submission_id ?? payload.submissionId, 'submission_id', 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(submissionId)) throw new Error('submission_id may contain only letters, numbers, dot, underscore, colon and hyphen');
  const roundId = requiredText(payload.round_id ?? payload.roundId, 'round_id', 200);
  const stage = requiredText(payload.stage, 'stage', 20).toLowerCase();
  if (!['pre_market','final'].includes(stage)) throw new Error('stage must be pre_market or final');
  const provider = requiredText(payload.producer?.provider, 'producer.provider', 100);
  const model = requiredText(payload.producer?.model, 'producer.model', 200);
  const dataSnapshotAt = isoInstant(payload.data_snapshot_at ?? payload.dataSnapshotAt, 'data_snapshot_at');
  const contextFingerprint = fingerprint(payload.context_fingerprint ?? payload.contextFingerprint);
  const parentSubmissionId = payload.parent_submission_id ?? payload.parentSubmissionId ?? null;
  if (stage === 'final' && !parentSubmissionId) throw new Error('final submissions require parent_submission_id from a stored pre-market submission');
  if (stage === 'pre_market' && parentSubmissionId) throw new Error('pre-market submissions cannot have parent_submission_id');
  if (!Array.isArray(payload.legs) || payload.legs.length !== 8) throw new Error('analysis submission must contain exactly eight legs');
  const sortedLegs = [...payload.legs].sort((a, b) => Number(a.leg_number ?? a.legNumber) - Number(b.leg_number ?? b.legNumber));
  const legs = sortedLegs.map((leg, index) => normalizeLeg(leg, index, actualLegs[index]));
  const systemsInput = payload.systems ?? [];
  if (!Array.isArray(systemsInput)) throw new Error('systems must be an array');
  if (stage === 'pre_market' && systemsInput.length) throw new Error('pre-market submissions cannot contain systems');
  const systems = systemsInput.map((system, index) => normalizeSystem(system, index, actualLegs));
  if (new Set(systems.map((system) => system.clientId)).size !== systems.length) throw new Error('system_id values must be unique within a submission');
  return {
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId,
    roundId,
    stage,
    parentSubmissionId: parentSubmissionId ? requiredText(parentSubmissionId, 'parent_submission_id', 120) : null,
    provider,
    model,
    analysisVersion: optionalText(payload.analysis_version ?? payload.analysisVersion, 'analysis_version', 200),
    dataSnapshotAt,
    contextFingerprint,
    roundSummary: optionalText(payload.round_summary ?? payload.roundSummary, 'round_summary', 12000),
    recommendations: payload.recommendations ?? null,
    legs,
    systems
  };
}

async function parentPredictions(env, roundId, submissionId) {
  const parent = await readSubmissionMetadata(env, roundId, submissionId);
  if (!parent || parent.meta.stage !== 'pre_market') throw new Error('parent_submission_id must identify a stored pre-market submission for the same round');
  const { results } = await env.DB.prepare(`
    SELECT ara.race_id, ahp.race_entry_id, ahp.win_probability, ahp.raw_rank, ahp.abcd_group
    FROM ai_race_analyses ara
    JOIN ai_horse_predictions ahp ON ahp.ai_race_analysis_id = ara.id
    WHERE ara.model_version_id = ?
    ORDER BY ara.race_id, ahp.race_entry_id
  `).bind(parent.row.id).all();
  return { parent, rows: results };
}

function assertFinalStrengthUnchanged(submission, parentRows) {
  const parent = new Map(parentRows.map((row) => [`${row.race_id}:${row.race_entry_id}`, row]));
  for (const leg of submission.legs) {
    for (const prediction of leg.predictions) {
      const stored = parent.get(`${leg.raceId}:${prediction.raceEntryId}`);
      if (!stored) throw new Error('final submission cannot add or replace market-blind predictions');
      if (Math.abs(Number(stored.win_probability) - prediction.winProbability) > PROBABILITY_TOLERANCE ||
          Number(stored.raw_rank) !== prediction.rawRank ||
          stored.abcd_group !== prediction.abcdGroup) {
        throw new Error('final submission must preserve pre-market win_probability, raw_rank and abcd_group values');
      }
    }
  }
}

async function marketMapForSubmission(env, roundId, asOf) {
  const market = await latestMarketAt(env, roundId, asOf);
  return new Map(market.betting.map((row) => [row.raceEntryId, row]));
}

function predictedHitProbability(system, predictionMap) {
  const byLeg = new Map();
  for (const selection of system.selections) {
    if (!byLeg.has(selection.legNumber)) byLeg.set(selection.legNumber, 0);
    const probability = predictionMap.get(selection.raceEntryId)?.winProbability;
    byLeg.set(selection.legNumber, byLeg.get(selection.legNumber) + Number(probability ?? 0));
  }
  return [...byLeg.values()].reduce((product, probability) => product * probability, 1);
}

export async function importAnalysisSubmission(env, payload) {
  if (!env.DB) throw new Error('DB is not configured');
  const requestedRoundId = requiredText(payload?.round_id ?? payload?.roundId, 'round_id', 200);
  const { round, rows } = await loadRound(env, requestedRoundId);
  const actualLegs = groupCurrentLegs(rows);
  const submission = normalizeSubmission(payload, actualLegs);
  if (submission.roundId !== round.id) throw new Error('round_id does not match stored round');

  let parent = null;
  if (submission.stage === 'final') {
    const parentData = await parentPredictions(env, round.id, submission.parentSubmissionId);
    if (parentData.parent.row.ai_provider !== submission.provider) throw new Error('final submission producer.provider must match its pre-market parent');
    if (Date.parse(submission.dataSnapshotAt) < Date.parse(parentData.parent.meta.dataSnapshotAt)) throw new Error('final data_snapshot_at cannot predate its pre-market parent');
    assertFinalStrengthUnchanged(submission, parentData.rows);
    parent = parentData.parent;
  }

  const digest = await sha256(submission);
  const id = modelVersionId(round.id, submission.submissionId);
  const existing = await readSubmissionMetadata(env, round.id, submission.submissionId);
  if (existing && existing.meta.payloadDigest !== digest) throw new Error('submission_id already exists with different content');

  const metadata = {
    analysisExchange: {
      contractVersion: ANALYSIS_SUBMISSION_VERSION,
      submissionId: submission.submissionId,
      roundId: round.id,
      stage: submission.stage,
      parentSubmissionId: submission.parentSubmissionId,
      contextFingerprint: submission.contextFingerprint,
      payloadDigest: digest,
      dataSnapshotAt: submission.dataSnapshotAt,
      roundSummary: submission.roundSummary,
      recommendations: submission.recommendations
    }
  };
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO model_versions
      (id, created_at, feature_version, prompt_version, ai_provider, ai_model, config_json, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, createdAt, FEATURE_VERSION, submission.analysisVersion, submission.provider, submission.model, JSON.stringify(metadata), 'Provider-neutral KentaurAI analysis exchange submission').run();

  let analysesWritten = 0;
  let predictionsWritten = 0;
  let systemsWritten = 0;
  let selectionsWritten = 0;
  const market = submission.stage === 'final' ? await marketMapForSubmission(env, round.id, submission.dataSnapshotAt) : new Map();
  const predictionMap = new Map();

  for (const leg of submission.legs) {
    const analysisId = stableId('race-analysis', id, leg.raceId);
    const analysisWrite = await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_race_analyses
        (id, race_id, model_version_id, data_snapshot_at, market_blind, scenarios_json,
         race_shape_summary, conclusion, data_quality, created_at, analysis_origin, method_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'analysis_exchange', ?)
    `).bind(
      analysisId, leg.raceId, id, submission.dataSnapshotAt, submission.stage === 'pre_market' ? 1 : 0,
      leg.scenarios == null ? null : JSON.stringify(leg.scenarios), leg.raceShapeSummary, leg.conclusion,
      leg.dataQuality, createdAt, submission.stage
    ).run();
    analysesWritten += Number(analysisWrite.meta?.changes ?? 0);

    for (const prediction of leg.predictions) {
      const marketRow = market.get(prediction.raceEntryId);
      const valueRatio = submission.stage === 'final' && marketRow?.betPercent > 0
        ? prediction.winProbability / (marketRow.betPercent / 100)
        : null;
      const predictionId = stableId('prediction', analysisId, prediction.raceEntryId);
      const predictionWrite = await env.DB.prepare(`
        INSERT OR IGNORE INTO ai_horse_predictions
          (id, ai_race_analysis_id, race_entry_id, win_probability, uncertainty_low, uncertainty_high,
           raw_rank, abcd_group, value_ratio, scenario_robustness, reasoning_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        predictionId, analysisId, prediction.raceEntryId, prediction.winProbability,
        prediction.uncertaintyLow, prediction.uncertaintyHigh, prediction.rawRank, prediction.abcdGroup,
        valueRatio, prediction.scenarioRobustness,
        prediction.reasoning == null ? null : JSON.stringify(prediction.reasoning)
      ).run();
      predictionsWritten += Number(predictionWrite.meta?.changes ?? 0);
      predictionMap.set(prediction.raceEntryId, prediction);
    }
  }

  for (const system of submission.systems) {
    const systemId = stableId('system', id, system.clientId);
    const hitProbability = predictedHitProbability(system, predictionMap);
    const systemWrite = await env.DB.prepare(`
      INSERT OR IGNORE INTO systems
        (id, game_round_id, model_version_id, system_type, budget_sek, row_count, line_price_sek,
         spike_count, estimated_hit_probability, estimated_market_ownership, value_metric, risk_profile,
         created_at, metrics_json, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, NULL, NULL, ?, ?, ?, ?)
    `).bind(
      systemId, round.id, id, system.systemType, system.budgetSek, system.rowCount, system.linePriceSek,
      hitProbability, system.riskProfile, createdAt,
      JSON.stringify({ calculation: 'analysis-exchange-v1', rowCountDerived: true, spikeCountDerived: true, estimatedHitProbabilityDerived: true }),
      system.notes
    ).run();
    systemsWritten += Number(systemWrite.meta?.changes ?? 0);

    for (const selection of system.selections) {
      const marketRow = market.get(selection.raceEntryId);
      const prediction = predictionMap.get(selection.raceEntryId);
      const selectionWrite = await env.DB.prepare(`
        INSERT OR IGNORE INTO system_selections
          (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent, selection_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        systemId, selection.legNumber, selection.raceEntryId, selection.isSpike ? 1 : 0,
        prediction?.winProbability ?? null, marketRow?.betPercent ?? null, selection.selectionReason
      ).run();
      selectionsWritten += Number(selectionWrite.meta?.changes ?? 0);
    }
  }

  return {
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId: submission.submissionId,
    roundId: round.id,
    stage: submission.stage,
    provider: submission.provider,
    model: submission.model,
    modelVersionId: id,
    parentSubmissionId: parent?.meta.submissionId ?? null,
    payloadDigest: digest,
    reused: analysesWritten + predictionsWritten + systemsWritten + selectionsWritten === 0,
    writes: { analyses: analysesWritten, predictions: predictionsWritten, systems: systemsWritten, selections: selectionsWritten }
  };
}

export async function listAnalysisSubmissions(env, roundId) {
  const { round } = await loadRound(env, roundId);
  const { results } = await env.DB.prepare(`
    SELECT id, created_at, prompt_version, ai_provider, ai_model, config_json
    FROM model_versions
    WHERE feature_version = ?
    ORDER BY created_at ASC, id ASC
  `).bind(FEATURE_VERSION).all();
  const items = [];
  for (const row of results) {
    let config;
    try { config = JSON.parse(row.config_json || '{}'); } catch { continue; }
    const meta = config.analysisExchange;
    if (!meta || meta.roundId !== round.id) continue;
    items.push({
      submissionId: meta.submissionId,
      stage: meta.stage,
      parentSubmissionId: meta.parentSubmissionId || null,
      provider: row.ai_provider,
      model: row.ai_model,
      analysisVersion: row.prompt_version || null,
      dataSnapshotAt: meta.dataSnapshotAt,
      contextFingerprint: meta.contextFingerprint,
      roundSummary: meta.roundSummary ?? null,
      recommendations: meta.recommendations ?? null,
      createdAt: row.created_at
    });
  }
  return { contractVersion: ANALYSIS_SUBMISSION_VERSION, roundId: round.id, submissions: items };
}

export async function getAnalysisSubmission(env, roundId, submissionId) {
  const meta = await readSubmissionMetadata(env, requiredText(roundId, 'round_id', 200), requiredText(submissionId, 'submission_id', 120));
  if (!meta) return null;
  const { results: predictionRows } = await env.DB.prepare(`
    SELECT ara.race_id, ara.data_snapshot_at, ara.market_blind, ara.scenarios_json, ara.race_shape_summary,
           ara.conclusion, ara.data_quality, ahp.race_entry_id, ahp.win_probability, ahp.uncertainty_low,
           ahp.uncertainty_high, ahp.raw_rank, ahp.abcd_group, ahp.value_ratio, ahp.scenario_robustness,
           ahp.reasoning_json, gl.leg_number
    FROM ai_race_analyses ara
    JOIN game_legs gl ON gl.game_round_id = ? AND gl.race_id = ara.race_id
    JOIN ai_horse_predictions ahp ON ahp.ai_race_analysis_id = ara.id
    WHERE ara.model_version_id = ?
    ORDER BY gl.leg_number, ahp.raw_rank, ahp.race_entry_id
  `).bind(roundId, meta.row.id).all();
  const legs = new Map();
  for (const row of predictionRows) {
    const legNumber = Number(row.leg_number);
    if (!legs.has(legNumber)) legs.set(legNumber, {
      legNumber,
      raceId: row.race_id,
      scenarios: row.scenarios_json ? JSON.parse(row.scenarios_json) : null,
      raceShapeSummary: row.race_shape_summary || null,
      conclusion: row.conclusion || null,
      dataQuality: row.data_quality || null,
      predictions: []
    });
    legs.get(legNumber).predictions.push({
      raceEntryId: row.race_entry_id,
      winProbability: row.win_probability == null ? null : Number(row.win_probability),
      uncertaintyLow: row.uncertainty_low == null ? null : Number(row.uncertainty_low),
      uncertaintyHigh: row.uncertainty_high == null ? null : Number(row.uncertainty_high),
      rawRank: row.raw_rank == null ? null : Number(row.raw_rank),
      abcdGroup: row.abcd_group || null,
      valueRatio: row.value_ratio == null ? null : Number(row.value_ratio),
      scenarioRobustness: row.scenario_robustness == null ? null : Number(row.scenario_robustness),
      reasoning: row.reasoning_json ? JSON.parse(row.reasoning_json) : null
    });
  }

  const { results: systemRows } = await env.DB.prepare(`
    SELECT s.id, s.system_type, s.budget_sek, s.row_count, s.line_price_sek, s.spike_count,
           s.estimated_hit_probability, s.risk_profile, s.notes,
           ss.leg_number, ss.race_entry_id, ss.is_spike, ss.own_probability, ss.market_percent, ss.selection_reason
    FROM systems s
    LEFT JOIN system_selections ss ON ss.system_id = s.id
    WHERE s.model_version_id = ? AND s.game_round_id = ?
    ORDER BY s.created_at, s.id, ss.leg_number, ss.race_entry_id
  `).bind(meta.row.id, roundId).all();
  const systems = new Map();
  for (const row of systemRows) {
    if (!systems.has(row.id)) systems.set(row.id, {
      id: row.id,
      systemType: row.system_type,
      budgetSek: Number(row.budget_sek),
      rowCount: Number(row.row_count),
      linePriceSek: row.line_price_sek == null ? null : Number(row.line_price_sek),
      spikeCount: Number(row.spike_count),
      estimatedHitProbability: row.estimated_hit_probability == null ? null : Number(row.estimated_hit_probability),
      riskProfile: row.risk_profile || null,
      notes: row.notes || null,
      selections: []
    });
    if (row.race_entry_id) systems.get(row.id).selections.push({
      legNumber: Number(row.leg_number),
      raceEntryId: row.race_entry_id,
      isSpike: Number(row.is_spike) === 1,
      ownProbability: row.own_probability == null ? null : Number(row.own_probability),
      marketPercent: row.market_percent == null ? null : Number(row.market_percent),
      selectionReason: row.selection_reason || null
    });
  }

  return {
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId: meta.meta.submissionId,
    roundId: meta.meta.roundId,
    stage: meta.meta.stage,
    parentSubmissionId: meta.meta.parentSubmissionId || null,
    producer: { provider: meta.row.ai_provider, model: meta.row.ai_model },
    analysisVersion: meta.row.prompt_version || null,
    dataSnapshotAt: meta.meta.dataSnapshotAt,
    contextFingerprint: meta.meta.contextFingerprint,
    roundSummary: meta.meta.roundSummary ?? null,
    recommendations: meta.meta.recommendations ?? null,
    legs: [...legs.values()],
    systems: [...systems.values()]
  };
}
