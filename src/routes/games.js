function normalizeGameType(value) {
  const type = String(value || '').toUpperCase();
  return type === 'V85' || type === 'V86' ? type : null;
}

function clampLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100000);
}

function normalizeSort(value) {
  const sort = String(value || 'latest');
  return ['latest', 'correct_desc', 'correct_asc', 'spikes_desc'].includes(sort) ? sort : 'latest';
}

const PRIMARY_SYSTEM_ID = `COALESCE(
  (SELECT s1.id FROM systems s1 WHERE s1.game_round_id = gr.id AND s1.system_type = 'main' ORDER BY s1.created_at DESC, s1.id ASC LIMIT 1),
  (SELECT s2.id FROM systems s2 WHERE s2.game_round_id = gr.id ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
)`;

const ROUND_HISTORY_SELECT = `
  WITH round_base AS (
    SELECT
      gr.id,
      gr.game_type,
      gr.round_date,
      gr.status AS round_status,
      ${PRIMARY_SYSTEM_ID} AS primary_system_id,
      (SELECT COUNT(*) FROM systems sx WHERE sx.game_round_id = gr.id) AS system_count,
      (
        SELECT GROUP_CONCAT(name, ' · ')
        FROM (
          SELECT DISTINCT t.canonical_name AS name
          FROM game_legs glt
          JOIN races rt ON rt.id = glt.race_id
          LEFT JOIN tracks t ON t.id = rt.track_id
          WHERE glt.game_round_id = gr.id AND t.canonical_name IS NOT NULL
          ORDER BY t.canonical_name COLLATE NOCASE ASC
        )
      ) AS track_names
    FROM game_rounds gr
    WHERE EXISTS (SELECT 1 FROM systems sx WHERE sx.game_round_id = gr.id)
  )
  SELECT
    rb.*,
    s.system_type,
    s.budget_sek,
    s.row_count,
    s.spike_count,
    s.created_at AS system_created_at,
    (
      SELECT COUNT(DISTINCT gl.leg_number)
      FROM game_legs gl
      JOIN race_entries re ON re.race_id = gl.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id AND rr.placing = 1
      WHERE gl.game_round_id = rb.id
    ) AS settled_legs,
    (
      SELECT COUNT(DISTINCT ss.leg_number)
      FROM system_selections ss
      JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
      WHERE ss.system_id = rb.primary_system_id
    ) AS correct_legs,
    (
      SELECT COUNT(DISTINCT ss.leg_number)
      FROM system_selections ss
      JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
      WHERE ss.system_id = rb.primary_system_id AND ss.is_spike = 1
    ) AS correct_spikes,
    (
      SELECT COUNT(*)
      FROM post_race_reviews prr
      WHERE prr.system_id = rb.primary_system_id AND prr.error_type IS NOT NULL
    ) AS reviewed_errors,
    (
      SELECT COUNT(*)
      FROM learning_observations lo
      WHERE lo.game_round_id = rb.id
    ) AS learning_count
  FROM round_base rb
  LEFT JOIN systems s ON s.id = rb.primary_system_id
`;

function mapRoundRow(row) {
  const settledLegs = Number(row.settled_legs ?? 0);
  const correctLegs = Number(row.correct_legs ?? 0);
  const spikeCount = Number(row.spike_count ?? 0);
  const correctSpikes = Number(row.correct_spikes ?? 0);
  return {
    id: row.id,
    gameType: row.game_type,
    roundDate: row.round_date,
    roundStatus: row.round_status,
    trackNames: row.track_names || null,
    systemCount: Number(row.system_count ?? 0),
    primarySystemId: row.primary_system_id,
    primarySystemType: row.system_type,
    budgetSek: row.budget_sek == null ? null : Number(row.budget_sek),
    rowCount: row.row_count == null ? null : Number(row.row_count),
    spikeCount,
    settledLegs,
    correctLegs: settledLegs ? correctLegs : null,
    wrongLegs: settledLegs ? settledLegs - correctLegs : null,
    correctSpikes: settledLegs ? correctSpikes : null,
    spikeHitRate: settledLegs && spikeCount ? correctSpikes / spikeCount : null,
    resultComplete: settledLegs === 8,
    reviewedErrors: Number(row.reviewed_errors ?? 0),
    learningCount: Number(row.learning_count ?? 0)
  };
}

