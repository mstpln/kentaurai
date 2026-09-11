function validIso(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value));
}

function effectiveCutoff(asOf, betStopAt) {
  if (!validIso(asOf)) throw new Error('analysis market as_of must be a valid timestamp');
  if (!validIso(betStopAt)) throw new Error('analysis market context requires a verified betting stop');
  return Date.parse(asOf) <= Date.parse(betStopAt) ? asOf : betStopAt;
}

export async function getVerifiedAnalysisMarket(env, roundId, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = await env.DB.prepare(`
    SELECT id, bet_stop_at
    FROM game_rounds
    WHERE id = ? AND game_type IN ('V85','V86')
    LIMIT 1
  `).bind(roundId).first();
  if (!round) throw new Error('V85/V86 round was not found');

  const cutoff = effectiveCutoff(asOf, round.bet_stop_at);
  const { results: betting } = await env.DB.prepare(`
    WITH candidates AS (
      SELECT bs.race_entry_id,
             bs.leg_number,
             bs.bet_percent,
             bs.market_rank,
             bs.captured_at,
             ROW_NUMBER() OVER (
               PARTITION BY bs.race_entry_id
               ORDER BY julianday(bs.captured_at) DESC, bs.id DESC
             ) AS rn
      FROM betting_snapshots bs
      JOIN source_records sr ON sr.id = bs.source_record_id
      JOIN game_legs gl
        ON gl.game_round_id = bs.game_round_id
       AND gl.leg_number = bs.leg_number
      JOIN race_entries re
        ON re.id = bs.race_entry_id
       AND re.race_id = gl.race_id
      WHERE bs.game_round_id = ?
        AND bs.source_record_id IS NOT NULL
        AND julianday(bs.captured_at) <= julianday(?)
    )
    SELECT race_entry_id, leg_number, bet_percent, market_rank, captured_at
    FROM candidates
    WHERE rn = 1
    ORDER BY leg_number, race_entry_id
  `).bind(roundId, cutoff).all();

  const { results: odds } = await env.DB.prepare(`
    WITH candidates AS (
      SELECT os.race_entry_id,
             os.market_type,
             os.odds,
             os.captured_at,
             ROW_NUMBER() OVER (
               PARTITION BY os.race_entry_id, os.market_type
               ORDER BY julianday(os.captured_at) DESC, os.id DESC
             ) AS rn
      FROM odds_snapshots os
      JOIN source_records sr ON sr.id = os.source_record_id
      JOIN race_entries re ON re.id = os.race_entry_id
      JOIN game_legs gl ON gl.race_id = re.race_id
      WHERE gl.game_round_id = ?
        AND os.source_record_id IS NOT NULL
        AND julianday(os.captured_at) <= julianday(?)
    )
    SELECT race_entry_id, market_type, odds, captured_at
    FROM candidates
    WHERE rn = 1
    ORDER BY race_entry_id, market_type
  `).bind(roundId, cutoff).all();

  return {
    definitionVersion: 'verified-market-at-stop-v1',
    roundId,
    betStopAt: round.bet_stop_at,
    asOf,
    cutoff,
    betting: (betting || []).map((row) => ({
      raceEntryId: row.race_entry_id,
      legNumber: Number(row.leg_number),
      betPercent: row.bet_percent == null ? null : Number(row.bet_percent),
      marketRank: row.market_rank == null ? null : Number(row.market_rank),
      capturedAt: row.captured_at
    })),
    odds: (odds || []).map((row) => ({
      raceEntryId: row.race_entry_id,
      marketType: row.market_type,
      odds: row.odds == null ? null : Number(row.odds),
      capturedAt: row.captured_at
    }))
  };
}
