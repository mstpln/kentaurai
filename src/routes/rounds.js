export async function getRound(env, roundId) {
  const round = await env.DB.prepare(`SELECT * FROM game_rounds WHERE id = ?`).bind(roundId).first();
  if (!round) return null;
  const { results: legs } = await env.DB.prepare(`
    SELECT gl.leg_number, r.*
    FROM game_legs gl
    JOIN races r ON r.id = gl.race_id
    WHERE gl.game_round_id = ?
    ORDER BY gl.leg_number
  `).bind(roundId).all();
  return { ...round, legs };
}