function systemMetricsFromRow(row) {
  const settledLegs = Number(row.settled_legs ?? 0);
  const correctLegs = Number(row.correct_legs ?? 0);
  const spikeCount = Number(row.spike_count ?? 0);
  const correctSpikes = Number(row.correct_spikes ?? 0);
  return {
    id: row.id,
    systemType: row.system_type,
    budgetSek: Number(row.budget_sek ?? 0),
    rowCount: Number(row.row_count ?? 0),
    spikeCount,
    estimatedHitProbability: row.estimated_hit_probability == null ? null : Number(row.estimated_hit_probability),
    valueMetric: row.value_metric == null ? null : Number(row.value_metric),
    riskProfile: row.risk_profile || null,
    createdAt: row.created_at,
    settledLegs,
    correctLegs: settledLegs ? correctLegs : null,
    wrongLegs: settledLegs ? settledLegs - correctLegs : null,
    correctSpikes: settledLegs ? correctSpikes : null,
    resultComplete: settledLegs === 8
  };
}

function tripKeyForObservation(row) {
  if (Number(row.leader) === 1) return 'lead';
  if (Number(row.death_seat) === 1) return 'death_seat';
  if (Number(row.pocket) === 1) return 'pocket';
  if (Number(row.second_over) === 1) return 'second_over';
  if (Number(row.third_over) === 1) return 'third_over';
  if (Number(row.wide_trip) === 1 || Number(row.uncovered_move) === 1) return 'wide_attack';
  return null;
}

const TRIP_LABELS = {
  lead: 'Spets',
  death_seat: 'Dödens',
  pocket: 'Rygg ledaren',
  second_over: '2:a utvändigt',
  third_over: '3:e utvändigt',
  wide_attack: 'Bred attack'
};

