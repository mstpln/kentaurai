import { stableId } from './ids.js';

const REVIEW_VERSION = 'deterministic-v1';

function asNumber(value) {
  return value == null ? null : Number(value);
}

async function candidateRound(env, roundId = null) {
  const filter = roundId ? 'AND gr.id = ?' : '';
  const sql = `
    SELECT gr.id, gr.game_type, gr.round_date
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      ${filter}
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id = gr.id) = 8
      AND (SELECT COUNT(DISTINCT gl.leg_number)
           FROM game_legs gl
           JOIN race_entries re ON re.race_id = gl.race_id
           JOIN race_results rr ON rr.race_entry_id = re.id AND rr.placing = 1
           WHERE gl.game_round_id = gr.id) = 8
      AND EXISTS (SELECT 1 FROM systems s WHERE s.game_round_id = gr.id)
      AND EXISTS (
        SELECT 1 FROM systems s
        WHERE s.game_round_id = gr.id
          AND (SELECT COUNT(DISTINCT prr.race_id) FROM post_race_reviews prr WHERE prr.system_id = s.id) < 8
      )
    ORDER BY gr.round_date ASC, gr.id ASC
    LIMIT 1
  `;
  return roundId ? env.DB.prepare(sql).bind(roundId).first() : env.DB.prepare(sql).first();
}

async function systemsForRound(env, roundId) {
  const { results } = await env.DB.prepare(`
    SELECT id, model_version_id, spike_count
    FROM systems
    WHERE game_round_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(roundId).all();
  return results;
}

async function legsForSystem(env, roundId, systemId) {
  const { results } = await env.DB.prepare(`
    SELECT
      gl.leg_number,
      gl.race_id,
      winner.id AS winner_entry_id,
      ss.race_entry_id AS selected_entry_id,
      ss.is_spike,
      ss.own_probability,
      ss.market_percent,
      ahp.raw_rank AS winner_rank,
      ahp.win_probability AS winner_probability,
      ahp.value_ratio AS winner_value_ratio
    FROM game_legs gl
    JOIN race_entries winner ON winner.race_id = gl.race_id
    JOIN race_results rr ON rr.race_entry_id = winner.id AND rr.placing = 1
    LEFT JOIN system_selections ss ON ss.system_id = ? AND ss.leg_number = gl.leg_number
    LEFT JOIN systems s ON s.id = ?
    LEFT JOIN ai_race_analyses ara ON ara.id = (
      SELECT ara2.id FROM ai_race_analyses ara2
      WHERE ara2.race_id = gl.race_id
        AND s.model_version_id IS NOT NULL
        AND ara2.model_version_id = s.model_version_id
      ORDER BY ara2.data_snapshot_at DESC, ara2.created_at DESC, ara2.id ASC
      LIMIT 1
    )
    LEFT JOIN ai_horse_predictions ahp
      ON ahp.ai_race_analysis_id = ara.id AND ahp.race_entry_id = winner.id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number ASC, ss.race_entry_id ASC
  `).bind(systemId, systemId, roundId).all();

  const grouped = new Map();
  for (const row of results) {
    const leg = Number(row.leg_number);
    if (!grouped.has(leg)) grouped.set(leg, {
      legNumber: leg,
      raceId: row.race_id,
      winnerEntryId: row.winner_entry_id,
      winnerRank: asNumber(row.winner_rank),
      winnerProbability: asNumber(row.winner_probability),
      winnerValueRatio: asNumber(row.winner_value_ratio),
      selections: []
    });
    if (row.selected_entry_id) grouped.get(leg).selections.push({
      raceEntryId: row.selected_entry_id,
      isSpike: Number(row.is_spike) === 1,
      ownProbability: asNumber(row.own_probability),
      marketPercent: asNumber(row.market_percent)
    });
  }
  return Array.from(grouped.values());
}

function reviewForLeg(leg) {
  const selectedWinner = leg.selections.some((selection) => selection.raceEntryId === leg.winnerEntryId);
  const isSpikeLeg = leg.selections.length === 1 && leg.selections[0].isSpike;
  let errorType = null;
  if (!selectedWinner) errorType = isSpikeLeg ? 'spike_miss' : 'coverage_miss';

  return {
    selectedWinner,
    errorType,
    review: {
      reviewVersion: REVIEW_VERSION,
      classification: errorType ? 'candidate_learning' : 'no_change',
      isSpikeLeg,
      selectedCount: leg.selections.length,
      winnerValueRatio: leg.winnerValueRatio,
      note: errorType
        ? 'Outcome mismatch recorded for later evidence aggregation; no model change is made automatically.'
        : 'System covered the factual winner; no learning is inferred from this leg alone.'
    }
  };
}

async function reviewSystem(env, round, system) {
  const existing = await env.DB.prepare('SELECT COUNT(DISTINCT race_id) AS count FROM post_race_reviews WHERE system_id = ?').bind(system.id).first();
  if (Number(existing?.count || 0) >= 8) return { systemId: system.id, status: 'already_reviewed', reviews: 0 };

  const legs = await legsForSystem(env, round.id, system.id);
  if (legs.length !== 8) throw new Error(`round ${round.id} does not have exactly eight settled legs`);

  const now = new Date().toISOString();
  let inserted = 0;
  for (const leg of legs) {
    const result = reviewForLeg(leg);
    const id = stableId('review', REVIEW_VERSION, system.id, leg.raceId);
    const write = await env.DB.prepare(`
      INSERT OR IGNORE INTO post_race_reviews
        (id, game_round_id, race_id, race_entry_id, system_id, model_version_id,
         winner_rank, winner_probability, winner_market_percent, selected_in_system,
         error_type, scenario_match, review_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).bind(
      id, round.id, leg.raceId, leg.winnerEntryId, system.id,
      system.model_version_id || null, leg.winnerRank, leg.winnerProbability,
      leg.selections.find((selection) => selection.raceEntryId === leg.winnerEntryId)?.marketPercent ?? null,
      result.selectedWinner ? 1 : 0, result.errorType, JSON.stringify(result.review), now
    ).run();
    inserted += Number(write.meta?.changes ?? 0);
  }

  const completed = await env.DB.prepare('SELECT COUNT(DISTINCT race_id) AS count FROM post_race_reviews WHERE system_id = ?').bind(system.id).first();
  if (Number(completed?.count || 0) !== 8) throw new Error(`post-race review for system ${system.id} did not reach eight settled legs`);
  return { systemId: system.id, status: inserted ? 'reviewed' : 'already_reviewed', reviews: inserted };
}

export async function runNextPostRaceReview(env, options = {}) {
  const round = await candidateRound(env, options.roundId || null);
  if (!round) return { status: 'idle', roundId: options.roundId || null, reviewedSystems: 0, reviews: 0 };

  const systems = await systemsForRound(env, round.id);
  const systemResults = [];
  for (const system of systems) systemResults.push(await reviewSystem(env, round, system));

  return {
    status: 'completed',
    roundId: round.id,
    gameType: round.game_type,
    roundDate: round.round_date,
    reviewedSystems: systemResults.filter((item) => item.status === 'reviewed').length,
    reviews: systemResults.reduce((sum, item) => sum + item.reviews, 0),
    systems: systemResults
  };
}
