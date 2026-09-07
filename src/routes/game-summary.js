import { getGameHistorySummary as getBaseGameHistorySummary } from './games.js';

export async function getGameHistorySummary(env) {
  const summary = await getBaseGameHistorySummary(env);
  const { results } = await env.DB.prepare(`
    WITH latest_reviews AS (
      SELECT
        prr.id,
        prr.error_type,
        ROW_NUMBER() OVER (
          PARTITION BY prr.system_id, prr.race_id
          ORDER BY prr.created_at DESC, prr.id DESC
        ) AS review_rank
      FROM post_race_reviews prr
      JOIN systems s ON s.id = prr.system_id
      WHERE s.id = COALESCE(
        (
          SELECT s1.id
          FROM systems s1
          WHERE s1.game_round_id = s.game_round_id AND s1.system_type = 'main'
          ORDER BY s1.created_at DESC, s1.id ASC
          LIMIT 1
        ),
        (
          SELECT s2.id
          FROM systems s2
          WHERE s2.game_round_id = s.game_round_id
          ORDER BY s2.created_at ASC, s2.id ASC
          LIMIT 1
        )
      )
    )
    SELECT error_type, COUNT(*) AS count
    FROM latest_reviews
    WHERE review_rank = 1 AND error_type IS NOT NULL
    GROUP BY error_type
    ORDER BY count DESC, error_type ASC
  `).all();

  return {
    ...summary,
    errorTypes: results.map((row) => ({
      type: row.error_type,
      count: Number(row.count ?? 0)
    }))
  };
}