function classifyWinnerTrip(observations) {
  const usable = observations.filter((row) => row && row.race_entry_id);
  if (!usable.length) return null;

  const counts = new Map();
  for (const row of usable) {
    const key = tripKeyForObservation(row);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return null;

  const priority = ['lead', 'death_seat', 'pocket', 'second_over', 'third_over', 'wide_attack'];
  let bestKey = null;
  let bestCount = -1;
  for (const key of priority) {
    const count = counts.get(key) || 0;
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey || bestCount <= 0) return null;
  return {
    key: bestKey,
    label: TRIP_LABELS[bestKey],
    evidenceCount: bestCount,
    observationCount: usable.length
  };
}

function sortClause(sort) {
  if (sort === 'correct_desc') return 'CASE WHEN settled_legs = 8 THEN 0 ELSE 1 END, correct_legs DESC, round_date DESC, id ASC';
  if (sort === 'correct_asc') return 'CASE WHEN settled_legs = 8 THEN 0 ELSE 1 END, correct_legs ASC, round_date DESC, id ASC';
  if (sort === 'spikes_desc') return 'CASE WHEN settled_legs = 8 THEN 0 ELSE 1 END, correct_spikes DESC, correct_legs DESC, round_date DESC, id ASC';
  return 'round_date DESC, id ASC';
}

export async function listGameHistory(env, options = {}) {
  const gameType = normalizeGameType(options.gameType);
  const sort = normalizeSort(options.sort);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const filter = gameType ? 'WHERE game_type = ?' : '';
  const statement = env.DB.prepare(`${ROUND_HISTORY_SELECT}\n${filter}\nORDER BY ${sortClause(sort)}\nLIMIT ? OFFSET ?`);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total FROM game_rounds gr WHERE EXISTS (SELECT 1 FROM systems sx WHERE sx.game_round_id = gr.id) ${gameType ? 'AND gr.game_type = ?' : ''}`);

  const [{ results }, countRow] = gameType
    ? await Promise.all([statement.bind(gameType, limit, offset).all(), countStatement.bind(gameType).first()])
    : await Promise.all([statement.bind(limit, offset).all(), countStatement.first()]);

  const total = Number(countRow?.total ?? 0);
  return {
    gameType,
    sort,
    items: results.map(mapRoundRow),
    total,
    limit,
    offset,
    hasMore: offset + results.length < total
  };
}

async function getTripRows(env, roundId) {
  const { results } = await env.DB.prepare(`
    SELECT
      gl.leg_number,
      r.id AS race_id,
      winner.id AS race_entry_id,
      rp.observed_at_m,
      rp.position,
      rp.leader,
      rp.pocket,
      rp.death_seat,
      rp.second_over,
      rp.third_over,
      rp.wide_trip,
      rp.uncovered_move
    FROM game_legs gl
    JOIN races r ON r.id = gl.race_id
    JOIN race_entries winner ON winner.race_id = r.id
    JOIN race_results rr ON rr.race_entry_id = winner.id AND rr.placing = 1
    LEFT JOIN race_positions rp ON rp.race_entry_id = winner.id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number ASC, rp.observed_at_m ASC
  `).bind(roundId).all();
  return results;
}

function tripMapFromRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = Number(row.leg_number);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const trips = new Map();
  for (const [leg, observations] of grouped.entries()) trips.set(leg, classifyWinnerTrip(observations));
  return trips;
}

function summarize(items) {
  const completed = items.filter((item) => item.resultComplete);
  const totalCorrect = completed.reduce((sum, item) => sum + Number(item.correctLegs ?? 0), 0);
  const totalSpikes = completed.reduce((sum, item) => sum + Number(item.spikeCount ?? 0), 0);
  const correctSpikes = completed.reduce((sum, item) => sum + Number(item.correctSpikes ?? 0), 0);
  const distribution = {};
  for (const item of completed) {
    const key = String(item.correctLegs);
    distribution[key] = (distribution[key] || 0) + 1;
  }
  return {
    rounds: items.length,
    completedRounds: completed.length,
    fullHits: completed.filter((item) => item.correctLegs === 8).length,
    averageCorrect: completed.length ? totalCorrect / completed.length : null,
    spikeHitRate: totalSpikes ? correctSpikes / totalSpikes : null,
    correctDistribution: distribution
  };
}

export async function getGameHistorySummary(env) {
  const { results } = await env.DB.prepare(`${ROUND_HISTORY_SELECT}\nORDER BY round_date DESC, id ASC`).all();
  const rounds = results.map(mapRoundRow);

  const tripCounts = new Map();
  let unknownTrips = 0;
  for (const round of rounds) {
    const trips = tripMapFromRows(await getTripRows(env, round.id));
    for (const trip of trips.values()) {
      if (!trip) {
        unknownTrips += 1;
        continue;
      }
      tripCounts.set(trip.label, (tripCounts.get(trip.label) || 0) + 1);
    }
  }

  const { results: errorRows } = await env.DB.prepare(`
    SELECT prr.error_type, COUNT(*) AS count
    FROM post_race_reviews prr
    JOIN systems s ON s.id = prr.system_id
    WHERE prr.error_type IS NOT NULL
      AND s.id = COALESCE(
        (SELECT s1.id FROM systems s1 WHERE s1.game_round_id = s.game_round_id AND s1.system_type = 'main' ORDER BY s1.created_at DESC, s1.id ASC LIMIT 1),
        (SELECT s2.id FROM systems s2 WHERE s2.game_round_id = s.game_round_id ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
      )
    GROUP BY prr.error_type
    ORDER BY count DESC, prr.error_type ASC
  `).all();

  const { results: learningRows } = await env.DB.prepare(`
    SELECT lh.status, COUNT(*) AS count
    FROM learning_observations lo
    JOIN learning_hypotheses lh ON lh.id = lo.hypothesis_id
    GROUP BY lh.status
    ORDER BY lh.status ASC
  `).all();

  return {
    all: summarize(rounds),
    v85: summarize(rounds.filter((round) => round.gameType === 'V85')),
    v86: summarize(rounds.filter((round) => round.gameType === 'V86')),
    savedSystems: rounds.reduce((sum, round) => sum + round.systemCount, 0),
    errorTypes: errorRows.map((row) => ({ type: row.error_type, count: Number(row.count ?? 0) })),
    winnerTrips: Array.from(tripCounts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'sv')),
    unknownWinnerTrips: unknownTrips,
    learnings: learningRows.map((row) => ({ status: row.status, count: Number(row.count ?? 0) }))
  };
}

export async function getGameHistoryDetail(env, roundId) {
  const id = String(roundId || '').trim();
  if (!id) return null;

  const round = await env.DB.prepare(`
    SELECT
      gr.id,
      gr.game_type,
      gr.round_date,
      gr.status,
      gr.payout_json,
      (
        SELECT GROUP_CONCAT(name, ' · ')
        FROM (
          SELECT DISTINCT t.canonical_name AS name
          FROM game_legs glt
          JOIN races rt ON rt.id = glt.race_id
          LEFT JOIN tracks t ON t.id = rt.track_id
          WHERE glt.game_round_id = gr.id AND t.canonical_name IS NOT NULL
          ORDER BY t.canonical_name COLLATE NOCASE ASC
        )
      ) AS track_names
    FROM game_rounds gr
    WHERE gr.id = ? AND EXISTS (SELECT 1 FROM systems sx WHERE sx.game_round_id = gr.id)
    LIMIT 1
  `).bind(id).first();
  if (!round) return null;

  const { results: systemRows } = await env.DB.prepare(`
    SELECT
      s.id,
      s.system_type,
      s.budget_sek,
      s.row_count,
      s.spike_count,
      s.estimated_hit_probability,
      s.value_metric,
      s.risk_profile,
      s.created_at,
      (
        SELECT COUNT(DISTINCT gl.leg_number)
        FROM game_legs gl
        JOIN race_entries re ON re.race_id = gl.race_id
        JOIN race_results rr ON rr.race_entry_id = re.id AND rr.placing = 1
        WHERE gl.game_round_id = s.game_round_id
      ) AS settled_legs,
      (
        SELECT COUNT(DISTINCT ss.leg_number)
        FROM system_selections ss
        JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
        WHERE ss.system_id = s.id
      ) AS correct_legs,
      (
        SELECT COUNT(DISTINCT ss.leg_number)
        FROM system_selections ss
        JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
        WHERE ss.system_id = s.id AND ss.is_spike = 1
      ) AS correct_spikes
    FROM systems s
    WHERE s.game_round_id = ?
    ORDER BY
      CASE WHEN s.id = COALESCE(
        (SELECT s1.id FROM systems s1 WHERE s1.game_round_id = s.game_round_id AND s1.system_type = 'main' ORDER BY s1.created_at DESC, s1.id ASC LIMIT 1),
        (SELECT s2.id FROM systems s2 WHERE s2.game_round_id = s.game_round_id ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
      ) THEN 0 ELSE 1 END,
      CASE WHEN s.system_type = 'main' THEN 0 ELSE 1 END,
      s.created_at DESC,
      s.id ASC
  `).bind(id).all();
  const systems = systemRows.map(systemMetricsFromRow);

  const { results: legRows } = await env.DB.prepare(`
    SELECT
      gl.leg_number,
      r.id AS race_id,
      r.race_number,
      r.distance_m,
      r.start_method,
      r.race_name,
      t.canonical_name AS track_name,
      winner.id AS winner_entry_id,
      winner.start_number AS winner_start_number,
      h.id AS winner_horse_id,
      h.canonical_name AS winner_name,
      rr.km_time AS winner_km_time,
      rr.official_odds AS winner_official_odds
    FROM game_legs gl
    JOIN races r ON r.id = gl.race_id
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN race_entries winner ON winner.race_id = r.id AND EXISTS (
      SELECT 1 FROM race_results rrw WHERE rrw.race_entry_id = winner.id AND rrw.placing = 1
    )
    LEFT JOIN horses h ON h.id = winner.horse_id
    LEFT JOIN race_results rr ON rr.race_entry_id = winner.id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number ASC
  `).bind(id).all();

  const { results: selectionRows } = await env.DB.prepare(`
    SELECT
      ss.system_id,
      ss.leg_number,
      ss.is_spike,
      ss.own_probability,
      ss.market_percent,
      re.id AS race_entry_id,
      re.start_number,
      h.id AS horse_id,
      h.canonical_name AS horse_name
    FROM system_selections ss
    JOIN race_entries re ON re.id = ss.race_entry_id
    JOIN horses h ON h.id = re.horse_id
    JOIN systems s ON s.id = ss.system_id
    WHERE s.game_round_id = ?
    ORDER BY ss.system_id ASC, ss.leg_number ASC, re.start_number ASC, h.canonical_name COLLATE NOCASE ASC
  `).bind(id).all();

  const { results: predictionRows } = await env.DB.prepare(`
    SELECT
      s.id AS system_id,
      gl.leg_number,
      ahp.race_entry_id,
      ahp.raw_rank,
      ahp.abcd_group,
      ahp.win_probability,
      ahp.value_ratio
    FROM systems s
    JOIN game_legs gl ON gl.game_round_id = s.game_round_id
    JOIN ai_race_analyses ara ON ara.id = (
      SELECT ara2.id
      FROM ai_race_analyses ara2
      WHERE ara2.race_id = gl.race_id AND ara2.model_version_id = s.model_version_id
      ORDER BY ara2.data_snapshot_at DESC, ara2.created_at DESC, ara2.id ASC
      LIMIT 1
    )
    JOIN ai_horse_predictions ahp ON ahp.ai_race_analysis_id = ara.id
    WHERE s.game_round_id = ?
  `).bind(id).all();

  const { results: reviewRows } = await env.DB.prepare(`
    SELECT
      prr.system_id,
      gl.leg_number,
      prr.race_entry_id,
      prr.selected_in_system,
      prr.error_type,
      prr.scenario_match,
      prr.review_json,
      prr.created_at
    FROM post_race_reviews prr
    JOIN game_legs gl ON gl.game_round_id = prr.game_round_id AND gl.race_id = prr.race_id
    WHERE prr.game_round_id = ?
    ORDER BY prr.system_id ASC, gl.leg_number ASC, prr.created_at DESC, prr.id ASC
  `).bind(id).all();

  const { results: learningRows } = await env.DB.prepare(`
    SELECT
      lo.id,
      lo.race_id,
      lo.direction,
      lo.strength,
      lo.observation_text,
      lo.created_at,
      lh.title,
      lh.category,
      lh.status
    FROM learning_observations lo
    JOIN learning_hypotheses lh ON lh.id = lo.hypothesis_id
    WHERE lo.game_round_id = ?
    ORDER BY CASE lh.status WHEN 'confirmed' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, lo.created_at ASC, lo.id ASC
  `).bind(id).all();

  const tripMap = tripMapFromRows(await getTripRows(env, id));
  const selectionsBySystemLeg = new Map();
  for (const row of selectionRows) {
    const key = `${row.system_id}:${row.leg_number}`;
    if (!selectionsBySystemLeg.has(key)) selectionsBySystemLeg.set(key, []);
    selectionsBySystemLeg.get(key).push({
      raceEntryId: row.race_entry_id,
      startNumber: row.start_number == null ? null : Number(row.start_number),
      horseId: row.horse_id,
      horseName: row.horse_name,
      isSpike: Number(row.is_spike) === 1,
      ownProbability: row.own_probability == null ? null : Number(row.own_probability),
      marketPercent: row.market_percent == null ? null : Number(row.market_percent)
    });
  }

  const predictions = new Map();
  for (const row of predictionRows) {
    predictions.set(`${row.system_id}:${row.leg_number}:${row.race_entry_id}`, {
      rawRank: row.raw_rank == null ? null : Number(row.raw_rank),
      abcdGroup: row.abcd_group || null,
      winProbability: row.win_probability == null ? null : Number(row.win_probability),
      valueRatio: row.value_ratio == null ? null : Number(row.value_ratio)
    });
  }

  const reviews = new Map();
  for (const row of reviewRows) {
    const key = `${row.system_id}:${row.leg_number}`;
    if (!reviews.has(key)) {
      reviews.set(key, {
        selectedInSystem: row.selected_in_system == null ? null : Number(row.selected_in_system) === 1,
        errorType: row.error_type || null,
        scenarioMatch: row.scenario_match || null,
        reviewJson: row.review_json || null
      });
    }
  }

  const legs = legRows.map((row) => {
    const winnerEntryId = row.winner_entry_id || null;
    const systemResults = {};
    for (const system of systems) {
      const selections = selectionsBySystemLeg.get(`${system.id}:${row.leg_number}`) || [];
      const selectedWinner = winnerEntryId ? selections.some((selection) => selection.raceEntryId === winnerEntryId) : null;
      const spike = selections.length === 1 && selections[0].isSpike;
      systemResults[system.id] = {
        selections,
        selectedWinner,
        isSpike: spike,
        winnerPrediction: winnerEntryId ? predictions.get(`${system.id}:${row.leg_number}:${winnerEntryId}`) || null : null,
        review: reviews.get(`${system.id}:${row.leg_number}`) || null
      };
    }
    return {
      legNumber: Number(row.leg_number),
      raceId: row.race_id,
      raceNumber: row.race_number == null ? null : Number(row.race_number),
      trackName: row.track_name || null,
      distanceM: row.distance_m == null ? null : Number(row.distance_m),
      startMethod: row.start_method || null,
      raceName: row.race_name || null,
      winner: winnerEntryId ? {
        raceEntryId: winnerEntryId,
        horseId: row.winner_horse_id,
        horseName: row.winner_name,
        startNumber: row.winner_start_number == null ? null : Number(row.winner_start_number),
        kmTime: row.winner_km_time || null,
        officialOdds: row.winner_official_odds == null ? null : Number(row.winner_official_odds),
        trip: tripMap.get(Number(row.leg_number)) || null
      } : null,
      systems: systemResults
    };
  });

  const tripDistribution = new Map();
  let unknownTripCount = 0;
  for (const leg of legs) {
    if (!leg.winner?.trip) {
      if (leg.winner) unknownTripCount += 1;
      continue;
    }
    const label = leg.winner.trip.label;
    tripDistribution.set(label, (tripDistribution.get(label) || 0) + 1);
  }

  return {
    round: {
      id: round.id,
      gameType: round.game_type,
      roundDate: round.round_date,
      status: round.status,
      trackNames: round.track_names || null
    },
    systems,
    legs,
    winnerTrips: Array.from(tripDistribution.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'sv')),
    unknownWinnerTrips: unknownTripCount,
    learnings: learningRows.map((row) => ({
      id: row.id,
      raceId: row.race_id || null,
      title: row.title,
      category: row.category,
      status: row.status,
      direction: row.direction,
      strength: row.strength == null ? null : Number(row.strength),
      observationText: row.observation_text,
      createdAt: row.created_at
    }))
  };
}
