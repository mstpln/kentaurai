import { getGameHistoryDetail } from './games.js';

export async function getEnhancedGameHistoryDetail(env, roundId) {
  const detail = await getGameHistoryDetail(env, roundId);
  if (!detail) return null;

  const { results } = await env.DB.prepare(`
    SELECT
      s.id AS system_id,
      gl.leg_number,
      ara.race_shape_summary
    FROM systems s
    JOIN game_legs gl ON gl.game_round_id = s.game_round_id
    LEFT JOIN ai_race_analyses ara ON ara.id = (
      SELECT ara2.id
      FROM ai_race_analyses ara2
      WHERE ara2.race_id = gl.race_id
        AND s.model_version_id IS NOT NULL
        AND ara2.model_version_id = s.model_version_id
      ORDER BY ara2.data_snapshot_at DESC, ara2.created_at DESC, ara2.id ASC
      LIMIT 1
    )
    WHERE s.game_round_id = ?
    ORDER BY s.id ASC, gl.leg_number ASC
  `).bind(roundId).all();

  const expectedBySystemLeg = new Map(results.map((row) => [
    `${row.system_id}:${Number(row.leg_number)}`,
    row.race_shape_summary || null
  ]));

  for (const leg of detail.legs || []) {
    for (const system of detail.systems || []) {
      const systemResult = leg.systems?.[system.id];
      if (!systemResult) continue;
      systemResult.expectedRaceShape = expectedBySystemLeg.get(`${system.id}:${leg.legNumber}`) || null;
    }
  }
  return detail;
}
